import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  customersTable,
  repairsTable,
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
        dueAmount: num(b.dueAmount),
        totalRepairs: Math.trunc(num(b.totalRepairs)),
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
    if (b.dueAmount !== undefined) patch.dueAmount = num(b.dueAmount);
    if (b.totalRepairs !== undefined) patch.totalRepairs = Math.trunc(num(b.totalRepairs));
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
          customerId: str(b.customerId),
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
        })
        .returning();
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
    const [updated] = await db
      .update(repairsTable)
      .set(patch)
      .where(and(eq(repairsTable.id, String(req.params.id ?? "")), eq(repairsTable.shopId, shopId)))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    res.json({ repair: repairOut(updated) });
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
