import { Router, type IRouter, json } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

// One-time data import used to move a shop's data from the old development
// server into production, so the same login sees the same data everywhere.
//
// Locked down hard:
// - The route is a 404 unless IMPORT_BUNDLE_TOKEN is set in the environment
//   (it is only set temporarily, in production, while the migration runs, and
//   removed right after).
// - The caller must present that exact token in the x-import-token header.
// - Rows may only target a shop that already exists here, every row must
//   carry that shop_id (child tables are verified through their repair), and
//   only allowlisted tables/columns are touched.
// - Inserts are ON CONFLICT DO NOTHING — nothing existing is ever modified
//   or deleted; reruns are safe.

// Parent tables carry shop_id directly. Child tables are scoped through
// their repair_id / return_id, which is validated to belong to the shop.
const SHOP_TABLES = [
  "customers", "dealers", "repairs", "inventory_items", "purchases",
  "finance_entries", "approval_requests", "estimate_approvals",
  "repair_returns", "stock_movements",
] as const;
const REPAIR_CHILD_TABLES = [
  "repair_photos", "repair_events", "repair_parts", "repair_payments",
] as const;
const RETURN_CHILD_TABLES = ["return_parts", "refunds"] as const;

// Insert order respects foreign keys.
const INSERT_ORDER: string[] = [
  "customers", "dealers", "repairs", "inventory_items", "purchases",
  "finance_entries", "approval_requests", "estimate_approvals",
  "repair_photos", "repair_events", "repair_parts", "repair_payments",
  "repair_returns", "return_parts", "refunds", "stock_movements",
];

const IDENT = /^[a-z_][a-z0-9_]*$/;

async function tableColumns(table: string): Promise<Set<string>> {
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(r.rows.map((row: any) => String(row.column_name)));
}

const router: IRouter = Router();

router.post(
  "/sync/import-bundle",
  json({ limit: "20mb" }),
  asyncHandler(async (req, res) => {
    const token = process.env.IMPORT_BUNDLE_TOKEN;
    if (!token || req.header("x-import-token") !== token) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const shopId = String(req.body?.shopId ?? "");
    const tables = req.body?.tables ?? {};
    if (!shopId || typeof tables !== "object") {
      res.status(400).json({ message: "shopId and tables required" });
      return;
    }
    const [shop] = (await pool.query(`SELECT id FROM shops WHERE id = $1`, [shopId])).rows;
    if (!shop) {
      res.status(400).json({ message: "Shop not found here" });
      return;
    }

    // ids of repairs/returns that belong to this shop (existing + imported).
    const shopRepairIds = new Set<string>(
      (await pool.query(`SELECT id FROM repairs WHERE shop_id = $1`, [shopId])).rows.map((r: any) => r.id),
    );
    const shopReturnIds = new Set<string>(
      (await pool.query(
        `SELECT rr.id FROM repair_returns rr JOIN repairs r ON r.id = rr.repair_id WHERE r.shop_id = $1`,
        [shopId],
      )).rows.map((r: any) => r.id),
    );

    const report: Record<string, { inserted: number; skipped: number; failed: number }> = {};

    for (const table of INSERT_ORDER) {
      const rows = tables[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const cols = await tableColumns(table);
      const stat = { inserted: 0, skipped: 0, failed: 0 };
      report[table] = stat;

      for (const raw of rows) {
        if (!raw || typeof raw !== "object") { stat.failed++; continue; }
        // Scope check.
        if ((SHOP_TABLES as readonly string[]).includes(table)) {
          if (raw.shop_id !== shopId) { stat.failed++; continue; }
        } else if ((REPAIR_CHILD_TABLES as readonly string[]).includes(table)) {
          if (!shopRepairIds.has(String(raw.repair_id))) { stat.failed++; continue; }
        } else if ((RETURN_CHILD_TABLES as readonly string[]).includes(table)) {
          if (!shopReturnIds.has(String(raw.return_id ?? "")) && !shopRepairIds.has(String(raw.repair_id ?? ""))) {
            stat.failed++; continue;
          }
        } else { stat.failed++; continue; }

        const keys = Object.keys(raw).filter((k) => IDENT.test(k) && cols.has(k));
        if (keys.length === 0) { stat.failed++; continue; }
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
        const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})
                     ON CONFLICT DO NOTHING RETURNING 1`;
        try {
          const r = await pool.query(sql, keys.map((k) => (raw as any)[k]));
          if (r.rowCount && r.rowCount > 0) {
            stat.inserted++;
            if (table === "repairs") shopRepairIds.add(String(raw.id));
            if (table === "repair_returns") shopReturnIds.add(String(raw.id));
          } else {
            stat.skipped++;
            // Row already existed — still usable as a parent.
            if (table === "repairs") shopRepairIds.add(String(raw.id));
            if (table === "repair_returns") shopReturnIds.add(String(raw.id));
          }
        } catch {
          stat.failed++; // FK/validation problem — leave it out, keep going
        }
      }
    }

    res.json({ ok: true, report });
  }),
);

export default router;
