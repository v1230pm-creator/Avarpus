import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  customersTable,
  repairsTable,
  repairPhotosTable,
  repairEventsTable,
  inventoryItemsTable,
  purchasesTable,
  financeEntriesTable,
  type DbUser,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import type { Request, Response } from "express";

// Shop-scoped business data: repairs, customers, inventory, purchases and
// finance entries. Every route requires an authenticated user with a shop —
// all reads/writes are filtered by that shopId so shops never see each
// other's data.

const router: IRouter = Router();

type AuthedRequest = Request & { user: DbUser };

function shopIdOr403(req: Request, res: Response): string | null {
  const me = (req as AuthedRequest).user;
  if (!me.shopId) {
    res.status(403).json({
      message: "Your account is not linked to a shop. Business data is only available for shop accounts.",
    });
    return null;
  }
  return me.shopId;
}

const iso = (d: Date) => d.toISOString();

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

const todayStr = () => new Date().toISOString().split("T")[0];

// Roles that may save backdated records directly. Staff must go through the
// approval workflow (/approvals) — enforced HERE on the server so the
// frontend cannot be bypassed.
const BACKDATE_EXEMPT_ROLES = ["dealer", "super_admin"];

export function backdateBlocked(req: Request, res: Response, dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const me = (req as AuthedRequest).user;
  if (BACKDATE_EXEMPT_ROLES.includes(me.role)) return false;
  if (dateStr < todayStr()) {
    res.status(403).json({
      message: "This is a backdated entry. Dealer/Owner approval is required.",
      code: "APPROVAL_REQUIRED",
    });
    return true;
  }
  return false;
}

// A book-keeping date must be a real YYYY-MM-DD calendar date and must not be
// in the future. Returns the normalized date string, or null after sending a
// 400 response with a clear message.
export function validBookDateOr400(res: Response, dateStr: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const bad = (msg: string) => {
    res.status(400).json({ message: msg, code: "INVALID_DATE" });
    return null;
  };
  if (!m) return bad("Date must be in YYYY-MM-DD format");
  const [, y, mo, d] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return bad("Date is not a valid calendar date");
  }
  if (dateStr > todayStr()) return bad("Date cannot be in the future");
  return dateStr;
}

// ── Customers ──────────────────────────────────────────────────────────────

function customerOut(c: typeof customersTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    mobile: c.mobile,
    email: c.email ?? undefined,
    address: c.address ?? undefined,
    dueAmount: c.dueAmount,
    totalRepairs: c.totalRepairs,
    isSample: c.isSample,
    createdAt: iso(c.createdAt),
  };
}

router.get(
  "/customers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const rows = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.shopId, shopId))
      .orderBy(asc(customersTable.createdAt));
    res.json({ customers: rows.map(customerOut) });
  }),
);

router.post(
  "/customers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const b = req.body ?? {};
    const name = str(b.name);
    const mobile = str(b.mobile);
    if (!name || !mobile) {
      res.status(400).json({ message: "Customer name and mobile are required" });
      return;
    }
    const [created] = await db
      .insert(customersTable)
      .values({
        shopId,
        name,
        mobile,
        email: str(b.email),
        address: str(b.address),
        // dueAmount and totalRepairs are derived from repairs server-side —
        // client-provided values are ignored.
      })
      .returning();
    res.json({ customer: customerOut(created) });
  }),
);

router.patch(
  "/customers/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const b = req.body ?? {};
    const patch: Partial<typeof customersTable.$inferInsert> = {};
    if (b.name !== undefined) patch.name = str(b.name) ?? undefined;
    if (b.mobile !== undefined) patch.mobile = str(b.mobile) ?? undefined;
    if (b.email !== undefined) patch.email = str(b.email);
    if (b.address !== undefined) patch.address = str(b.address);
    // dueAmount / totalRepairs are derived from repairs and cannot be patched.
    const [updated] = await db
      .update(customersTable)
      .set(patch)
      .where(and(eq(customersTable.id, String(req.params.id ?? "")), eq(customersTable.shopId, shopId)))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }
    res.json({ customer: customerOut(updated) });
  }),
);

// ── Repairs ────────────────────────────────────────────────────────────────

const REPAIR_STATUSES = [
  "received", "diagnosing", "waiting_parts", "repairing",
  "testing", "ready", "delivered", "cancelled",
] as const;
const REPAIR_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

// Append an immutable event row to a repair's timeline / audit log.
// Deliberately no update/delete endpoints — history cannot be edited.
async function logRepairEvent(
  dbOrTx: Pick<typeof db, "insert">,
  args: {
    shopId: string;
    repairId: string; // repairs.id (uuid)
    user: DbUser;
    action: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await dbOrTx.insert(repairEventsTable).values({
    shopId: args.shopId,
    repairId: args.repairId,
    userId: args.user.id,
    userName: args.user.name,
    userRole: args.user.role,
    action: args.action,
    details: args.details ?? null,
  });
}

// Recompute a customer's derived stats from their repairs:
// - totalRepairs: number of non-cancelled repairs linked to the customer
// - dueAmount: sum over delivered repairs of (repairCharge + partsCharge − advance),
//   clamped at 0 per repair so an overpaid advance never produces a negative due.
async function syncCustomerStats(
  tx: Pick<typeof db, "select" | "update">,
  shopId: string,
  customerId: string,
): Promise<void> {
  const [stats] = await tx
    .select({
      total: sql<number>`count(*) filter (where ${repairsTable.status} <> 'cancelled')::int`,
      due: sql<number>`coalesce(sum(greatest(${repairsTable.repairCharge} + ${repairsTable.partsCharge} - ${repairsTable.advance}, 0)) filter (where ${repairsTable.status} = 'delivered'), 0)::float`,
    })
    .from(repairsTable)
    .where(and(eq(repairsTable.shopId, shopId), eq(repairsTable.customerId, customerId)));
  await tx
    .update(customersTable)
    .set({ totalRepairs: stats?.total ?? 0, dueAmount: stats?.due ?? 0 })
    .where(and(eq(customersTable.id, customerId), eq(customersTable.shopId, shopId)));
}

function checklistOrNull(v: unknown): Record<string, boolean> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, boolean> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "boolean") out[k] = val;
  }
  return Object.keys(out).length ? out : null;
}

const WARRANTY_DAYS = [0, 7, 30, 90, 180] as const;

// An object path may only be attached if it lives in the caller's shop
// namespace (uploads are issued under /objects/uploads/<shopId>/...).
function ownedObjectPath(shopId: string, v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return s.startsWith(`/objects/uploads/${shopId}/`) ? s : null;
}

function repairOut(r: typeof repairsTable.$inferSelect) {
  return {
    id: r.id,
    repairId: r.repairId,
    customerId: r.customerId ?? undefined,
    customerName: r.customerName,
    mobile: r.mobile,
    deviceType: r.deviceType,
    brand: r.brand,
    model: r.model,
    imei: r.imei ?? undefined,
    problem: r.problem,
    technicianId: r.technicianId ?? undefined,
    technicianName: r.technicianName ?? undefined,
    status: r.status,
    priority: r.priority,
    repairCharge: r.repairCharge,
    partsCharge: r.partsCharge,
    advance: r.advance,
    receiveDate: r.receiveDate,
    expectedDate: r.expectedDate,
    deliveryDate: r.deliveryDate ?? undefined,
    notes: r.notes ?? undefined,
    checklist: (r.checklist as Record<string, boolean> | null) ?? undefined,
    receivingSignaturePath: r.receivingSignaturePath ?? undefined,
    deliverySignaturePath: r.deliverySignaturePath ?? undefined,
    warrantyDays: r.warrantyDays,
    warrantyExpiry: r.warrantyExpiry ?? undefined,
    isSample: r.isSample,
    createdAt: iso(r.createdAt),
  };
}

router.get(
  "/repairs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const rows = await db
      .select()
      .from(repairsTable)
      .where(eq(repairsTable.shopId, shopId))
      .orderBy(asc(repairsTable.createdAt));
    res.json({ repairs: rows.map(repairOut) });
  }),
);

router.post(
  "/repairs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const b = req.body ?? {};
    const customerName = str(b.customerName);
    const mobile = str(b.mobile);
    const deviceType = str(b.deviceType);
    const brand = str(b.brand);
    const model = str(b.model);
    const problem = str(b.problem);
    if (!customerName || !mobile || !deviceType || !brand || !model || !problem) {
      res.status(400).json({ message: "Missing required repair details" });
      return;
    }
    const status = REPAIR_STATUSES.includes(b.status) ? b.status : "received";
    const priority = REPAIR_PRIORITIES.includes(b.priority) ? b.priority : "normal";
    if (backdateBlocked(req, res, str(b.receiveDate))) return;

    // A repair may only be linked to a customer of the caller's own shop.
    let customerId = str(b.customerId);
    if (customerId) {
      const [cust] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(and(eq(customersTable.id, customerId), eq(customersTable.shopId, shopId)));
      if (!cust) {
        res.status(400).json({ message: "Customer not found in your shop" });
        return;
      }
    }

    const created = await db.transaction(async (tx) => {
      // Server-generated sequential ticket number, unique per shop.
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(repairsTable)
        .where(eq(repairsTable.shopId, shopId));
      const repairId = `VMC-${String(count + 1).padStart(3, "0")}`;
      const [row] = await tx
        .insert(repairsTable)
        .values({
          shopId,
          repairId,
          customerId,
          customerName,
          mobile,
          deviceType,
          brand,
          model,
          imei: str(b.imei),
          problem,
          technicianId: str(b.technicianId),
          technicianName: str(b.technicianName),
          status,
          priority,
          repairCharge: num(b.repairCharge),
          partsCharge: num(b.partsCharge),
          advance: num(b.advance),
          receiveDate: str(b.receiveDate) ?? new Date().toISOString().split("T")[0],
          expectedDate: str(b.expectedDate) ?? new Date().toISOString().split("T")[0],
          deliveryDate: str(b.deliveryDate),
          notes: str(b.notes),
          checklist: checklistOrNull(b.checklist),
          receivingSignaturePath: ownedObjectPath(shopId, b.receivingSignaturePath),
          warrantyDays: WARRANTY_DAYS.includes(b.warrantyDays) ? b.warrantyDays : 0,
        })
        .returning();
      await logRepairEvent(tx, {
        shopId,
        repairId: row.id,
        user: (req as AuthedRequest).user,
        action: "created",
        details: { ticket: row.repairId, status: row.status, priority: row.priority },
      });
      if (row.customerId) await syncCustomerStats(tx, shopId, row.customerId);
      return row;
    });
    res.json({ repair: repairOut(created) });
  }),
);

router.patch(
  "/repairs/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const b = req.body ?? {};
    const patch: Partial<typeof repairsTable.$inferInsert> = {};
    if (b.status !== undefined) {
      if (!REPAIR_STATUSES.includes(b.status)) {
        res.status(400).json({ message: "Invalid repair status" });
        return;
      }
      patch.status = b.status;
    }
    if (b.priority !== undefined) {
      if (!REPAIR_PRIORITIES.includes(b.priority)) {
        res.status(400).json({ message: "Invalid repair priority" });
        return;
      }
      patch.priority = b.priority;
    }
    if (b.customerName !== undefined) patch.customerName = str(b.customerName) ?? undefined;
    if (b.mobile !== undefined) patch.mobile = str(b.mobile) ?? undefined;
    if (b.deviceType !== undefined) patch.deviceType = str(b.deviceType) ?? undefined;
    if (b.brand !== undefined) patch.brand = str(b.brand) ?? undefined;
    if (b.model !== undefined) patch.model = str(b.model) ?? undefined;
    if (b.imei !== undefined) patch.imei = str(b.imei);
    if (b.problem !== undefined) patch.problem = str(b.problem) ?? undefined;
    if (b.technicianId !== undefined) patch.technicianId = str(b.technicianId);
    if (b.technicianName !== undefined) patch.technicianName = str(b.technicianName);
    if (b.repairCharge !== undefined) patch.repairCharge = num(b.repairCharge);
    if (b.partsCharge !== undefined) patch.partsCharge = num(b.partsCharge);
    if (b.advance !== undefined) patch.advance = num(b.advance);
    if (b.receiveDate !== undefined) {
      if (backdateBlocked(req, res, str(b.receiveDate))) return;
      patch.receiveDate = str(b.receiveDate) ?? undefined;
    }
    if (b.expectedDate !== undefined) patch.expectedDate = str(b.expectedDate) ?? undefined;
    if (b.deliveryDate !== undefined) patch.deliveryDate = str(b.deliveryDate);
    if (b.notes !== undefined) patch.notes = str(b.notes);
    if (b.checklist !== undefined) patch.checklist = checklistOrNull(b.checklist);
    if (b.receivingSignaturePath !== undefined) {
      const p = ownedObjectPath(shopId, b.receivingSignaturePath);
      if (!p) {
        res.status(400).json({ message: "Invalid signature path" });
        return;
      }
      patch.receivingSignaturePath = p;
    }
    if (b.deliverySignaturePath !== undefined) {
      const p = ownedObjectPath(shopId, b.deliverySignaturePath);
      if (!p) {
        res.status(400).json({ message: "Invalid signature path" });
        return;
      }
      patch.deliverySignaturePath = p;
    }
    if (b.warrantyDays !== undefined) {
      if (!WARRANTY_DAYS.includes(b.warrantyDays)) {
        res.status(400).json({ message: "Warranty must be 0, 7, 30, 90 or 180 days" });
        return;
      }
      patch.warrantyDays = b.warrantyDays;
    }
    const id = String(req.params.id ?? "");
    const [existing] = await db
      .select()
      .from(repairsTable)
      .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)));
    if (!existing) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    // Warranty expiry is computed when the repair is delivered.
    const effectiveWarrantyDays = patch.warrantyDays ?? existing.warrantyDays;
    if (patch.status === "delivered" && effectiveWarrantyDays > 0) {
      const deliveredOn = patch.deliveryDate ?? existing.deliveryDate ?? new Date().toISOString().split("T")[0];
      const expiry = new Date(`${deliveredOn}T00:00:00Z`);
      expiry.setUTCDate(expiry.getUTCDate() + effectiveWarrantyDays);
      patch.warrantyExpiry = expiry.toISOString().split("T")[0];
      if (patch.deliveryDate === undefined && !existing.deliveryDate) patch.deliveryDate = deliveredOn;
    }
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(repairsTable)
        .set(patch)
        .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)))
        .returning();
      const user = (req as AuthedRequest).user;
      if (patch.status !== undefined && patch.status !== existing.status) {
        await logRepairEvent(tx, {
          shopId, repairId: id, user,
          action: "status_changed",
          details: { from: existing.status, to: patch.status },
        });
      }
      if (patch.checklist !== undefined) {
        await logRepairEvent(tx, { shopId, repairId: id, user, action: "checklist_updated" });
      }
      if (patch.receivingSignaturePath || patch.deliverySignaturePath) {
        await logRepairEvent(tx, {
          shopId, repairId: id, user,
          action: "signature_captured",
          details: { stage: patch.deliverySignaturePath ? "delivery" : "receiving" },
        });
      }
      if (patch.technicianId !== undefined && patch.technicianId !== existing.technicianId) {
        await logRepairEvent(tx, {
          shopId, repairId: id, user,
          action: "assigned",
          details: { technicianName: patch.technicianName ?? null },
        });
      }
      // Charges, advance or status changes affect the linked customer's
      // derived due amount / repair count — recompute inside the same tx.
      if (
        row.customerId &&
        (patch.status !== undefined ||
          patch.repairCharge !== undefined ||
          patch.partsCharge !== undefined ||
          patch.advance !== undefined)
      ) {
        await syncCustomerStats(tx, shopId, row.customerId);
      }
      return row;
    });
    res.json({ repair: repairOut(updated) });
  }),
);

// ── Repair photos & timeline ────────────────────────────────────────────────

const PHOTO_KINDS = ["front", "back", "left", "right", "top", "bottom", "damage", "bill", "customer_id", "other"] as const;

async function repairInShop(shopId: string, id: string) {
  const [row] = await db
    .select({ id: repairsTable.id })
    .from(repairsTable)
    .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)));
  return row ?? null;
}

router.get(
  "/repairs/:id/photos",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const id = String(req.params.id ?? "");
    if (!(await repairInShop(shopId, id))) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    const rows = await db
      .select()
      .from(repairPhotosTable)
      .where(and(eq(repairPhotosTable.repairId, id), eq(repairPhotosTable.shopId, shopId)))
      .orderBy(asc(repairPhotosTable.createdAt));
    res.json({
      photos: rows.map((p) => ({
        id: p.id,
        repairId: p.repairId,
        kind: p.kind,
        objectPath: p.objectPath,
        uploadedByName: p.uploadedByName ?? undefined,
        createdAt: iso(p.createdAt),
      })),
    });
  }),
);

router.post(
  "/repairs/:id/photos",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const id = String(req.params.id ?? "");
    if (!(await repairInShop(shopId, id))) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    const b = req.body ?? {};
    const kind = PHOTO_KINDS.includes(b.kind) ? b.kind : null;
    const objectPath = ownedObjectPath(shopId, b.objectPath);
    if (!kind || !objectPath) {
      res.status(400).json({ message: "kind and a valid objectPath from your own shop's uploads are required" });
      return;
    }
    const user = (req as AuthedRequest).user;
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(repairPhotosTable)
        .values({
          shopId,
          repairId: id,
          kind,
          objectPath,
          uploadedById: user.id,
          uploadedByName: user.name,
        })
        .returning();
      await logRepairEvent(tx, {
        shopId, repairId: id, user,
        action: "photo_added",
        details: { kind },
      });
      return row;
    });
    res.json({
      photo: {
        id: created.id,
        repairId: created.repairId,
        kind: created.kind,
        objectPath: created.objectPath,
        uploadedByName: created.uploadedByName ?? undefined,
        createdAt: iso(created.createdAt),
      },
    });
  }),
);

router.get(
  "/repairs/:id/events",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const id = String(req.params.id ?? "");
    if (!(await repairInShop(shopId, id))) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    const rows = await db
      .select()
      .from(repairEventsTable)
      .where(and(eq(repairEventsTable.repairId, id), eq(repairEventsTable.shopId, shopId)))
      .orderBy(desc(repairEventsTable.createdAt));
    res.json({
      events: rows.map((e) => ({
        id: e.id,
        repairId: e.repairId,
        userId: e.userId ?? undefined,
        userName: e.userName,
        userRole: e.userRole,
        action: e.action,
        details: (e.details as Record<string, unknown> | null) ?? undefined,
        createdAt: iso(e.createdAt),
      })),
    });
  }),
);

// ── Inventory ──────────────────────────────────────────────────────────────

const INVENTORY_CATEGORIES = ["product", "accessory", "spare_part"] as const;

function inventoryOut(i: typeof inventoryItemsTable.$inferSelect) {
  return {
    id: i.id,
    name: i.name,
    category: i.category,
    brand: i.brand,
    quantity: i.quantity,
    minStock: i.minStock,
    purchasePrice: i.purchasePrice,
    sellingPrice: i.sellingPrice,
    supplier: i.supplier ?? undefined,
    isSample: i.isSample,
    createdAt: iso(i.createdAt),
  };
}

router.get(
  "/inventory",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const rows = await db
      .select()
      .from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.shopId, shopId))
      .orderBy(asc(inventoryItemsTable.createdAt));
    res.json({ items: rows.map(inventoryOut) });
  }),
);

router.post(
  "/inventory",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const b = req.body ?? {};
    const name = str(b.name);
    const brand = str(b.brand);
    if (!name || !brand || !INVENTORY_CATEGORIES.includes(b.category)) {
      res.status(400).json({ message: "Item name, brand and a valid category are required" });
      return;
    }
    const [created] = await db
      .insert(inventoryItemsTable)
      .values({
        shopId,
        name,
        category: b.category,
        brand,
        quantity: Math.trunc(num(b.quantity)),
        minStock: Math.trunc(num(b.minStock)),
        purchasePrice: num(b.purchasePrice),
        sellingPrice: num(b.sellingPrice),
        supplier: str(b.supplier),
      })
      .returning();
    res.json({ item: inventoryOut(created) });
  }),
);

router.patch(
  "/inventory/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const b = req.body ?? {};
    const patch: Partial<typeof inventoryItemsTable.$inferInsert> = {};
    if (b.name !== undefined) patch.name = str(b.name) ?? undefined;
    if (b.category !== undefined) {
      if (!INVENTORY_CATEGORIES.includes(b.category)) {
        res.status(400).json({ message: "Invalid inventory category" });
        return;
      }
      patch.category = b.category;
    }
    if (b.brand !== undefined) patch.brand = str(b.brand) ?? undefined;
    if (b.quantity !== undefined) patch.quantity = Math.trunc(num(b.quantity));
    if (b.minStock !== undefined) patch.minStock = Math.trunc(num(b.minStock));
    if (b.purchasePrice !== undefined) patch.purchasePrice = num(b.purchasePrice);
    if (b.sellingPrice !== undefined) patch.sellingPrice = num(b.sellingPrice);
    if (b.supplier !== undefined) patch.supplier = str(b.supplier);
    const [updated] = await db
      .update(inventoryItemsTable)
      .set(patch)
      .where(and(eq(inventoryItemsTable.id, String(req.params.id ?? "")), eq(inventoryItemsTable.shopId, shopId)))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Inventory item not found" });
      return;
    }
    res.json({ item: inventoryOut(updated) });
  }),
);

// ── Purchases ──────────────────────────────────────────────────────────────

const PAYMENT_STATUSES = ["paid", "unpaid", "partial"] as const;

function purchaseOut(p: typeof purchasesTable.$inferSelect) {
  return {
    id: p.id,
    purchaseId: p.purchaseId,
    invoiceNo: p.invoiceNo,
    supplier: p.supplier,
    supplierMobile: p.supplierMobile ?? undefined,
    itemName: p.itemName,
    quantity: p.quantity,
    purchasePrice: p.purchasePrice,
    total: p.total,
    paymentStatus: p.paymentStatus,
    paymentMethod: p.paymentMethod,
    date: p.date,
    isSample: p.isSample,
    createdAt: iso(p.createdAt),
  };
}

router.get(
  "/purchases",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const rows = await db
      .select()
      .from(purchasesTable)
      .where(eq(purchasesTable.shopId, shopId))
      .orderBy(asc(purchasesTable.createdAt));
    res.json({ purchases: rows.map(purchaseOut) });
  }),
);

router.post(
  "/purchases",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const b = req.body ?? {};
    const supplier = str(b.supplier);
    const itemName = str(b.itemName);
    if (!supplier || !itemName) {
      res.status(400).json({ message: "Supplier and item name are required" });
      return;
    }
    const paymentStatus = PAYMENT_STATUSES.includes(b.paymentStatus) ? b.paymentStatus : "unpaid";
    let purchaseDate = todayStr();
    if (b.date !== undefined) {
      const raw = typeof b.date === "string" ? b.date.trim() : "";
      if (!raw) {
        res.status(400).json({ message: "Date must be in YYYY-MM-DD format", code: "INVALID_DATE" });
        return;
      }
      if (!validBookDateOr400(res, raw)) return;
      if (backdateBlocked(req, res, raw)) return;
      purchaseDate = raw;
    }

    const created = await db.transaction(async (tx) => {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(purchasesTable)
        .where(eq(purchasesTable.shopId, shopId));
      const purchaseId = `PUR-${String(count + 1).padStart(3, "0")}`;
      const [row] = await tx
        .insert(purchasesTable)
        .values({
          shopId,
          purchaseId,
          invoiceNo: str(b.invoiceNo) ?? "",
          supplier,
          supplierMobile: str(b.supplierMobile),
          itemName,
          quantity: Math.trunc(num(b.quantity)),
          purchasePrice: num(b.purchasePrice),
          total: num(b.total),
          paymentStatus,
          paymentMethod: str(b.paymentMethod) ?? "Cash",
          date: purchaseDate,
        })
        .returning();
      return row;
    });
    res.json({ purchase: purchaseOut(created) });
  }),
);

router.patch(
  "/purchases/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const b = req.body ?? {};
    const patch: Partial<typeof purchasesTable.$inferInsert> = {};
    if (b.invoiceNo !== undefined) patch.invoiceNo = str(b.invoiceNo) ?? "";
    if (b.supplier !== undefined) patch.supplier = str(b.supplier) ?? undefined;
    if (b.supplierMobile !== undefined) patch.supplierMobile = str(b.supplierMobile);
    if (b.itemName !== undefined) patch.itemName = str(b.itemName) ?? undefined;
    if (b.quantity !== undefined) patch.quantity = Math.trunc(num(b.quantity));
    if (b.purchasePrice !== undefined) patch.purchasePrice = num(b.purchasePrice);
    if (b.total !== undefined) patch.total = num(b.total);
    if (b.paymentStatus !== undefined) {
      if (!PAYMENT_STATUSES.includes(b.paymentStatus)) {
        res.status(400).json({ message: "Invalid payment status" });
        return;
      }
      patch.paymentStatus = b.paymentStatus;
    }
    if (b.paymentMethod !== undefined) patch.paymentMethod = str(b.paymentMethod) ?? "Cash";
    if (b.date !== undefined) {
      const dateRaw = str(b.date);
      if (!dateRaw || !validBookDateOr400(res, dateRaw)) {
        if (!dateRaw) res.status(400).json({ message: "Date must be in YYYY-MM-DD format", code: "INVALID_DATE" });
        return;
      }
      if (backdateBlocked(req, res, dateRaw)) return;
      patch.date = dateRaw;
    }
    const [updated] = await db
      .update(purchasesTable)
      .set(patch)
      .where(and(eq(purchasesTable.id, String(req.params.id ?? "")), eq(purchasesTable.shopId, shopId)))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Purchase not found" });
      return;
    }
    res.json({ purchase: purchaseOut(updated) });
  }),
);

// ── Finance ────────────────────────────────────────────────────────────────

function financeOut(f: typeof financeEntriesTable.$inferSelect) {
  return {
    id: f.id,
    type: f.type,
    category: f.category,
    amount: f.amount,
    description: f.description,
    paymentMethod: f.paymentMethod,
    date: f.date,
    isSample: f.isSample,
    createdAt: iso(f.createdAt),
  };
}

router.get(
  "/finance",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const rows = await db
      .select()
      .from(financeEntriesTable)
      .where(eq(financeEntriesTable.shopId, shopId))
      .orderBy(asc(financeEntriesTable.createdAt));
    res.json({ entries: rows.map(financeOut) });
  }),
);

router.post(
  "/finance",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const b = req.body ?? {};
    const category = str(b.category);
    const amount = num(b.amount, NaN);
    if ((b.type !== "income" && b.type !== "expense") || !category || !Number.isFinite(amount)) {
      res.status(400).json({ message: "Entry type, category and amount are required" });
      return;
    }
    let financeDate = todayStr();
    if (b.date !== undefined) {
      const raw = typeof b.date === "string" ? b.date.trim() : "";
      if (!raw) {
        res.status(400).json({ message: "Date must be in YYYY-MM-DD format", code: "INVALID_DATE" });
        return;
      }
      if (!validBookDateOr400(res, raw)) return;
      if (backdateBlocked(req, res, raw)) return;
      financeDate = raw;
    }
    const [created] = await db
      .insert(financeEntriesTable)
      .values({
        shopId,
        type: b.type,
        category,
        amount,
        description: str(b.description) ?? "",
        paymentMethod: str(b.paymentMethod) ?? "Cash",
        date: financeDate,
      })
      .returning();
    res.json({ entry: financeOut(created) });
  }),
);

router.patch(
  "/finance/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const b = req.body ?? {};
    const patch: Partial<typeof financeEntriesTable.$inferInsert> = {};
    if (b.type !== undefined) {
      if (b.type !== "income" && b.type !== "expense") {
        res.status(400).json({ message: "Invalid entry type" });
        return;
      }
      patch.type = b.type;
    }
    if (b.category !== undefined) patch.category = str(b.category) ?? undefined;
    if (b.amount !== undefined) {
      const amount = num(b.amount, NaN);
      if (!Number.isFinite(amount)) {
        res.status(400).json({ message: "Invalid amount" });
        return;
      }
      patch.amount = amount;
    }
    if (b.description !== undefined) patch.description = str(b.description) ?? "";
    if (b.paymentMethod !== undefined) patch.paymentMethod = str(b.paymentMethod) ?? "Cash";
    if (b.date !== undefined) {
      const dateRaw = str(b.date);
      if (!dateRaw || !validBookDateOr400(res, dateRaw)) {
        if (!dateRaw) res.status(400).json({ message: "Date must be in YYYY-MM-DD format", code: "INVALID_DATE" });
        return;
      }
      if (backdateBlocked(req, res, dateRaw)) return;
      patch.date = dateRaw;
    }
    const [updated] = await db
      .update(financeEntriesTable)
      .set(patch)
      .where(and(eq(financeEntriesTable.id, String(req.params.id ?? "")), eq(financeEntriesTable.shopId, shopId)))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Finance entry not found" });
      return;
    }
    res.json({ entry: financeOut(updated) });
  }),
);

// ── Sample data ────────────────────────────────────────────────────────────
// One-tap demo dataset so a new dealer can explore the app before entering
// real records. Every seeded row is flagged is_sample=true and scoped to the
// caller's own shop, so it can be removed with one tap without touching any
// real data.

const dateStr = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
};
const ts = (daysAgo: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d;
};

router.post(
  "/sample-data",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const user = (req as AuthedRequest).user;

    // Refuse to double-seed: one sample set per shop at a time.
    const [existing] = await db
      .select({ id: repairsTable.id })
      .from(repairsTable)
      .where(and(eq(repairsTable.shopId, shopId), eq(repairsTable.isSample, true)))
      .limit(1);
    if (existing) {
      res.status(409).json({ message: "Sample data is already loaded. Clear it before loading again." });
      return;
    }

    await db.transaction(async (tx) => {
      // Customers
      const customerSeeds = [
        { name: "Ramesh Kumar (Sample)", mobile: "9876500001", email: "ramesh.sample@example.com", address: "12 MG Road, Bengaluru" },
        { name: "Priya Sharma (Sample)", mobile: "9876500002", email: "priya.sample@example.com", address: "45 Park Street, Bengaluru" },
        { name: "Abdul Rahim (Sample)", mobile: "9876500003", address: "8 Market Lane, Bengaluru" },
        { name: "Sunita Devi (Sample)", mobile: "9876500004", address: "23 Temple Road, Bengaluru" },
        { name: "Vikram Singh (Sample)", mobile: "9876500005", email: "vikram.sample@example.com", address: "67 Lake View, Bengaluru" },
      ];
      const customers = await tx
        .insert(customersTable)
        .values(customerSeeds.map((c, i) => ({ ...c, shopId, isSample: true, createdAt: ts(9 - i) })))
        .returning();

      // Repairs — statuses spread across the pipeline, dates across the last
      // week so the dashboard chart and pipeline have something to show.
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(repairsTable)
        .where(eq(repairsTable.shopId, shopId));
      const repairSeeds = [
        { c: 0, deviceType: "Mobile", brand: "Samsung", model: "Galaxy S21", problem: "Cracked screen replacement", status: "delivered", priority: "normal", repairCharge: 3500, partsCharge: 4200, advance: 2000, days: 8, delivered: 5 },
        { c: 1, deviceType: "Mobile", brand: "Apple", model: "iPhone 12", problem: "Battery draining fast", status: "delivered", priority: "high", repairCharge: 1200, partsCharge: 2800, advance: 4000, days: 7, delivered: 4 },
        { c: 2, deviceType: "Laptop", brand: "Dell", model: "Inspiron 15", problem: "Not powering on", status: "ready", priority: "urgent", repairCharge: 2500, partsCharge: 1800, advance: 1000, days: 5 },
        { c: 3, deviceType: "TV", brand: "LG", model: "43UM7300", problem: "No display, sound OK", status: "repairing", priority: "normal", repairCharge: 1800, partsCharge: 2200, advance: 500, days: 4 },
        { c: 4, deviceType: "Mobile", brand: "Xiaomi", model: "Redmi Note 10", problem: "Charging port not working", status: "waiting_parts", priority: "normal", repairCharge: 600, partsCharge: 450, advance: 0, days: 3 },
        { c: 0, deviceType: "Tablet", brand: "Samsung", model: "Galaxy Tab A8", problem: "Touch not responding", status: "diagnosing", priority: "low", repairCharge: 0, partsCharge: 0, advance: 0, days: 1 },
        { c: 1, deviceType: "Mobile", brand: "OnePlus", model: "Nord CE 3", problem: "Speaker crackling", status: "received", priority: "normal", repairCharge: 0, partsCharge: 0, advance: 0, days: 0 },
      ] as const;
      let n = count;
      for (const s of repairSeeds) {
        n += 1;
        const cust = customers[s.c];
        const [row] = await tx
          .insert(repairsTable)
          .values({
            shopId,
            repairId: `VMC-${String(n).padStart(3, "0")}`,
            customerId: cust.id,
            customerName: cust.name,
            mobile: cust.mobile,
            deviceType: s.deviceType,
            brand: s.brand,
            model: s.model,
            problem: s.problem,
            status: s.status,
            priority: s.priority,
            repairCharge: s.repairCharge,
            partsCharge: s.partsCharge,
            advance: s.advance,
            receiveDate: dateStr(s.days),
            expectedDate: dateStr(Math.max(s.days - 3, 0)),
            deliveryDate: "delivered" in s && (s as { delivered?: number }).delivered !== undefined ? dateStr((s as { delivered: number }).delivered) : null,
            notes: "Sample data",
            warrantyDays: s.status === "delivered" ? 30 : 0,
            warrantyExpiry: null,
            isSample: true,
            createdAt: ts(s.days),
          })
          .returning();
        await logRepairEvent(tx, {
          shopId,
          repairId: row.id,
          user,
          action: "created",
          details: { ticket: row.repairId, status: row.status, priority: row.priority, sample: true },
        });
      }
      for (const cust of customers) {
        await syncCustomerStats(tx, shopId, cust.id);
      }

      // Inventory (one item deliberately below min stock)
      await tx.insert(inventoryItemsTable).values(
        [
          { name: "iPhone 12 Battery", category: "spare_part", brand: "Apple", quantity: 8, minStock: 3, purchasePrice: 1800, sellingPrice: 2800, supplier: "Sri Balaji Distributors" },
          { name: "Samsung S21 Display", category: "spare_part", brand: "Samsung", quantity: 2, minStock: 3, purchasePrice: 3200, sellingPrice: 4200, supplier: "Sri Balaji Distributors" },
          { name: "USB-C Fast Charger 25W", category: "accessory", brand: "Samsung", quantity: 15, minStock: 5, purchasePrice: 650, sellingPrice: 999, supplier: "Metro Mobile Parts" },
          { name: "Tempered Glass (Universal)", category: "accessory", brand: "Generic", quantity: 40, minStock: 10, purchasePrice: 30, sellingPrice: 149, supplier: "Metro Mobile Parts" },
          { name: "Bluetooth Earbuds Pro", category: "product", brand: "boAt", quantity: 6, minStock: 2, purchasePrice: 1100, sellingPrice: 1799, supplier: "Metro Mobile Parts" },
        ].map((i, idx) => ({ ...i, shopId, isSample: true, createdAt: ts(6 - idx) })),
      );

      // Purchases
      const [{ count: pCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(purchasesTable)
        .where(eq(purchasesTable.shopId, shopId));
      await tx.insert(purchasesTable).values(
        [
          { invoiceNo: "INV-2201", supplier: "Sri Balaji Distributors", supplierMobile: "9812340001", itemName: "iPhone 12 Battery x10", quantity: 10, purchasePrice: 1800, total: 18000, paymentStatus: "paid", paymentMethod: "UPI", days: 6 },
          { invoiceNo: "INV-2214", supplier: "Sri Balaji Distributors", supplierMobile: "9812340001", itemName: "Samsung S21 Display x5", quantity: 5, purchasePrice: 3200, total: 16000, paymentStatus: "partial", paymentMethod: "Bank Transfer", days: 4 },
          { invoiceNo: "INV-0987", supplier: "Metro Mobile Parts", supplierMobile: "9812340002", itemName: "Chargers & accessories", quantity: 25, purchasePrice: 400, total: 10000, paymentStatus: "unpaid", paymentMethod: "Credit", days: 2 },
        ].map((p, idx) => ({
          shopId,
          purchaseId: `PUR-${String(pCount + idx + 1).padStart(3, "0")}`,
          invoiceNo: p.invoiceNo,
          supplier: p.supplier,
          supplierMobile: p.supplierMobile,
          itemName: p.itemName,
          quantity: p.quantity,
          purchasePrice: p.purchasePrice,
          total: p.total,
          paymentStatus: p.paymentStatus,
          paymentMethod: p.paymentMethod,
          date: dateStr(p.days),
          isSample: true,
          createdAt: ts(p.days),
        })),
      );

      // Finance — income/expense spread across the week including today
      await tx.insert(financeEntriesTable).values(
        [
          { type: "income", category: "Repair Charges", amount: 7700, description: "Galaxy S21 screen replacement (VMC sample)", paymentMethod: "UPI", days: 5 },
          { type: "income", category: "Repair Charges", amount: 4000, description: "iPhone 12 battery replacement (sample)", paymentMethod: "Cash", days: 4 },
          { type: "income", category: "Accessory Sales", amount: 1799, description: "Bluetooth earbuds sale (sample)", paymentMethod: "Card", days: 2 },
          { type: "expense", category: "Parts Purchase", amount: 18000, description: "Battery stock from distributor (sample)", paymentMethod: "UPI", days: 6 },
          { type: "expense", category: "Utilities", amount: 2400, description: "Electricity bill (sample)", paymentMethod: "UPI", days: 3 },
          { type: "income", category: "Repair Charges", amount: 1500, description: "Advance received for Dell laptop (sample)", paymentMethod: "Cash", days: 1 },
          { type: "income", category: "Accessory Sales", amount: 999, description: "Fast charger sale (sample)", paymentMethod: "UPI", days: 0 },
          { type: "expense", category: "Shop Rent", amount: 5000, description: "Weekly rent share (sample)", paymentMethod: "Bank Transfer", days: 0 },
        ].map((f) => ({
          shopId,
          type: f.type,
          category: f.category,
          amount: f.amount,
          description: f.description,
          paymentMethod: f.paymentMethod,
          date: dateStr(f.days),
          isSample: true,
          createdAt: ts(f.days, 12),
        })),
      );
    });

    res.json({ message: "Sample data loaded" });
  }),
);

router.delete(
  "/sample-data",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    await db.transaction(async (tx) => {
      // Repairs first (cascades their events/photos), then the rest.
      await tx
        .delete(repairsTable)
        .where(and(eq(repairsTable.shopId, shopId), eq(repairsTable.isSample, true)));
      // A dealer may have created *real* repairs against a sample customer.
      // Deleting that customer would null the real repair's link — so promote
      // any still-referenced sample customer to a real record instead, and
      // recompute its derived stats now that its sample repairs are gone.
      const referenced = await tx
        .selectDistinct({ id: customersTable.id })
        .from(customersTable)
        .innerJoin(repairsTable, eq(repairsTable.customerId, customersTable.id))
        .where(and(eq(customersTable.shopId, shopId), eq(customersTable.isSample, true)));
      for (const { id } of referenced) {
        await tx
          .update(customersTable)
          .set({ isSample: false })
          .where(and(eq(customersTable.id, id), eq(customersTable.shopId, shopId)));
        await syncCustomerStats(tx, shopId, id);
      }
      await tx
        .delete(customersTable)
        .where(and(eq(customersTable.shopId, shopId), eq(customersTable.isSample, true)));
      await tx
        .delete(inventoryItemsTable)
        .where(and(eq(inventoryItemsTable.shopId, shopId), eq(inventoryItemsTable.isSample, true)));
      await tx
        .delete(purchasesTable)
        .where(and(eq(purchasesTable.shopId, shopId), eq(purchasesTable.isSample, true)));
      await tx
        .delete(financeEntriesTable)
        .where(and(eq(financeEntriesTable.shopId, shopId), eq(financeEntriesTable.isSample, true)));
    });
    res.json({ message: "Sample data cleared" });
  }),
);

export default router;
