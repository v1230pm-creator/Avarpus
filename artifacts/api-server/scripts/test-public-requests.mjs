// API-level regression checks for the public support/deletion intake flow.
// Usage: node scripts/run-isolated.mjs scripts/test-public-requests.mjs
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Built server entry. scripts/run-isolated.mjs builds into a private per-run
// directory and passes it here so a concurrent `pnpm run build` rewriting
// ./dist cannot pull the bundle out from under this run.
const SERVER_ENTRY = process.env.API_SERVER_ENTRY ?? "./dist/index.mjs";

const dbPkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../lib/db");
const require = createRequire(path.join(dbPkgDir, "package.json"));
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const PORT = 5651;
const BASE = `http://localhost:${PORT}/api`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = randomBytes(6).toString("hex");
const markerEmail = `public-request-${suffix}@example.test`;
const markerSubject = `Regression ${suffix}`;
const mobilePrefix = `7${suffix.replace(/[a-f]/g, (value) => value.charCodeAt(0) - 87).slice(0, 8)}`;
const syntheticMobiles = Array.from({ length: 10 }, (_, index) =>
  `${mobilePrefix}${index}`.slice(0, 10),
);

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label} — ${JSON.stringify(detail)}`);
  }
}

function payload(mobile, extra = {}) {
  return {
    kind: "support",
    name: `Public Request Test ${suffix}`,
    mobile,
    email: markerEmail,
    subject: markerSubject,
    message: `Synthetic public request regression check ${suffix}.`,
    confirmation: false,
    website: "",
    ...extra,
  };
}

async function post(body, forwardedFor) {
  const response = await fetch(`${BASE}/public/requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": forwardedFor,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: await response.json().catch(() => ({})),
  };
}

async function rowsForSyntheticMobiles() {
  const { rows } = await pool.query(
    `SELECT id, kind, mobile, confirmation_accepted_at
       FROM public_requests
      WHERE email = $1 AND subject = $2
      ORDER BY created_at, id`,
    [markerEmail, markerSubject],
  );
  return rows;
}

async function alertRowsForRequestIds(ids) {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, user_id, data
       FROM notifications
      WHERE type = 'public_request_received'
        AND data->>'publicRequestId' = ANY($1::text[])`,
    [ids],
  );
  return rows;
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.allow_public_request_audit_cleanup', 'on', true)");
    const { rows } = await client.query(
      "SELECT id FROM public_requests WHERE email = $1 AND subject = $2",
      [markerEmail, markerSubject],
    );
    const ids = rows.map((row) => row.id);
    if (ids.length > 0) {
      await client.query(
        `DELETE FROM notifications
          WHERE type = 'public_request_received'
            AND data->>'publicRequestId' = ANY($1::text[])`,
        [ids],
      );
      await client.query(
        "DELETE FROM public_request_identity_verifications WHERE public_request_id = ANY($1::uuid[])",
        [ids],
      );
      await client.query(
        "DELETE FROM public_request_transitions WHERE public_request_id = ANY($1::uuid[])",
        [ids],
      );
      await client.query("DELETE FROM public_requests WHERE id = ANY($1::uuid[])", [ids]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function run() {
  console.log("== public request intake ==");
  const support = await post(payload(syntheticMobiles[0]), `2001:db8:${suffix.slice(0, 4)}:1::1`);
  check(
    "valid support request returns a receipt",
    support.status === 202 &&
      support.json.status === "received" &&
      typeof support.json.requestId === "string" &&
      support.json.message === "Your support request was recorded for review.",
    support,
  );

  const rejectedDeletion = await post(
    payload(syntheticMobiles[1], {
      kind: "account_deletion",
      confirmation: false,
    }),
    `2001:db8:${suffix.slice(0, 4)}:2::1`,
  );
  check(
    "unconfirmed deletion request is rejected",
    rejectedDeletion.status === 400 &&
      rejectedDeletion.json.message ===
        "Confirm that you understand identity verification is required.",
    rejectedDeletion,
  );

  const honeypot = await post(
    payload(syntheticMobiles[2], { website: "https://bot.example" }),
    `2001:db8:${suffix.slice(0, 4)}:3::1`,
  );
  check(
    "honeypot stays opaque with a normal-looking receipt",
    honeypot.status === 202 &&
      honeypot.json.status === "received" &&
      typeof honeypot.json.requestId === "string" &&
      honeypot.json.message === "Your request has been received for review.",
    honeypot,
  );

  const deletion = await post(
    payload(syntheticMobiles[3], {
      kind: "account_deletion",
      confirmation: true,
    }),
    `2001:db8:${suffix.slice(0, 4)}:4::1`,
  );
  check("confirmed deletion request is accepted", deletion.status === 202, deletion);

  const beforeBurst = Date.now();
  const burstIp = `2001:db8:${suffix.slice(0, 4)}:5::1`;
  const burst = await Promise.all(
    syntheticMobiles.slice(4).map((mobile) => post(payload(mobile), burstIp)),
  );
  const statuses = burst.map((response) => response.status).sort((a, b) => a - b);
  check(
    "six concurrent requests yield exactly five 202s and one 429",
    statuses.length === 6 &&
      statuses.filter((status) => status === 202).length === 5 &&
      statuses.filter((status) => status === 429).length === 1,
    { statuses },
  );

  const rows = await rowsForSyntheticMobiles();
  const supportRow = rows.find((row) => row.mobile === syntheticMobiles[0]);
  check(
    "valid support receipt is persisted",
    supportRow?.kind === "support" && supportRow.confirmation_accepted_at === null,
    supportRow,
  );
  check(
    "rejected deletion request is not persisted",
    !rows.some((row) => row.mobile === syntheticMobiles[1]),
    rows,
  );
  check(
    "honeypot request is not persisted",
    !rows.some((row) => row.mobile === syntheticMobiles[2]),
    rows,
  );
  const deletionRow = rows.find((row) => row.mobile === syntheticMobiles[3]);
  const acceptedAt = deletionRow?.confirmation_accepted_at?.getTime();
  check(
    "deletion consent timestamp is persisted at receipt time",
    deletionRow?.kind === "account_deletion" &&
      Number.isFinite(acceptedAt) &&
      acceptedAt >= beforeBurst - 30_000 &&
      acceptedAt <= Date.now(),
    deletionRow,
  );
  check(
    "only five concurrent burst rows are persisted",
    rows.filter((row) => syntheticMobiles.slice(4).includes(row.mobile)).length === 5,
    rows,
  );
  const alertRows = await alertRowsForRequestIds(rows.map((row) => row.id));
  check(
    "suppressed regression submissions create no staff alerts",
    alertRows.length === 0,
    alertRows,
  );
}

async function main() {
  const child = spawn("node", ["--enable-source-maps", SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "test",
      SESSION_SECRET: process.env.SESSION_SECRET || `public-request-test-${suffix}`,
      DISABLE_PUBLIC_REQUEST_ALERTS: "true",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt++) {
      await sleep(1000);
      ready = await fetch(`${BASE}/healthz`)
        .then((response) => response.status > 0)
        .catch(() => false);
    }
    if (!ready) throw new Error("server did not start");
    await run();
  } finally {
    child.kill("SIGTERM");
    await cleanup().catch((error) => {
      failures++;
      console.error("cleanup failed:", error);
    });
    const remaining = await rowsForSyntheticMobiles().catch((error) => {
      failures++;
      console.error("cleanup verification failed:", error);
      return null;
    });
    if (remaining) {
      check("cleanup removes every synthetic row", remaining.length === 0, remaining);
    }
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll public request checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});