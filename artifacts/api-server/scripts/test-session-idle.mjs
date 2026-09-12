// Integration test for the privileged-session inactivity cutoff.
// Usage: node scripts/run-isolated.mjs scripts/test-session-idle.mjs
//
// Contract (see src/lib/authUtils.ts):
//   * super_admin sessions idle for more than 30 days are rejected with 401
//     and removed, even if their expires_at is still in the future.
//   * regular shop accounts keep the persist-until-revoked model: an equally
//     idle dealer session still authenticates.
//   * an authenticated request refreshes last_seen_at (throttled), and the
//     device list reports lastSeenAt and never lists an idle privileged session.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_ENTRY = process.env.API_SERVER_ENTRY ?? "./dist/index.mjs";

const dbPkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../lib/db");
const require = createRequire(path.join(dbPkgDir, "package.json"));
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const PORT = 5649;
const BASE = `http://localhost:${PORT}/api`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label} — ${JSON.stringify(detail)}`);
  }
}

async function api(method, pathname, token) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function seedUser(role, tag) {
  const n = Math.floor(Math.random() * 1e6);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [user] } = await client.query(
      `INSERT INTO users (name, email, mobile, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
      [`Idle ${tag}`, `idle-${tag}-${n}@example.com`, String(9300000000 + n), role],
    );
    const { rows: [shop] } = await client.query(
      `INSERT INTO shops (dealer_id, business_name) VALUES ($1, $2) RETURNING id`,
      [user.id, `Idle Shop ${tag}`],
    );
    await client.query(`UPDATE users SET shop_id = $1 WHERE id = $2`, [shop.id, user.id]);
    await client.query("COMMIT");
    return user.id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// last_seen_at is expressed relative to now() so the fixture never depends on
// the clock of the machine running the test.
async function seedSession(userId, lastSeenInterval, deviceInfo) {
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO sessions (token, user_id, device_info, expires_at, last_seen_at)
     VALUES ($1, $2, $3, '9999-12-31T23:59:59.999Z', now() - $4::interval)`,
    [token, userId, deviceInfo, lastSeenInterval],
  );
  return token;
}

async function sessionRow(token) {
  const { rows } = await pool.query(
    `SELECT last_seen_at FROM sessions WHERE token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

async function run() {
  const adminId = await seedUser("super_admin", "admin");
  const dealerId = await seedUser("dealer", "dealer");
  try {
    const adminIdle = await seedSession(adminId, "31 days", "Old admin laptop");
    const adminFresh = await seedSession(adminId, "29 days", "Current admin phone");
    const adminStale = await seedSession(adminId, "6 minutes", "Stale-stamp admin");
    const dealerIdle = await seedSession(dealerId, "400 days", "Old dealer phone");

    const idle = await api("GET", "/auth/me", adminIdle);
    check("super_admin session idle >30d is rejected", idle.status === 401, idle);
    check("idle super_admin session row is removed", (await sessionRow(adminIdle)) === null);

    const fresh = await api("GET", "/auth/me", adminFresh);
    check("super_admin session idle <30d still authenticates", fresh.status === 200, fresh);

    const dealer = await api("GET", "/auth/me", dealerIdle);
    check("dealer session idle >30d still authenticates (persist-until-revoked)", dealer.status === 200, dealer);

    const before = await sessionRow(adminStale);
    const touched = await api("GET", "/auth/me", adminStale);
    check("request on a stale-stamped session succeeds", touched.status === 200, touched);
    // The touch is fire-and-forget; give it a moment to land.
    let after = null;
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      after = await sessionRow(adminStale);
      if (after && after.last_seen_at > before.last_seen_at) break;
    }
    check(
      "authenticated request refreshes last_seen_at",
      after && after.last_seen_at > before.last_seen_at,
      { before: before?.last_seen_at, after: after?.last_seen_at },
    );

    const list = await api("GET", "/auth/sessions", adminFresh);
    check("session list loads", list.status === 200, list);
    const infos = Array.isArray(list.json.sessions) ? list.json.sessions : [];
    check(
      "session list carries lastSeenAt for every row",
      infos.length > 0 && infos.every((s) => typeof s.lastSeenAt === "string" && !Number.isNaN(Date.parse(s.lastSeenAt))),
      infos,
    );
    check(
      "session list never shows an idle privileged session",
      !infos.some((s) => s.deviceInfo === "Old admin laptop"),
      infos.map((s) => s.deviceInfo),
    );
    check(
      "session list marks the calling session as current",
      infos.some((s) => s.deviceInfo === "Current admin phone" && s.current === true),
      infos,
    );
  } finally {
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[adminId, dealerId]])
      .catch((err) => console.error("cleanup failed:", err));
  }
}

async function main() {
  const child = spawn("node", ["--enable-source-maps", SERVER_ENTRY], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await sleep(1000);
      up = await fetch(`${BASE}/healthz`).then((r) => r.status > 0).catch(() => false);
    }
    if (!up) throw new Error("server did not start");
    await run();
  } finally {
    child.kill("SIGTERM");
    await sleep(300);
    await pool.end();
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll session idle checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
