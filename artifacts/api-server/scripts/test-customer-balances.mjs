// API-level tests for customer balance derivation (syncCustomerStats).
// Usage: pnpm run build && node scripts/test-customer-balances.mjs
//
// Seeds a throwaway dealer + shop + session directly in the database,
// spawns the built server, drives the repairs API over HTTP and asserts on
// the customer's derived dueAmount / totalRepairs after each step:
//   create -> deliver -> edit charges after delivery -> over-advance -> cancel
// All seeded rows are removed at the end (users cascade to shop -> data).
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

const PORT = 5642;
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

// Read the customer's derived stats through the API (same lens the app uses).
async function customerStats(token, customerId) {
  const { status, json } = await api("GET", "/customers", token);
  if (status !== 200) throw new Error(`GET /customers -> ${status}`);
  const c = (json.customers ?? []).find((x) => x.id === customerId);
  if (!c) throw new Error("test customer not found");
  return { due: c.dueAmount, total: c.totalRepairs };
}

async function seedTestShop() {
  const n = Math.floor(Math.random() * 1e6);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const {
      rows: [user],
    } = await client.query(
      `INSERT INTO users (name, email, mobile, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'x', 'dealer', true) RETURNING id`,
      ["Balance Test Dealer", `balance-test-${n}@example.com`, String(9100000000 + n)],
    );
    const {
      rows: [shop],
    } = await client.query(
      `INSERT INTO shops (dealer_id, business_name) VALUES ($1, 'Balance Test Shop') RETURNING id`,
      [user.id],
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
  // users -> shops (dealer_id cascade) -> customers/repairs/sessions cascade.
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

async function run(token) {
  // Create a customer — derived fields start at zero.
  const { status: cs, json: cj } = await api("POST", "/customers", token, {
    name: "Balance Cust",
    mobile: "9199999999",
  });
  check("create customer", cs === 200 && cj.customer?.id, { cs, cj });
  const customerId = cj.customer.id;
  let s = await customerStats(token, customerId);
  check("new customer starts at 0/0", s.due === 0 && s.total === 0, s);

  // 1) Create repair -> totalRepairs increments, due unchanged (not delivered).
  const mkRepair = (extra) =>
    api("POST", "/repairs", token, {
      customerId,
      customerName: "Balance Cust",
      mobile: "9199999999",
      deviceType: "mobile",
      brand: "TestBrand",
      model: "T1",
      problem: "does not boot",
      ...extra,
    });
  const { status: r1s, json: r1j } = await mkRepair({ repairCharge: 500, partsCharge: 200, advance: 100 });
  check("create repair 1", r1s === 200 && r1j.repair?.id, { r1s, r1j });
  const repair1 = r1j.repair.id;
  s = await customerStats(token, customerId);
  check("after create: total=1, due=0 (not delivered)", s.total === 1 && s.due === 0, s);

  // 2) Deliver -> due = charges - advance = 500 + 200 - 100 = 600.
  const { status: d1s } = await api("PATCH", `/repairs/${repair1}`, token, { status: "delivered" });
  check("deliver repair 1", d1s === 200, { d1s });
  s = await customerStats(token, customerId);
  check("after deliver: due=600", s.total === 1 && s.due === 600, s);

  // 3) Edit charges after delivery -> due updates: 800 + 200 - 100 = 900.
  const { status: e1s } = await api("PATCH", `/repairs/${repair1}`, token, { repairCharge: 800 });
  check("edit charges after delivery", e1s === 200, { e1s });
  s = await customerStats(token, customerId);
  check("after edit: due=900", s.total === 1 && s.due === 900, s);

  // 4) Over-advance: repair 2 delivered with advance > charges is clamped at 0
  //    per repair, so the customer's due is unaffected (stays 900, total 2).
  const { status: r2s, json: r2j } = await mkRepair({ repairCharge: 200, partsCharge: 100, advance: 1000 });
  check("create repair 2", r2s === 200 && r2j.repair?.id, { r2s, r2j });
  const repair2 = r2j.repair.id;
  const { status: d2s } = await api("PATCH", `/repairs/${repair2}`, token, { status: "delivered" });
  check("deliver repair 2 (over-advance)", d2s === 200, { d2s });
  s = await customerStats(token, customerId);
  check("over-advance clamps at 0: total=2, due=900", s.total === 2 && s.due === 900, s);

  // 5) Cancel repair 1 -> its count and due contribution drop:
  //    total 1 (only repair 2), due 0 (repair 2's due is clamped at 0).
  const { status: c1s } = await api("PATCH", `/repairs/${repair1}`, token, { status: "cancelled" });
  check("cancel repair 1", c1s === 200, { c1s });
  s = await customerStats(token, customerId);
  check("after cancel: total=1, due=0", s.total === 1 && s.due === 0, s);

  // 6) Un-cancel back to delivered -> stats are restored (recompute is total,
  //    not incremental, so any status transition lands on the right numbers).
  const { status: u1s } = await api("PATCH", `/repairs/${repair1}`, token, { status: "delivered" });
  check("restore repair 1 to delivered", u1s === 200, { u1s });
  s = await customerStats(token, customerId);
  check("after restore: total=2, due=900", s.total === 2 && s.due === 900, s);
}

async function main() {
  const seeded = await seedTestShop();
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
    await run(seeded.token);
  } finally {
    child.kill("SIGTERM");
    await cleanup(seeded.userId).catch((err) => console.error("cleanup failed:", err));
    await pool.end();
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll customer balance checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
