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
    if (b.receiveDate !== undefined) patch.receiveDate = str(b.receiveDate) ?? undefined;
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
          date: str(b.date) ?? new Date().toISOString().split("T")[0],
        })
        .returning();
      return row;
    });
    res.json({ purchase: purchaseOut(created) });
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
    const [created] = await db
      .insert(financeEntriesTable)
      .values({
        shopId,
        type: b.type,
        category,
        amount,
        description: str(b.description) ?? "",
        paymentMethod: str(b.paymentMethod) ?? "Cash",
        date: str(b.date) ?? new Date().toISOString().split("T")[0],
      })
      .returning();
    res.json({ entry: financeOut(created) });
  }),
);

export default router;
