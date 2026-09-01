// Focused API-level checks for the append-only customer khata ledger.
// Usage: pnpm run build && node scripts/test-customer-khata.mjs
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dbPkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../lib/db");
const require = createRequire(path.join(dbPkgDir, "package.json"));
const { Pool } = require("pg");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");

const port = 5643, base = `http://localhost:${port}/api`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) console.log(`  PASS ${label}`);
  else { failures++; console.error(`  FAIL ${label} — ${JSON.stringify(detail)}`); }
};
async function api(method, pathname, token, body) {
  const response = await fetch(`${base}${pathname}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
async function seed() {
  const n = Math.floor(Math.random() * 1e6), client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [user] } = await client.query(
      `INSERT INTO users (name,email,mobile,password_hash,role,is_active)
       VALUES ('Khata Test Dealer',$1,$2,'x','dealer',true) RETURNING id`,
      [`khata-${n}@example.test`, String(9200000000 + n)],
    );
    const { rows: [shop] } = await client.query(
      `INSERT INTO shops (dealer_id,business_name) VALUES ($1,'Khata Test Shop') RETURNING id`, [user.id],
    );
    await client.query("UPDATE users SET shop_id=$1 WHERE id=$2", [shop.id, user.id]);
    const token = randomBytes(32).toString("hex");
    await client.query(
      "INSERT INTO sessions (token,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
      [token, user.id],
    );
    await client.query("COMMIT");
    return { token, userId: user.id };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
async function run(token) {
  const customer = await api("POST", "/customers", token, { name: "Khata Customer", mobile: "9300000000" });
  const id = customer.json.customer?.id;
  check("create customer", customer.status === 200 && id, customer);
  const payload = { direction: "given", amount: 250, method: "Cash", bookDate: new Date().toISOString().slice(0, 10), clientRequestId: "khata-test-idempotency" };
  const first = await api("POST", `/customers/${id}/khata/transactions`, token, payload);
  check("append manual transaction", first.status === 201 && first.json.transaction?.amount === 250, first);
  const retry = await api("POST", `/customers/${id}/khata/transactions`, token, payload);
  check("idempotent retry returns same row", retry.status === 200 && retry.json.transaction?.id === first.json.transaction?.id, retry);
  const received = await api("POST", `/customers/${id}/khata/transactions`, token, { ...payload, direction: "received", amount: 50, clientRequestId: "khata-test-received" });
  check("append received transaction", received.status === 201, received);
  const ledger = await api("GET", `/customers/${id}/khata`, token);
  check("ledger is chronological and balanced", ledger.status === 200 && ledger.json.ledger?.length === 2 && ledger.json.totals?.balance === 200 && ledger.json.customer?.dueAmount === 200, ledger.json);
  const future = await api("POST", `/customers/${id}/khata/transactions`, token, { ...payload, clientRequestId: "khata-test-future", bookDate: "2999-01-01" });
  check("future date rejected", future.status === 400 && future.json.code === "INVALID_DATE", future);
}
async function main() {
  const seeded = await seed();
  const child = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], { env: { ...process.env, PORT: String(port), NODE_ENV: "test" }, stdio: ["ignore", "ignore", "inherit"] });
  try {
    for (let i = 0; i < 30; i++) {
      if (await fetch(`${base}/healthz`).then((r) => r.ok).catch(() => false)) break;
      await sleep(1000);
    }
    await run(seeded.token);
  } finally {
    child.kill("SIGTERM");
    await pool.query("DELETE FROM users WHERE id=$1", [seeded.userId]);
    await pool.end();
  }
  if (failures) process.exit(1);
  console.log("\nAll customer khata checks passed");
}
main().catch((error) => { console.error(error); process.exit(1); });