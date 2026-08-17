// Export one shop's data from the development database and import it into
// the production server through POST /api/sync/import-bundle.
//
// Usage:
//   IMPORT_BUNDLE_TOKEN=<token> node scripts/sync-to-prod.mjs <shopId> [targetBaseUrl]
//
// Reads dev rows via DATABASE_URL (snake_case, exactly as stored) and POSTs
// them; the endpoint inserts with ON CONFLICT DO NOTHING, so reruns are safe
// and nothing on the target is ever modified or deleted.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dbPkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../lib/db");
const require = createRequire(path.join(dbPkgDir, "package.json"));
const { Pool } = require("pg");

const shopId = process.argv[2];
const base = (process.argv[3] || "https://vmc-enterprise-suite.replit.app").replace(/\/+$/, "");
const token = process.env.IMPORT_BUNDLE_TOKEN;
if (!shopId || !token || !process.env.DATABASE_URL) {
  console.error("Need <shopId> arg, IMPORT_BUNDLE_TOKEN and DATABASE_URL env");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (sql, params) => (await pool.query(sql, params)).rows;

const tables = {};
const bySshop = async (t) => q(`SELECT * FROM ${t} WHERE shop_id = $1`, [shopId]);
const byRepair = async (t) =>
  q(`SELECT c.* FROM ${t} c JOIN repairs r ON r.id = c.repair_id WHERE r.shop_id = $1`, [shopId]);

for (const t of ["customers", "dealers", "repairs", "inventory_items", "purchases",
  "finance_entries", "approval_requests", "estimate_approvals", "repair_returns", "stock_movements"]) {
  tables[t] = await bySshop(t);
}
for (const t of ["repair_photos", "repair_events", "repair_parts", "repair_payments"]) {
  tables[t] = await byRepair(t);
}
tables["return_parts"] = await q(
  `SELECT p.* FROM return_parts p JOIN repair_returns rr ON rr.id = p.return_id
   JOIN repairs r ON r.id = rr.repair_id WHERE r.shop_id = $1`, [shopId]);
tables["refunds"] = await q(
  `SELECT f.* FROM refunds f JOIN repairs r ON r.id = f.repair_id WHERE r.shop_id = $1`, [shopId]);

await pool.end();

const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
console.log("Exporting:", JSON.stringify(counts));

const res = await fetch(`${base}/api/sync/import-bundle`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-import-token": token },
  body: JSON.stringify({ shopId, tables }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("Import failed:", res.status, JSON.stringify(body));
  process.exit(1);
}
console.log("Import report:", JSON.stringify(body.report, null, 2));
