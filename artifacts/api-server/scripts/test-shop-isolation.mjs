// API-level tests proving cross-shop isolation: a user from shop B must be
// rejected (404/400) when reading or writing shop A's customers, repairs,
// photos, timeline events, and parts — and list endpoints must never leak
// another shop's rows.
// Usage: pnpm run build && node scripts/test-shop-isolation.mjs
//
// Seeds two throwaway dealer shops directly in the database (same pattern as
// test-customer-balances.mjs), spawns the built server, and drives the API
// over HTTP. All seeded rows are removed at the end (deleting the users
// cascades to shops -> customers/repairs/photos/events/sessions).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve `pg` through the db workspace package (pnpm keeps deps local).
const dbPkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../lib/db");
const require = createRequire(path.join(dbPkgDir, "package.json"));
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const PORT = 5643;
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

async function api(method, pathname, token, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function seedTestShop(tag) {
  const n = Math.floor(Math.random() * 1e6);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const {
      rows: [user],
    } = await client.query(
      `INSERT INTO users (name, email, mobile, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'x', 'dealer', true) RETURNING id`,
      [`Isolation Dealer ${tag}`, `isolation-${tag}-${n}@example.com`, String(9200000000 + n)],
    );
    const {
      rows: [shop],
    } = await client.query(
      `INSERT INTO shops (dealer_id, business_name) VALUES ($1, $2) RETURNING id`,
      [user.id, `Isolation Shop ${tag}`],
    );
    await client.query(`UPDATE users SET shop_id = $1 WHERE id = $2`, [shop.id, user.id]);
    const token = randomBytes(32).toString("hex");
    await client.query(
      `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
      [token, user.id],
    );
    await client.query("COMMIT");
    return { userId: user.id, shopId: shop.id, token };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function cleanup(userId) {
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

async function run(A, B) {
  // ── Seed shop A's data through the API (as shop A) ───────────────────────
  const { status: cs, json: cj } = await api("POST", "/customers", A.token, {
    name: "Shop A Customer",
    mobile: "9188888888",
  });
  check("shop A creates its customer", cs === 200 && cj.customer?.id, { cs, cj });
  const custA = cj.customer.id;

  const { status: rs, json: rj } = await api("POST", "/repairs", A.token, {
    customerId: custA,
    customerName: "Shop A Customer",
    mobile: "9188888888",
    deviceType: "mobile",
    brand: "BrandA",
    model: "A1",
    problem: "screen cracked",
    repairCharge: 300,
  });
  check("shop A creates its repair", rs === 200 && rj.repair?.id, { rs, rj });
  const repA = rj.repair.id;

  // Sanity: shop A can see and edit its own rows.
  const own = await api("PATCH", `/customers/${custA}`, A.token, { address: "A street" });
  check("shop A can patch its own customer", own.status === 200, own);
  const ownR = await api("PATCH", `/repairs/${repA}`, A.token, { notes: "own note" });
  check("shop A can patch its own repair", ownR.status === 200, ownR);
  const ownEv = await api("GET", `/repairs/${repA}/events`, A.token);
  check("shop A can read its repair timeline", ownEv.status === 200 && (ownEv.json.events ?? []).length > 0, ownEv);

  // ── List endpoints must not leak shop A's rows to shop B ─────────────────
  const bl = await api("GET", "/customers", B.token);
  check(
    "shop B customer list excludes shop A's customer",
    bl.status === 200 && !(bl.json.customers ?? []).some((c) => c.id === custA),
    bl,
  );
  const brl = await api("GET", "/repairs", B.token);
  check(
    "shop B repair list excludes shop A's repair",
    brl.status === 200 && !(brl.json.repairs ?? []).some((r) => r.id === repA),
    brl,
  );

  // ── Cross-shop writes on customers ────────────────────────────────────────
  const xc = await api("PATCH", `/customers/${custA}`, B.token, { name: "HACKED" });
  check("shop B PATCH shop A customer -> 404", xc.status === 404, xc);

  // Linking a repair to another shop's customer must be rejected.
  const xr = await api("POST", "/repairs", B.token, {
    customerId: custA,
    customerName: "Shop A Customer",
    mobile: "9188888888",
    deviceType: "mobile",
    brand: "X",
    model: "X",
    problem: "cross-shop link attempt",
  });
  check("shop B POST repair linked to shop A customer -> 400", xr.status === 400, xr);

  // ── Cross-shop reads/writes on repairs and their sub-resources ───────────
  const xp = await api("PATCH", `/repairs/${repA}`, B.token, { status: "cancelled", notes: "HACKED" });
  check("shop B PATCH shop A repair -> 404", xp.status === 404, xp);

  const xph = await api("GET", `/repairs/${repA}/photos`, B.token);
  check("shop B GET shop A repair photos -> 404", xph.status === 404, xph);

  const xphp = await api("POST", `/repairs/${repA}/photos`, B.token, {
    kind: "front",
    objectPath: `uploads/${B.shopId}/fake.jpg`,
  });
  check("shop B POST photo on shop A repair -> 404", xphp.status === 404, xphp);

  const xev = await api("GET", `/repairs/${repA}/events`, B.token);
  check("shop B GET shop A repair timeline -> 404", xev.status === 404, xev);

  const xpt = await api("GET", `/repairs/${repA}/parts`, B.token);
  check("shop B GET shop A repair parts -> 404", xpt.status === 404, xpt);

  const xptp = await api("POST", `/repairs/${repA}/parts`, B.token, {
    partName: "HACK part",
    quantity: 1,
    unitCost: 10,
  });
  check("shop B POST part on shop A repair -> 400/404", xptp.status === 404 || xptp.status === 400, xptp);

  // ── Verify nothing was mutated by the rejected attempts ──────────────────
  const after = await api("GET", "/customers", A.token);
  const cAfter = (after.json.customers ?? []).find((c) => c.id === custA);
  check("shop A customer unchanged after attacks", cAfter?.name === "Shop A Customer", cAfter);
  const afterR = await api("GET", "/repairs", A.token);
  const rAfter = (afterR.json.repairs ?? []).find((r) => r.id === repA);
  check(
    "shop A repair unchanged after attacks",
    rAfter && rAfter.status !== "cancelled" && rAfter.notes !== "HACKED",
    rAfter,
  );
}

async function main() {
  const [A, B] = [await seedTestShop("A"), await seedTestShop("B")];
  const child = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "test" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await sleep(1000);
      up = await fetch(`${BASE}/healthz`)
        .then((r) => r.status > 0)
        .catch(() => false);
    }
    if (!up) throw new Error("server did not start");
    await run(A, B);
  } finally {
    child.kill("SIGTERM");
    await cleanup(A.userId).catch((err) => console.error("cleanup A failed:", err));
    await cleanup(B.userId).catch((err) => console.error("cleanup B failed:", err));
    await pool.end();
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll shop isolation checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
