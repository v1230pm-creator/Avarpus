import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  customersTable,
  dealersTable,
  repairsTable,
  repairPhotosTable,
  repairPartsTable,
  repairEventsTable,
  repairPaymentsTable,
  stockMovementsTable,
  estimateApprovalsTable,
  customerOtpCodesTable,
  repairReturnsTable,
  refundsTable,
  inventoryItemsTable,
  purchasesTable,
  financeEntriesTable,
  usersTable,
  type DbUser,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { sha256, generateOtpCode } from "../lib/authUtils";
import { sendOtpEmail } from "../lib/mailer";
import { recordPayment, PAYMENT_KINDS } from "../lib/repairPayments";
import { isDealerPortalRole } from "../lib/dealerPortal";
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

// Privileged roles: dealer + super_admin ONLY. Used for technician assignment,
// stock-movement visibility and cost visibility gating.
const PRIVILEGED_ROLES = ["dealer", "super_admin"];
function isPrivileged(req: Request): boolean {
  return PRIVILEGED_ROLES.includes((req as AuthedRequest).user.role);
}

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
    alternateMobile: c.alternateMobile ?? undefined,
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
        alternateMobile: str(b.alternateMobile),
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
    if (b.alternateMobile !== undefined) patch.alternateMobile = str(b.alternateMobile);
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
  "cannot_repair", "customer_approval",
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

// jsonb string[] — filters to non-empty strings; null if empty/invalid.
function stringListOrNull(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  return out.length ? out : null;
}

function checklistOrNull(v: unknown): Record<string, boolean> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, boolean> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "boolean") out[k] = val;
  }
  return Object.keys(out).length ? out : null;
}

// Warranty may be any whole number of days from 0 to 3650 (10 years).
function validWarrantyDays(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 3650) return null;
  return v;
}

// The subtotal + tax + total for a repair, derived from its charge fields.
// subtotal = repairCharge + partsCharge + serviceCharge + otherCharge − discount
// total    = subtotal + subtotal * taxPercent/100
function computeTotals(r: {
  repairCharge: number;
  partsCharge: number;
  serviceCharge: number;
  otherCharge: number;
  discount: number;
  taxPercent: number;
  advance: number;
}) {
  const subtotal = Math.max(
    r.repairCharge + r.partsCharge + r.serviceCharge + r.otherCharge - r.discount,
    0,
  );
  const tax = subtotal * (r.taxPercent / 100);
  const totalAmount = Math.round((subtotal + tax) * 100) / 100;
  const paidAmount = r.advance;
  const balance = Math.round((totalAmount - paidAmount) * 100) / 100;
  return { subtotal, tax, totalAmount, paidAmount, balance };
}

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
    dealerId: r.dealerId ?? undefined,
    dealerName: r.dealerName ?? undefined,
    dealerDetectedByPhone: r.dealerDetectedByPhone || undefined,
    deviceType: r.deviceType,
    brand: r.brand,
    model: r.model,
    imei: r.imei ?? undefined,
    imei2: r.imei2 ?? undefined,
    serialNumber: r.serialNumber ?? undefined,
    color: r.color ?? undefined,
    storage: r.storage ?? undefined,
    ram: r.ram ?? undefined,
    devicePassword: r.devicePassword ?? undefined,
    simPresent: r.simPresent,
    memoryCardPresent: r.memoryCardPresent,
    alternateMobile: r.alternateMobile ?? undefined,
    accessories: r.accessories ?? undefined,
    accessoriesList: (r.accessoriesList as string[] | null) ?? undefined,
    physicalCondition: (r.physicalCondition as Record<string, boolean> | null) ?? undefined,
    problem: r.problem,
    deviceCondition: r.deviceCondition ?? undefined,
    diagnosis: r.diagnosis ?? undefined,
    workPerformed: r.workPerformed ?? undefined,
    technicianId: r.technicianId ?? undefined,
    technicianName: r.technicianName ?? undefined,
    assignedById: r.assignedById ?? undefined,
    assignedByName: r.assignedByName ?? undefined,
    assignedAt: r.assignedAt ? iso(r.assignedAt) : undefined,
    status: r.status,
    priority: r.priority,
    repairCharge: r.repairCharge,
    partsCharge: r.partsCharge,
    serviceCharge: r.serviceCharge,
    otherCharge: r.otherCharge,
    discount: r.discount,
    taxPercent: r.taxPercent,
    advance: r.advance,
    testingChecklist: (r.testingChecklist as Record<string, boolean> | null) ?? undefined,
    testingConfirmedById: r.testingConfirmedById ?? undefined,
    testingConfirmedByName: r.testingConfirmedByName ?? undefined,
    testingConfirmedAt: r.testingConfirmedAt ? iso(r.testingConfirmedAt) : undefined,
    readyAt: r.readyAt ? iso(r.readyAt) : undefined,
    customerNotifiedAt: r.customerNotifiedAt ? iso(r.customerNotifiedAt) : undefined,
    clientRequestId: r.clientRequestId ?? undefined,
    receiveDate: r.receiveDate,
    expectedDate: r.expectedDate,
    deliveryDate: r.deliveryDate ?? undefined,
    notes: r.notes ?? undefined,
    checklist: (r.checklist as Record<string, boolean> | null) ?? undefined,
    receivingSignaturePath: r.receivingSignaturePath ?? undefined,
    deliverySignaturePath: r.deliverySignaturePath ?? undefined,
    warrantyDays: r.warrantyDays,
    warrantyExpiry: r.warrantyExpiry ?? undefined,
    receivedById: r.receivedById ?? undefined,
    receivedByName: r.receivedByName ?? undefined,
    deliveredById: r.deliveredById ?? undefined,
    deliveredByName: r.deliveredByName ?? undefined,
    paymentMethod: r.paymentMethod ?? undefined,
    repairStartedAt: r.repairStartedAt ? iso(r.repairStartedAt) : undefined,
    repairCompletedAt: r.repairCompletedAt ? iso(r.repairCompletedAt) : undefined,
    isSample: r.isSample,
    createdById: r.createdById ?? undefined,
    createdByName: r.createdByName ?? undefined,
    updatedById: r.updatedById ?? undefined,
    updatedByName: r.updatedByName ?? undefined,
    updatedAt: r.updatedAt ? iso(r.updatedAt) : undefined,
    createdAt: iso(r.createdAt),
    ...(() => {
      const t = computeTotals(r);
      return { totalAmount: t.totalAmount, paidAmount: t.paidAmount, balance: t.balance };
    })(),
  };
}

router.get(
  "/repairs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const q = req.query;
    const qstr = (k: string): string | null => {
      const v = q[k];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };

    const conds: SQL[] = [eq(repairsTable.shopId, shopId)];

    // Dealer-portal accounts only EVER see their own dealer's repairs —
    // enforced server-side regardless of any client-supplied filters.
    if (isDealerPortalRole(me.role)) {
      if (!me.dealerId) {
        res.status(403).json({ message: "Your dealer account is not linked to a dealer profile." });
        return;
      }
      conds.push(eq(repairsTable.dealerId, me.dealerId));
    } else {
      const dealerFilter = qstr("dealerId");
      if (dealerFilter === "none") {
        conds.push(sql`${repairsTable.dealerId} IS NULL`);
      } else if (dealerFilter === "any") {
        conds.push(sql`${repairsTable.dealerId} IS NOT NULL`);
      } else if (dealerFilter) {
        conds.push(eq(repairsTable.dealerId, dealerFilter));
      }
    }

    const search = qstr("q");
    if (search) {
      const like = `%${search}%`;
      const orCond = or(
        ilike(repairsTable.repairId, like),
        ilike(repairsTable.customerName, like),
        ilike(repairsTable.mobile, like),
        ilike(repairsTable.imei, like),
        ilike(repairsTable.imei2, like),
        ilike(repairsTable.serialNumber, like),
        ilike(repairsTable.brand, like),
        ilike(repairsTable.model, like),
        ilike(repairsTable.dealerName, like),
      );
      if (orCond) conds.push(orCond);
    }

    // status accepts a single value or a comma-separated list; each value is
    // validated against the enum and unknown values are dropped. A single
    // valid value behaves exactly as before (eq); multiple use inArray.
    const status = qstr("status");
    if (status) {
      const wanted = status
        .split(",")
        .map((s) => s.trim())
        .filter((s) => REPAIR_STATUSES.includes(s as (typeof REPAIR_STATUSES)[number]));
      if (wanted.length === 1) {
        conds.push(eq(repairsTable.status, wanted[0]));
      } else if (wanted.length > 1) {
        conds.push(inArray(repairsTable.status, wanted));
      }
    }
    const priority = qstr("priority");
    if (priority && REPAIR_PRIORITIES.includes(priority as (typeof REPAIR_PRIORITIES)[number])) {
      conds.push(eq(repairsTable.priority, priority));
    }

    let technicianId = qstr("technicianId");
    if (technicianId === "me") technicianId = me.id;
    // Technicians only ever see repairs assigned to them — enforced
    // server-side regardless of what the client asks for.
    if (me.role === "technician") technicianId = me.id;
    if (technicianId) conds.push(eq(repairsTable.technicianId, technicianId));

    const receivedById = qstr("receivedById");
    if (receivedById) conds.push(eq(repairsTable.receivedById, receivedById));

    const dateFrom = qstr("dateFrom");
    if (dateFrom) conds.push(sql`${repairsTable.receiveDate} >= ${dateFrom}`);
    const dateTo = qstr("dateTo");
    if (dateTo) conds.push(sql`${repairsTable.receiveDate} <= ${dateTo}`);

    const warranty = qstr("warranty");
    const today = todayStr();
    if (warranty === "none") {
      conds.push(sql`${repairsTable.warrantyExpiry} IS NULL`);
    } else if (warranty === "active") {
      conds.push(sql`${repairsTable.warrantyExpiry} IS NOT NULL AND ${repairsTable.warrantyExpiry} >= ${today}`);
    } else if (warranty === "expired") {
      conds.push(sql`${repairsTable.warrantyExpiry} IS NOT NULL AND ${repairsTable.warrantyExpiry} < ${today}`);
    }

    // paymentStatus (paid|partial|pending) is computed from advance vs the
    // total (which includes tax/discount) — post-filter after mapping.
    const paymentStatus = qstr("paymentStatus");

    let page = Math.max(1, Math.trunc(num(Number(q.page), 1)) || 1);
    let limit = Math.trunc(num(Number(q.limit), 50)) || 50;
    if (limit < 1) limit = 50;
    if (limit > 200) limit = 200;

    const where = and(...conds);

    // When a payment-status filter is present the count must reflect the
    // post-filtered set, so fetch matching rows, filter, then page in memory.
    if (paymentStatus === "paid" || paymentStatus === "partial" || paymentStatus === "pending") {
      const allRows = await db
        .select()
        .from(repairsTable)
        .where(where)
        .orderBy(asc(repairsTable.createdAt));
      const mapped = allRows
        .map((r) => ({ r, t: computeTotals(r) }))
        .filter(({ t }) => {
          if (paymentStatus === "paid") return t.balance <= 0.01 && t.totalAmount > 0;
          if (paymentStatus === "partial") return t.paidAmount > 0.01 && t.balance > 0.01;
          return t.paidAmount <= 0.01; // pending
        });
      const total = mapped.length;
      const start = (page - 1) * limit;
      const pageRows = mapped.slice(start, start + limit).map(({ r }) => repairOut(r));
      res.json({ repairs: pageRows, total, page, limit });
      return;
    }

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(repairsTable)
      .where(where);
    const rows = await db
      .select()
      .from(repairsTable)
      .where(where)
      .orderBy(asc(repairsTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json({ repairs: rows.map(repairOut), total, page, limit });
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
    // Task-completion gate: every repair starts at 'received'. A
    // client-supplied status is ignored — later stages only unlock through
    // PATCH transitions where the completion gate verifies the saved work,
    // so creation can never fake a completed workflow.
    const status = "received";
    const priority = REPAIR_PRIORITIES.includes(b.priority) ? b.priority : "normal";
    if (backdateBlocked(req, res, str(b.receiveDate))) return;

    // Charge fields + validation.
    const repairCharge = Math.max(num(b.repairCharge), 0);
    const partsCharge = Math.max(num(b.partsCharge), 0);
    const serviceCharge = Math.max(num(b.serviceCharge), 0);
    const otherCharge = Math.max(num(b.otherCharge), 0);
    const discount = Math.max(num(b.discount), 0);
    const taxPercent = num(b.taxPercent);
    const chargeSubtotal = repairCharge + partsCharge + serviceCharge + otherCharge;
    if (discount > chargeSubtotal) {
      res.status(400).json({ message: "Discount cannot exceed the charge subtotal", code: "INVALID_DISCOUNT" });
      return;
    }
    if (taxPercent < 0 || taxPercent > 100) {
      res.status(400).json({ message: "Tax percent must be between 0 and 100", code: "INVALID_TAX" });
      return;
    }
    const warrantyDaysIn = b.warrantyDays === undefined ? 0 : validWarrantyDays(b.warrantyDays);
    if (warrantyDaysIn === null) {
      res.status(400).json({ message: "Warranty must be a whole number of days between 0 and 3650" });
      return;
    }

    // Offline-sync idempotency: if a repair with this clientRequestId already
    // exists in the shop, return it unchanged (200) instead of duplicating.
    const clientRequestId = str(b.clientRequestId);
    if (clientRequestId) {
      const [dup] = await db
        .select()
        .from(repairsTable)
        .where(and(eq(repairsTable.shopId, shopId), eq(repairsTable.clientRequestId, clientRequestId)));
      if (dup) {
        res.status(200).json({ repair: repairOut(dup) });
        return;
      }
    }

    // A repair may only be linked to a customer of the caller's own shop.
    let customerId = str(b.customerId);
    let linkedCustomerAltEmpty = false;
    if (customerId) {
      const [cust] = await db
        .select({ id: customersTable.id, alternateMobile: customersTable.alternateMobile })
        .from(customersTable)
        .where(and(eq(customersTable.id, customerId), eq(customersTable.shopId, shopId)));
      if (!cust) {
        res.status(400).json({ message: "Customer not found in your shop" });
        return;
      }
      linkedCustomerAltEmpty = !str(cust.alternateMobile);
    }
    const intakeAltMobile = str(b.alternateMobile);

    // Optional permanent dealer link — the dealer must belong to this shop.
    // The repair stays a single record; the dealer relationship is only a
    // foreign key + display snapshot (never a duplicate job card).
    let dealerId = str(b.dealerId);
    let dealerName: string | null = null;
    let dealerDetectedByPhone = false;
    if (dealerId) {
      const [dealer] = await db
        .select({ id: dealersTable.id, name: dealersTable.name, mobile: dealersTable.mobile, isActive: dealersTable.isActive })
        .from(dealersTable)
        .where(and(eq(dealersTable.id, dealerId), eq(dealersTable.shopId, shopId)));
      if (!dealer) {
        res.status(400).json({ message: "Dealer not found in your shop" });
        return;
      }
      dealerDetectedByPhone = dealer.isActive && dealer.mobile === mobile;
      // Manual dealer links are privileged. Non-privileged receiving roles may
      // only supply a dealerId that the server can independently verify by
      // phone match (this also covers picking one of several exact matches) —
      // otherwise they could attach any repair to any dealer.
      if (!dealerDetectedByPhone && !isPrivileged(req)) {
        res.status(403).json({
          message: "Only the dealer/owner can manually link a repair to a dealer.",
          code: "DEALER_LINK_PRIVILEGED",
        });
        return;
      }
      dealerName = dealer.name;
    } else if (b.dealerId !== null) {
      // (an explicit dealerId: null means the user removed a detected dealer
      // before saving — respect that and skip auto-detection entirely)
      // Server-side automatic dealer detection: never trust the client alone.
      // If the intake mobile exactly matches exactly ONE active dealer's
      // registered mobile, link that dealer automatically. Multiple matches
      // are ambiguous — the client must show a picker, so we do NOT assign.
      const matches = await db
        .select({ id: dealersTable.id, name: dealersTable.name })
        .from(dealersTable)
        .where(and(
          eq(dealersTable.shopId, shopId),
          eq(dealersTable.mobile, mobile),
          eq(dealersTable.isActive, true),
        ));
      if (matches.length === 1) {
        dealerId = matches[0].id;
        dealerName = matches[0].name;
        dealerDetectedByPhone = true;
      }
    }

    let created: typeof repairsTable.$inferSelect;
    try {
      created = await db.transaction(async (tx) => {
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
          imei2: str(b.imei2),
          serialNumber: str(b.serialNumber),
          color: str(b.color),
          storage: str(b.storage),
          ram: str(b.ram),
          devicePassword: str(b.devicePassword),
          simPresent: b.simPresent === true,
          memoryCardPresent: b.memoryCardPresent === true,
          alternateMobile: str(b.alternateMobile),
          accessories: str(b.accessories),
          accessoriesList: stringListOrNull(b.accessoriesList),
          physicalCondition: checklistOrNull(b.physicalCondition),
          problem,
          deviceCondition: str(b.deviceCondition),
          // Technician assignment is NOT accepted here — it happens only via
          // POST /repairs/:id/assign (dealer/super_admin, validated same-shop
          // active technician). Any client-supplied technicianId is ignored.
          status,
          priority,
          repairCharge,
          partsCharge,
          serviceCharge,
          otherCharge,
          discount,
          taxPercent,
          advance: 0,
          clientRequestId,
          receiveDate: str(b.receiveDate) ?? new Date().toISOString().split("T")[0],
          expectedDate: str(b.expectedDate) ?? new Date().toISOString().split("T")[0],
          deliveryDate: str(b.deliveryDate),
          notes: str(b.notes),
          checklist: checklistOrNull(b.checklist),
          receivingSignaturePath: ownedObjectPath(shopId, b.receivingSignaturePath),
          warrantyDays: warrantyDaysIn,
          // The logged-in user is recorded as the receiver — accountability
          // for the intake step, not client-supplied.
          receivedById: (req as AuthedRequest).user.id,
          receivedByName: (req as AuthedRequest).user.name,
          dealerId,
          dealerName,
          dealerDetectedByPhone,
          createdById: (req as AuthedRequest).user.id,
          createdByName: (req as AuthedRequest).user.name,
        })
        .returning();
      await logRepairEvent(tx, {
        shopId,
        repairId: row.id,
        user: (req as AuthedRequest).user,
        action: "created",
        details: {
          ticket: row.repairId,
          status: row.status,
          priority: row.priority,
          ...(row.dealerId ? { dealerId: row.dealerId, dealerName: row.dealerName } : {}),
        },
      });
      // Backfill the customer's alternate mobile from the intake form when the
      // customer record doesn't have one yet — so the contact captured at
      // intake is retained on the customer profile too.
      if (row.customerId && linkedCustomerAltEmpty && intakeAltMobile) {
        await tx
          .update(customersTable)
          .set({ alternateMobile: intakeAltMobile })
          .where(and(eq(customersTable.id, row.customerId), eq(customersTable.shopId, shopId)));
      }
      if (row.customerId) await syncCustomerStats(tx, shopId, row.customerId);
      return row;
      });
    } catch (err) {
      // Idempotency race: a concurrent request with the same clientRequestId
      // already inserted (unique violation on repairs_shop_client_request_id).
      const code = (err as { code?: string })?.code;
      if (clientRequestId && code === "23505") {
        const [dup] = await db
          .select()
          .from(repairsTable)
          .where(and(eq(repairsTable.shopId, shopId), eq(repairsTable.clientRequestId, clientRequestId)));
        if (dup) {
          res.status(200).json({ repair: repairOut(dup) });
          return;
        }
      }
      throw err;
    }
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
    if (b.imei2 !== undefined) patch.imei2 = str(b.imei2);
    if (b.serialNumber !== undefined) patch.serialNumber = str(b.serialNumber);
    if (b.color !== undefined) patch.color = str(b.color);
    if (b.storage !== undefined) patch.storage = str(b.storage);
    if (b.ram !== undefined) patch.ram = str(b.ram);
    if (b.devicePassword !== undefined) patch.devicePassword = str(b.devicePassword);
    if (b.simPresent !== undefined) patch.simPresent = b.simPresent === true;
    if (b.memoryCardPresent !== undefined) patch.memoryCardPresent = b.memoryCardPresent === true;
    if (b.alternateMobile !== undefined) patch.alternateMobile = str(b.alternateMobile);
    if (b.accessories !== undefined) patch.accessories = str(b.accessories);
    if (b.accessoriesList !== undefined) patch.accessoriesList = stringListOrNull(b.accessoriesList);
    if (b.physicalCondition !== undefined) patch.physicalCondition = checklistOrNull(b.physicalCondition);
    if (b.paymentMethod !== undefined) patch.paymentMethod = str(b.paymentMethod);
    if (b.problem !== undefined) patch.problem = str(b.problem) ?? undefined;
    if (b.deviceCondition !== undefined) patch.deviceCondition = str(b.deviceCondition);
    if (b.diagnosis !== undefined) patch.diagnosis = str(b.diagnosis);
    if (b.workPerformed !== undefined) patch.workPerformed = str(b.workPerformed);
    // Technician assignment is NOT accepted on the generic PATCH — it happens
    // only via POST /repairs/:id/assign (dealer/super_admin, validated
    // same-shop active technician). Any client-supplied technicianId is ignored.
    if (b.repairCharge !== undefined) patch.repairCharge = Math.max(num(b.repairCharge), 0);
    if (b.partsCharge !== undefined) patch.partsCharge = Math.max(num(b.partsCharge), 0);
    if (b.serviceCharge !== undefined) patch.serviceCharge = Math.max(num(b.serviceCharge), 0);
    if (b.otherCharge !== undefined) patch.otherCharge = Math.max(num(b.otherCharge), 0);
    if (b.discount !== undefined) patch.discount = Math.max(num(b.discount), 0);
    if (b.taxPercent !== undefined) {
      const tp = num(b.taxPercent);
      if (tp < 0 || tp > 100) {
        res.status(400).json({ message: "Tax percent must be between 0 and 100", code: "INVALID_TAX" });
        return;
      }
      patch.taxPercent = tp;
    }
    // Advance is a cache of the payments ledger — never written directly.
    if (b.advance !== undefined) {
      res.status(400).json({
        message: "Advance is recorded through the payments ledger, not by editing the repair directly.",
        code: "ADVANCE_VIA_PAYMENTS",
      });
      return;
    }
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
      const wd = validWarrantyDays(b.warrantyDays);
      if (wd === null) {
        res.status(400).json({ message: "Warranty must be a whole number of days between 0 and 3650" });
        return;
      }
      patch.warrantyDays = wd;
    }
    // Dealer link changes are privileged — the association is permanent for
    // staff; only the shop owner / super admin may correct it.
    if (b.dealerId !== undefined) {
      if (!isPrivileged(req)) {
        res.status(403).json({
          message: "Only the dealer/owner can change a repair's dealer link.",
          code: "DEALER_LINK_PRIVILEGED",
        });
        return;
      }
      const newDealerId = str(b.dealerId);
      if (newDealerId) {
        const [dealer] = await db
          .select({ id: dealersTable.id, name: dealersTable.name })
          .from(dealersTable)
          .where(and(eq(dealersTable.id, newDealerId), eq(dealersTable.shopId, shopId)));
        if (!dealer) {
          res.status(400).json({ message: "Dealer not found in your shop" });
          return;
        }
        patch.dealerId = dealer.id;
        patch.dealerName = dealer.name;
        // Manual (privileged) change — no longer an automatic phone match.
        patch.dealerDetectedByPhone = false;
      } else {
        patch.dealerId = null;
        patch.dealerName = null;
        patch.dealerDetectedByPhone = false;
      }
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
    // Technicians may only modify repairs assigned to them, and only the
    // repair-work fields (never money, intake, customer or delivery facts).
    {
      const meUser = (req as AuthedRequest).user;
      if (meUser.role === "technician") {
        if (existing.technicianId !== meUser.id) {
          res.status(403).json({
            message: "You can only update repairs assigned to you.",
            code: "NOT_ASSIGNED",
          });
          return;
        }
        const TECH_FIELDS = new Set(["status", "diagnosis", "workPerformed", "notes", "priority"]);
        const disallowed = Object.keys(b).filter((k) => b[k] !== undefined && !TECH_FIELDS.has(k));
        if (disallowed.length > 0) {
          res.status(403).json({
            message: `Technicians cannot edit: ${disallowed.join(", ")}`,
            code: "FIELD_NOT_ALLOWED",
          });
          return;
        }
      }
    }
    // Workflow integrity: statuses may only move forward through the stage
    // order (or sideways within a stage). The single authorized rewind is
    // testing → repairing, and only when the recorded testing checklist
    // actually contains a failed item. Service fields are editable only in
    // their own stage (problem @ received; diagnosis/workPerformed during
    // the repairing stage) — only actual value changes are rejected, so
    // full-object PATCHes that echo stored values back are unaffected.
    // These checks run twice: here (fast path against the pre-read snapshot)
    // and again inside the update transaction against a FOR UPDATE re-read,
    // so a concurrent testing/status write cannot invalidate them mid-flight.
    const stageViolation = (
      row: Pick<
        typeof existing,
        | "status" | "testingChecklist" | "problem" | "diagnosis" | "workPerformed"
        | "customerName" | "mobile" | "brand" | "model"
      >,
    ): { code: string; message: string; field?: string; missing?: string[] } | null => {
      const norm = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
      if (patch.status !== undefined && patch.status !== row.status) {
        const STAGE_RANK: Record<string, number> = {
          received: 0,
          diagnosing: 1,
          waiting_parts: 1,
          repairing: 1,
          testing: 2,
          customer_approval: 2,
          ready: 3,
          delivered: 4,
          cancelled: 5,
          cannot_repair: 5,
        };
        const fromRank = STAGE_RANK[row.status] ?? 0;
        const toRank = STAGE_RANK[patch.status as string] ?? 0;
        // cancelled/cannot_repair are terminal for the working stages — a
        // voided job may only be restored by the dealer/owner, and only to
        // 'ready'/'delivered' (statuses where every service field stays
        // locked), never back into an editable stage. delivered may still
        // move forward to a terminal outcome.
        const requesterRole = (req as AuthedRequest).user.role;
        const isTerminalFrom = row.status === "cancelled" || row.status === "cannot_repair";
        const isRestoreFromVoid =
          isTerminalFrom &&
          (requesterRole === "dealer" || requesterRole === "super_admin") &&
          (patch.status === "ready" || patch.status === "delivered");
        const checklistNow = (row.testingChecklist as Record<string, boolean> | null) ?? {};
        const hasFailedTest = Object.values(checklistNow).some((v) => v === false);
        const isAuthorizedTestingFailReturn =
          row.status === "testing" && patch.status === "repairing" && hasFailedTest;
        // Forward moves must be ADJACENT (one stage at a time): sideways
        // within a stage or exactly one rank up. Skipping stages — even with
        // a complete payload — breaks the sequential workflow. Voiding
        // (cancelled/cannot_repair) stays available from any working stage.
        const isVoidMove = toRank === 5;
        const allowed = isTerminalFrom
          ? isRestoreFromVoid
          : isVoidMove ||
            toRank === fromRank ||
            toRank === fromRank + 1 ||
            isAuthorizedTestingFailReturn;
        if (!allowed) {
          return {
            code: "INVALID_STATUS_TRANSITION",
            message: "This status change is not allowed by the repair workflow.",
          };
        }
        // Completion gate: a stage only unlocks after the previous stage's
        // required work is actually SAVED. Applies to every forward move into
        // a working stage; voiding (cancelled/cannot_repair) and the
        // dealer-only restore-from-void path are exempt.
        const isVoidTarget = patch.status === "cancelled" || patch.status === "cannot_repair";
        if (!isVoidTarget && !isRestoreFromVoid && toRank > fromRank) {
          const merged = (f: "customerName" | "mobile" | "brand" | "model" | "problem" | "diagnosis" | "workPerformed") =>
            norm(patch[f] !== undefined ? patch[f] : row[f]).trim();
          const missing: string[] = [];
          if (toRank >= 1) {
            if (!merged("customerName")) missing.push("customer");
            if (!merged("mobile")) missing.push("phone");
            if (!merged("brand") && !merged("model")) missing.push("device");
            if (!merged("problem")) missing.push("problem");
          }
          if (toRank >= 2) {
            if (!merged("diagnosis")) missing.push("diagnosis");
            if (!merged("workPerformed")) missing.push("workPerformed");
          }
          if (toRank >= 3) {
            // Ready/Delivered unlock only after a saved testing result with
            // every recorded item passing. (A failed item routes through the
            // testing-fail return paths instead.)
            const cl = (row.testingChecklist as Record<string, boolean> | null) ?? {};
            const entries = Object.values(cl);
            if (entries.length === 0) missing.push("testingResult");
            else if (entries.some((v) => v === false)) missing.push("testingAllPass");
          }
          if (missing.length > 0) {
            return {
              code: "STAGE_INCOMPLETE",
              message: "Please complete this step first.",
              missing,
            };
          }
        }
      }
      const REPAIRING_STAGE = new Set(["diagnosing", "waiting_parts", "repairing"]);
      // The dealer/owner may correct the repair-work fields on a DELIVERED
      // job (post-delivery corrections); staff stays stage-locked, and
      // pre-delivery stages keep their locks for everyone. The complaint
      // (problem) is permanently fixed once noted at intake for EVERYONE —
      // it can never be replaced at ANY stage. Echoed unchanged values pass.
      const lockRole = (req as AuthedRequest).user.role;
      const dealerDeliveredFix =
        (lockRole === "dealer" || lockRole === "super_admin") && row.status === "delivered";
      const stageLocks: Array<{ field: "problem" | "diagnosis" | "workPerformed"; allowed: boolean }> = [
        { field: "problem", allowed: false },
        { field: "diagnosis", allowed: REPAIRING_STAGE.has(row.status) || dealerDeliveredFix },
        { field: "workPerformed", allowed: REPAIRING_STAGE.has(row.status) || dealerDeliveredFix },
      ];
      for (const { field, allowed } of stageLocks) {
        if (patch[field] !== undefined && norm(patch[field]) !== norm(row[field]) && !allowed) {
          return {
            code: "FIELD_LOCKED_STAGE",
            message: `This field can no longer be edited at the current stage (${row.status}).`,
            field,
          };
        }
      }
      return null;
    };
    {
      const violation = stageViolation(existing);
      if (violation) {
        res.status(409).json(violation);
        return;
      }
    }
    // Validate the merged discount does not exceed the merged charge subtotal.
    const mergedRepairCharge = patch.repairCharge ?? existing.repairCharge;
    const mergedPartsCharge = patch.partsCharge ?? existing.partsCharge;
    const mergedServiceCharge = patch.serviceCharge ?? existing.serviceCharge;
    const mergedOtherCharge = patch.otherCharge ?? existing.otherCharge;
    const mergedDiscount = patch.discount ?? existing.discount;
    if (
      mergedDiscount >
      mergedRepairCharge + mergedPartsCharge + mergedServiceCharge + mergedOtherCharge
    ) {
      res.status(400).json({ message: "Discount cannot exceed the charge subtotal", code: "INVALID_DISCOUNT" });
      return;
    }
    // Financial fields on a delivered repair are locked for staff — the
    // original payment record must not change without dealer/owner action.
    const touchesMoney =
      patch.repairCharge !== undefined ||
      patch.partsCharge !== undefined ||
      patch.serviceCharge !== undefined ||
      patch.otherCharge !== undefined ||
      patch.discount !== undefined ||
      patch.taxPercent !== undefined;
    const meUser = (req as AuthedRequest).user;
    const dealerRole = meUser.role === "dealer" || meUser.role === "super_admin";

    // The mandatory testing gate was removed along with the manual Testing
    // status: repairs may move to 'ready'/'delivered' without a testing
    // confirmation. Testing confirmation stamps are still recorded when the
    // optional testing endpoint is used.
    if (patch.status !== undefined && patch.status !== existing.status) {
      if (patch.status === "ready" && !existing.readyAt) {
        patch.readyAt = new Date();
      }
    }
    if (existing.status === "delivered" && touchesMoney && !dealerRole) {
      res.status(403).json({ message: "Dealer/Owner approval required." });
      return;
    }
    // Delivered is terminal for staff: without this, staff could un-deliver,
    // edit the locked financial fields, and re-deliver. Only the dealer/owner
    // may move a delivered repair back into the workflow.
    if (
      existing.status === "delivered" &&
      patch.status !== undefined &&
      patch.status !== "delivered" &&
      !dealerRole
    ) {
      res.status(403).json({ message: "Dealer/Owner approval required." });
      return;
    }
    // The user completing the handover is recorded as the deliverer.
    if (patch.status === "delivered" && existing.status !== "delivered") {
      patch.deliveredById = meUser.id;
      patch.deliveredByName = meUser.name;
    }
    // Stamp repair start/completion times server-side on status transitions.
    const WORK_STATUSES = ["diagnosing", "waiting_parts", "repairing", "testing"];
    if (
      patch.status !== undefined &&
      patch.status !== existing.status &&
      WORK_STATUSES.includes(patch.status) &&
      !existing.repairStartedAt
    ) {
      patch.repairStartedAt = new Date();
    }
    if (
      patch.status !== undefined &&
      patch.status !== existing.status &&
      ["ready", "delivered"].includes(patch.status) &&
      !existing.repairCompletedAt
    ) {
      patch.repairCompletedAt = new Date();
    }
    // Delivery date is always stamped on handover (warranty or not) — the
    // after-sales "days since delivery" calculation depends on it. Staff
    // cannot supply/backdate it; only the dealer/owner may set an explicit
    // date (their authority), otherwise the server clock wins.
    const effectiveWarrantyDays = patch.warrantyDays ?? existing.warrantyDays;
    if (patch.status === "delivered" && existing.status !== "delivered") {
      const deliveredOn =
        dealerRole && patch.deliveryDate ? patch.deliveryDate : new Date().toISOString().split("T")[0];
      patch.deliveryDate = deliveredOn;
      if (effectiveWarrantyDays > 0) {
        const expiry = new Date(`${deliveredOn}T00:00:00Z`);
        expiry.setUTCDate(expiry.getUTCDate() + effectiveWarrantyDays);
        patch.warrantyExpiry = expiry.toISOString().split("T")[0];
      }
    }
    let updated: typeof repairsTable.$inferSelect;
    try {
      updated = await db.transaction(async (tx) => {
      // Lock the repair row: serializes with concurrent part postings and
      // testing/status writers so a stale partsCharge can never overwrite the
      // parts-ledger-derived sum and stage locks can't be raced mid-flight.
      const [lockedRow] = await tx
        .select()
        .from(repairsTable)
        .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)))
        .for("update");
      if (!lockedRow) throw new Error("ROW_GONE");
      // Re-validate the workflow invariants against the LOCKED row — the
      // pre-transaction snapshot may be stale (e.g. a concurrent testing
      // write cleared the failed item that authorized a rewind).
      {
        const violation = stageViolation(lockedRow);
        if (violation) throw Object.assign(new Error("STAGE_VIOLATION"), { violation });
      }
      // Transition stamps (readyAt/repairCompletedAt/deliveryDate/warranty)
      // were derived from the snapshot's status; if the status moved
      // underneath us they may no longer apply — reject and let the client
      // retry against fresh state.
      if (patch.status !== undefined && lockedRow.status !== existing.status) {
        throw Object.assign(new Error("STAGE_VIOLATION"), {
          violation: {
            code: "CONCURRENT_MODIFICATION",
            message: "The repair changed while saving. Refresh and try again.",
          },
        });
      }
      // Once parts are tracked in the ledger, partsCharge is server-derived
      // only — reject direct writes instead of silently drifting.
      if (patch.partsCharge !== undefined) {
        const [{ partRows }] = await tx
          .select({ partRows: sql<number>`count(*)::int` })
          .from(repairPartsTable)
          .where(and(eq(repairPartsTable.repairId, id), eq(repairPartsTable.shopId, shopId)));
        if (partRows > 0) throw new Error("PARTS_LEDGER_MANAGED");
      }
      // Audit: every update is attributed to the authenticated user —
      // stamped server-side, never client-supplied. No anonymous changes.
      {
        const meUser = (req as AuthedRequest).user;
        patch.updatedById = meUser.id;
        patch.updatedByName = meUser.name;
        patch.updatedAt = new Date();
      }
      const [row] = await tx
        .update(repairsTable)
        .set(patch)
        .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)))
        .returning();
      const user = (req as AuthedRequest).user;
      if (patch.dealerId !== undefined && patch.dealerId !== existing.dealerId) {
        await logRepairEvent(tx, {
          shopId, repairId: id, user,
          action: "dealer_link_changed",
          details: {
            from: existing.dealerName ?? null,
            to: patch.dealerName ?? null,
          },
        });
      }
      if (patch.status !== undefined && patch.status !== existing.status) {
        await logRepairEvent(tx, {
          shopId, repairId: id, user,
          action: "status_changed",
          details: { from: existing.status, to: patch.status },
        });
      }
      // On delivery, record which confirmation method was used. The server
      // NEVER trusts a client-supplied `otpVerified` flag — it derives the
      // method from state: (1) a captured delivery signature, else (2) a
      // delivery_confirmation OTP that was verified within the last 30 minutes
      // and not yet consumed (consumed here in the same tx so it can't be
      // reused), else (3) 'no_confirmation'. Backward compatible: none of these
      // is required to complete delivery.
      if (patch.status === "delivered" && existing.status !== "delivered") {
        let method: "signature" | "otp" | "no_confirmation";
        if (patch.deliverySignaturePath) {
          method = "signature";
        } else {
          const cutoff = new Date(Date.now() - 30 * 60 * 1000);
          const [otpRow] = await tx
            .select()
            .from(customerOtpCodesTable)
            .where(
              and(
                eq(customerOtpCodesTable.shopId, shopId),
                eq(customerOtpCodesTable.purpose, "delivery_confirmation"),
                eq(customerOtpCodesTable.targetId, id),
                sql`${customerOtpCodesTable.verifiedAt} is not null`,
                sql`${customerOtpCodesTable.consumedAt} is null`,
                sql`${customerOtpCodesTable.verifiedAt} >= ${cutoff}`,
              ),
            )
            .orderBy(desc(customerOtpCodesTable.verifiedAt))
            .limit(1)
            .for("update");
          if (otpRow) {
            await tx
              .update(customerOtpCodesTable)
              .set({ consumedAt: new Date() })
              .where(eq(customerOtpCodesTable.id, otpRow.id));
            method = "otp";
          } else {
            method = "no_confirmation";
          }
        }
        await logRepairEvent(tx, {
          shopId, repairId: id, user,
          action: "delivered",
          details: { confirmation: method },
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
      // Charges, advance or status changes affect the linked customer's
      // derived due amount / repair count — recompute inside the same tx.
      if (
        row.customerId &&
        (patch.status !== undefined ||
          patch.repairCharge !== undefined ||
          patch.partsCharge !== undefined ||
          patch.serviceCharge !== undefined ||
          patch.otherCharge !== undefined ||
          patch.discount !== undefined)
      ) {
        await syncCustomerStats(tx, shopId, row.customerId);
      }
      return row;
      });
    } catch (err) {
      if (err instanceof Error && err.message === "STAGE_VIOLATION") {
        res.status(409).json((err as Error & { violation: object }).violation);
        return;
      }
      if (err instanceof Error && err.message === "ROW_GONE") {
        res.status(404).json({ message: "Repair not found" });
        return;
      }
      if (err instanceof Error && err.message === "PARTS_LEDGER_MANAGED") {
        res.status(400).json({
          message: "Parts cost is calculated from the parts list on this repair and cannot be edited directly.",
        });
        return;
      }
      throw err;
    }
    res.json({ repair: repairOut(updated) });
  }),
);

// Permanently delete a repair — dealer/owner only (any status, including
// delivered). Child rows (photos, events, parts, payments, returns, refunds,
// estimate approvals) are removed by FK cascade; customer stats are
// recomputed afterwards. Staff never gets this.
router.delete(
  "/repairs/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    if (me.role !== "dealer" && me.role !== "super_admin") {
      res.status(403).json({ message: "Only the dealer/owner can delete a repair.", code: "DEALER_ONLY" });
      return;
    }
    const id = String(req.params.id ?? "");
    try {
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(repairsTable)
          .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)))
          .for("update");
        if (!row) return null;
        // A repair with a return/warranty case carries a live (or auditable)
        // customer obligation — deleting it would erase the case, its refunds
        // and rework history. Block; the return workflow owns that lifecycle.
        const [ret] = await tx
          .select({ id: repairReturnsTable.id })
          .from(repairReturnsTable)
          .where(and(eq(repairReturnsTable.repairId, id), eq(repairReturnsTable.shopId, shopId)))
          .limit(1);
        if (ret) throw new Error("RETURN_CASE_EXISTS");
        // Consumed tracked parts already deducted inventory. Put that stock
        // back and append compensating ledger rows (stock_movements are not
        // FK-cascaded, so the original deductions stay auditable).
        const parts = await tx
          .select()
          .from(repairPartsTable)
          .where(and(eq(repairPartsTable.repairId, id), eq(repairPartsTable.shopId, shopId)));
        for (const p of parts) {
          if (!p.inventoryItemId) continue;
          const [item] = await tx
            .update(inventoryItemsTable)
            .set({ quantity: sql`${inventoryItemsTable.quantity} + ${p.quantity}` })
            .where(and(eq(inventoryItemsTable.id, p.inventoryItemId), eq(inventoryItemsTable.shopId, shopId)))
            .returning();
          if (item) {
            await tx.insert(stockMovementsTable).values({
              shopId,
              inventoryItemId: p.inventoryItemId,
              itemName: p.partName,
              quantityChange: p.quantity,
              reason: "repair_deleted",
              byId: me.id,
              byName: me.name,
            });
          }
        }
        await tx
          .delete(repairsTable)
          .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)));
        if (row.customerId) await syncCustomerStats(tx, shopId, row.customerId);
        return row;
      });
      if (!deleted) {
        res.status(404).json({ message: "Repair not found" });
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.message === "RETURN_CASE_EXISTS") {
        res.status(409).json({
          message: "Is repair par return/warranty case bana hua hai — pehle return case close/handle karein, repair delete nahi ho sakta.",
          code: "RETURN_CASE_EXISTS",
        });
        return;
      }
      throw err;
    }
    res.json({ message: "Repair deleted" });
  }),
);

// ── Repair photos & timeline ────────────────────────────────────────────────

const PHOTO_KINDS = ["front", "back", "imei", "left", "right", "top", "bottom", "damage", "bill", "customer_id", "other"] as const;

async function repairInShop(shopId: string, id: string) {
  const [row] = await db
    .select({ id: repairsTable.id })
    .from(repairsTable)
    .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)));
  return row ?? null;
}

// Portal-aware variant: dealer-portal accounts may only touch repairs that
// belong to THEIR dealer — a shop-level match alone is not enough (IDOR).
async function repairAccessible(req: Request, shopId: string, id: string) {
  const me = (req as AuthedRequest).user;
  if (isDealerPortalRole(me.role)) {
    if (!me.dealerId) return null;
    const [row] = await db
      .select({ id: repairsTable.id })
      .from(repairsTable)
      .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId), eq(repairsTable.dealerId, me.dealerId)));
    return row ?? null;
  }
  return repairInShop(shopId, id);
}

router.get(
  "/repairs/:id/photos",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const id = String(req.params.id ?? "");
    if (!(await repairAccessible(req, shopId, id))) {
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
    if (!(await repairAccessible(req, shopId, id))) {
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

// ── Payments ledger (append-only) ──────────────────────────────────────────

const PAYMENT_METHODS = ["Cash", "UPI", "Card", "Bank Transfer", "Other"] as const;
function paymentOut(p: typeof repairPaymentsTable.$inferSelect) {
  return {
    id: p.id,
    repairId: p.repairId,
    customerId: p.customerId ?? undefined,
    amount: p.amount,
    method: p.method,
    kind: p.kind,
    note: p.note ?? undefined,
    referenceNo: p.referenceNo ?? undefined,
    receivedById: p.receivedById ?? undefined,
    receivedByName: p.receivedByName ?? undefined,
    createdAt: iso(p.createdAt),
  };
}

router.get(
  "/repairs/:id/payments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const id = String(req.params.id ?? "");
    if (!(await repairAccessible(req, shopId, id))) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    const rows = await db
      .select()
      .from(repairPaymentsTable)
      .where(and(eq(repairPaymentsTable.repairId, id), eq(repairPaymentsTable.shopId, shopId)))
      .orderBy(desc(repairPaymentsTable.createdAt));
    const refundRows = await db
      .select()
      .from(refundsTable)
      .where(and(eq(refundsTable.repairId, id), eq(refundsTable.shopId, shopId)))
      .orderBy(desc(refundsTable.createdAt));
    const refunds = refundRows.map((f) => ({
      id: f.id,
      repairId: f.repairId,
      returnId: f.returnId,
      customerId: f.customerId ?? undefined,
      amount: f.amount,
      originalPaid: f.originalPaid,
      method: f.method,
      status: f.status,
      reason: f.reason,
      referenceNo: f.referenceNo ?? undefined,
      requestedByName: f.requestedByName ?? undefined,
      approvedByName: f.approvedByName ?? undefined,
      approvedAt: f.approvedAt ? f.approvedAt.toISOString() : undefined,
      paidByName: f.paidByName ?? undefined,
      paidAt: f.paidAt ? f.paidAt.toISOString() : undefined,
      rejectionReason: f.rejectionReason ?? undefined,
      createdAt: f.createdAt.toISOString(),
    }));
    res.json({ payments: rows.map(paymentOut), refunds });
  }),
);

router.post(
  "/repairs/:id/payments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const b = req.body ?? {};
    const amount = num(b.amount, NaN);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ message: "A positive payment amount is required", code: "INVALID_AMOUNT" });
      return;
    }
    const method = PAYMENT_METHODS.includes(b.method) ? b.method : null;
    if (!method) {
      res.status(400).json({ message: "A valid payment method is required", code: "INVALID_METHOD" });
      return;
    }
    const kind = PAYMENT_KINDS.includes(b.kind) ? b.kind : "advance";
    const note = str(b.note);
    const referenceNo = str(b.referenceNo);
    const id = String(req.params.id ?? "");

    const result = await db.transaction(async (tx) => {
      // Lock the repair so the advance cache recompute is serialized against
      // concurrent payments (no lost updates / stale overpayment checks).
      const [repair] = await tx
        .select()
        .from(repairsTable)
        .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)))
        .for("update");
      if (!repair) return { error: { status: 404, message: "Repair not found" } };
      const { totalAmount } = computeTotals(repair);
      const [{ paidSoFar }] = await tx
        .select({ paidSoFar: sql<number>`coalesce(sum(${repairPaymentsTable.amount}), 0)::float` })
        .from(repairPaymentsTable)
        .where(and(eq(repairPaymentsTable.repairId, id), eq(repairPaymentsTable.shopId, shopId)));
      // Strict integer-paise comparison — no floating-point tolerance window
      if (Math.round((paidSoFar + amount) * 100) > Math.round(totalAmount * 100)) {
        return {
          error: {
            status: 400,
            code: "OVERPAYMENT",
            message: `Payment would exceed the amount due (₹${Math.max(totalAmount - paidSoFar, 0)} remaining of ₹${totalAmount}).`,
          },
        };
      }
      const row = await recordPayment(tx, {
        shopId,
        repairId: id,
        customerId: repair.customerId,
        amount,
        method,
        kind,
        note,
        referenceNo,
        receivedById: me.id,
        receivedByName: me.name,
      });
      await logRepairEvent(tx, {
        shopId,
        repairId: id,
        user: me,
        action: "payment_recorded",
        details: { amount, method, kind, referenceNo: referenceNo ?? null },
      });
      if (repair.customerId) await syncCustomerStats(tx, shopId, repair.customerId);
      return { row };
    });
    if ("error" in result && result.error) {
      res
        .status(result.error.status)
        .json({ message: result.error.message, ...(result.error.code ? { code: result.error.code } : {}) });
      return;
    }
    res.json({ payment: paymentOut(result.row) });
  }),
);

// ── Technician assignment (dealer/super_admin only) ────────────────────────

router.post(
  "/repairs/:id/assign",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    if (!isPrivileged(req)) {
      res.status(403).json({ message: "Dealer/Owner access required to assign technicians." });
      return;
    }
    const me = (req as AuthedRequest).user;
    const technicianId = str((req.body ?? {}).technicianId);
    if (!technicianId) {
      res.status(400).json({ message: "technicianId is required" });
      return;
    }
    const id = String(req.params.id ?? "");
    if (!(await repairInShop(shopId, id))) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    // The technician must be an active user of this shop with role technician.
    const [tech] = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, technicianId),
          eq(usersTable.shopId, shopId),
          eq(usersTable.role, "technician"),
          eq(usersTable.isActive, true),
        ),
      );
    if (!tech) {
      res.status(400).json({ message: "Technician must be an active technician in your shop." });
      return;
    }
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(repairsTable)
        .set({
          technicianId: tech.id,
          technicianName: tech.name,
          assignedById: me.id,
          assignedByName: me.name,
          assignedAt: new Date(),
        })
        .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)))
        .returning();
      await logRepairEvent(tx, {
        shopId,
        repairId: id,
        user: me,
        action: "assigned",
        details: { technicianId: tech.id, technicianName: tech.name },
      });
      return row;
    });
    res.json({ repair: repairOut(updated) });
  }),
);

// ── Testing gate ────────────────────────────────────────────────────────────

router.post(
  "/repairs/:id/testing",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const b = req.body ?? {};
    const checklist = checklistOrNull(b.checklist);
    const confirm = b.confirm === true;
    const id = String(req.params.id ?? "");
    // All checklist validation happens inside the transaction against a
    // row-locked read so concurrent writes cannot bypass the pass lock.
    const outcome = await db.transaction(async (tx) => {
      const [existingRepair] = await tx
        .select({
          id: repairsTable.id,
          technicianId: repairsTable.technicianId,
          status: repairsTable.status,
          testingChecklist: repairsTable.testingChecklist,
        })
        .from(repairsTable)
        .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)))
        .for("update");
      if (!existingRepair) {
        return { error: { status: 404, body: { message: "Repair not found" } } } as const;
      }
      // Technicians may only record testing on repairs assigned to them.
      if (me.role === "technician" && existingRepair.technicianId !== me.id) {
        return {
          error: {
            status: 403,
            body: { message: "You can only update repairs assigned to you.", code: "NOT_ASSIGNED" },
          },
        } as const;
      }
      const existingChecklist =
        (existingRepair.testingChecklist as Record<string, boolean> | null) ?? {};
      const set: Partial<typeof repairsTable.$inferInsert> = {};
      let finalChecklist: Record<string, boolean> | null =
        Object.keys(existingChecklist).length ? existingChecklist : null;
      if (b.checklist !== undefined) {
        // Stage lock: testing results may only be recorded during the testing
        // stage of the workflow.
        const TESTING_STAGE = new Set(["testing", "customer_approval"]);
        if (!TESTING_STAGE.has(existingRepair.status)) {
          return {
            error: {
              status: 409,
              body: {
                message: "Testing results can only be recorded while the job is in the Testing stage.",
                code: "FIELD_LOCKED_STAGE",
                field: "testingChecklist",
              },
            },
          } as const;
        }
        const incoming = checklist ?? {};
        // Pass lock: an item saved as Pass (true) can never be flipped to Fail.
        for (const [k, v] of Object.entries(incoming)) {
          if (existingChecklist[k] === true && v === false) {
            return {
              error: {
                status: 409,
                body: {
                  message: "This testing item has already passed and can no longer be changed.",
                  code: "TESTING_ITEM_LOCKED",
                  item: k,
                },
              },
            } as const;
          }
        }
        // The saved checklist is the incoming record plus any previously
        // passed items the client omitted (pass is immutable even by
        // omission). Omitted Fail entries are dropped, so Fail -> unset works.
        const next: Record<string, boolean> = { ...incoming };
        for (const [k, v] of Object.entries(existingChecklist)) {
          if (v === true && next[k] === undefined) next[k] = true;
        }
        finalChecklist = Object.keys(next).length ? next : null;
        set.testingChecklist = finalChecklist;
      }
      if (confirm) {
        set.testingConfirmedById = me.id;
        set.testingConfirmedByName = me.name;
        set.testingConfirmedAt = new Date();
      }
      const [row] = await tx
        .update(repairsTable)
        .set(set)
        .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)))
        .returning();
      if (confirm) {
        await logRepairEvent(tx, {
          shopId,
          repairId: id,
          user: me,
          action: "testing_confirmed",
          details: { checklist: finalChecklist },
        });
      } else {
        await logRepairEvent(tx, { shopId, repairId: id, user: me, action: "testing_updated" });
      }
      return { row } as const;
    });
    if ("error" in outcome && outcome.error) {
      res.status(outcome.error.status).json(outcome.error.body);
      return;
    }
    res.json({ repair: repairOut(outcome.row) });
  }),
);

// ── Estimate / customer approval ────────────────────────────────────────────

function estimateApprovalOut(a: typeof estimateApprovalsTable.$inferSelect) {
  return {
    id: a.id,
    repairId: a.repairId,
    oldAmount: a.oldAmount,
    newAmount: a.newAmount,
    reason: a.reason,
    status: a.status,
    method: a.method ?? undefined,
    requestedById: a.requestedById ?? undefined,
    requestedByName: a.requestedByName ?? undefined,
    decidedById: a.decidedById ?? undefined,
    decidedByName: a.decidedByName ?? undefined,
    decidedAt: a.decidedAt ? iso(a.decidedAt) : undefined,
    createdAt: iso(a.createdAt),
  };
}

router.get(
  "/repairs/:id/estimate-approvals",
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
      .from(estimateApprovalsTable)
      .where(and(eq(estimateApprovalsTable.repairId, id), eq(estimateApprovalsTable.shopId, shopId)))
      .orderBy(desc(estimateApprovalsTable.createdAt));
    res.json({ estimateApprovals: rows.map(estimateApprovalOut) });
  }),
);

router.post(
  "/repairs/:id/estimate-approvals",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const b = req.body ?? {};
    const newAmount = num(b.newAmount, NaN);
    const reason = str(b.reason);
    if (!Number.isFinite(newAmount) || newAmount < 0 || !reason) {
      res.status(400).json({ message: "A valid new amount and a reason are required" });
      return;
    }
    const id = String(req.params.id ?? "");
    const result = await db.transaction(async (tx) => {
      const [repair] = await tx
        .select()
        .from(repairsTable)
        .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)))
        .for("update");
      if (!repair) return { error: { status: 404, message: "Repair not found" } };
      // Estimate approvals belong to the pre-repair/repairing stages. Parking
      // a later-stage (testing/ready/delivered) or voided repair back into
      // 'customer_approval' would reopen locked stages — reject it here so
      // this writer honors the same forward-only workflow as the PATCH route.
      const ESTIMATE_STAGES = new Set([
        "received", "diagnosing", "waiting_parts", "repairing", "customer_approval",
      ]);
      if (!ESTIMATE_STAGES.has(repair.status)) {
        return {
          error: {
            status: 409,
            message: "Estimate approval can only be requested before testing/completion.",
            code: "INVALID_STATUS_TRANSITION",
          },
        };
      }
      const { totalAmount } = computeTotals(repair);
      // Record the stage at request time for the audit trail. The workflow
      // status itself is NOT changed — a pending approval row is its own
      // "awaiting customer" state, so the forward-only status graph is never
      // rewound by the estimate flow.
      const previousStatus = repair.status;
      const [row] = await tx
        .insert(estimateApprovalsTable)
        .values({
          shopId,
          repairId: id,
          oldAmount: totalAmount,
          newAmount,
          reason,
          status: "pending",
          previousStatus,
          requestedById: me.id,
          requestedByName: me.name,
        })
        .returning();
      await logRepairEvent(tx, {
        shopId,
        repairId: id,
        user: me,
        action: "estimate_approval_requested",
        details: { approvalId: row.id, oldAmount: totalAmount, newAmount, reason },
      });
      return { row };
    });
    if ("error" in result && result.error) {
      res.status(result.error.status).json({ message: result.error.message });
      return;
    }
    res.json({ estimateApproval: estimateApprovalOut(result.row) });
  }),
);

// Load an estimate approval (shop-scoped) with its repair.
async function loadEstimateApproval(shopId: string, id: string) {
  const [row] = await db
    .select()
    .from(estimateApprovalsTable)
    .where(and(eq(estimateApprovalsTable.id, id), eq(estimateApprovalsTable.shopId, shopId)));
  return row ?? null;
}

router.post(
  "/estimate-approvals/:id/send-otp",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const id = String(req.params.id ?? "");
    const approval = await loadEstimateApproval(shopId, id);
    if (!approval) {
      res.status(404).json({ message: "Estimate approval not found" });
      return;
    }
    const email = await customerEmailForRepair(shopId, approval.repairId);
    if (!email) {
      res.status(400).json({ message: "This customer has no email on file.", code: "NO_CUSTOMER_EMAIL" });
      return;
    }
    const code = generateOtpCode();
    await db.insert(customerOtpCodesTable).values({
      shopId,
      purpose: "estimate_approval",
      targetId: id,
      codeHash: sha256(code),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    await sendOtpEmail(email, code, "estimate approval");
    res.json({ message: "OTP sent to the customer's email." });
  }),
);

router.post(
  "/estimate-approvals/:id/decide",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const b = req.body ?? {};
    const decision = b.decision === "approved" || b.decision === "rejected" ? b.decision : null;
    const method = b.method === "otp" || b.method === "dealer" ? b.method : null;
    if (!decision || !method) {
      res.status(400).json({ message: "decision (approved|rejected) and method (otp|dealer) are required" });
      return;
    }
    if (method === "dealer" && !isPrivileged(req)) {
      res.status(403).json({ message: "Only the dealer/owner may decide manually." });
      return;
    }
    const id = String(req.params.id ?? "");

    // OTP verification (any shop user may confirm on the customer's behalf).
    if (method === "otp") {
      const otpCode = str(b.otpCode);
      if (!otpCode) {
        res.status(400).json({ message: "otpCode is required for OTP confirmation", code: "OTP_REQUIRED" });
        return;
      }
      const verifyResult = await verifyCustomerOtp(shopId, "estimate_approval", id, otpCode);
      if (verifyResult !== "ok") {
        res.status(400).json({ message: verifyResult.message, code: verifyResult.code });
        return;
      }
    }

    const result = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(estimateApprovalsTable)
        .set({
          status: decision,
          method,
          decidedById: me.id,
          decidedByName: me.name,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(estimateApprovalsTable.id, id),
            eq(estimateApprovalsTable.shopId, shopId),
            eq(estimateApprovalsTable.status, "pending"),
          ),
        )
        .returning();
      if (!claimed) return { error: { status: 400, message: "This estimate approval has already been decided." } };
      // Move the repair back out of "customer_approval" if it is still parked
      // there. On APPROVE we also apply the approved estimate to the labour
      // charge: shift repairCharge by (newAmount - oldAmount) so the repair's
      // computed total moves to the customer-approved amount. Other charge
      // components (parts/service/tax/discount) are untouched. On REJECT the
      // charges are left exactly as they were.
      let repairChargeAfter: number | undefined;
      if (decision === "approved") {
        const [repair] = await tx
          .select()
          .from(repairsTable)
          .where(and(eq(repairsTable.id, claimed.repairId), eq(repairsTable.shopId, shopId)))
          .for("update");
        if (repair) {
          const delta = claimed.newAmount - claimed.oldAmount;
          repairChargeAfter = Math.max(repair.repairCharge + delta, 0);
          await tx
            .update(repairsTable)
            .set({ repairCharge: repairChargeAfter })
            .where(and(eq(repairsTable.id, claimed.repairId), eq(repairsTable.shopId, shopId)));
        }
      }
      // The estimate flow never mutates the repair's workflow status —
      // requesting an approval does not park it and deciding one does not
      // restore anything, so the forward-only status graph cannot be
      // rewound through this path. (Legacy repairs still parked in
      // 'customer_approval' by the old behavior move forward via the
      // normal status flow.)
      await logRepairEvent(tx, {
        shopId,
        repairId: claimed.repairId,
        user: me,
        action: decision === "approved" ? "estimate_approved" : "estimate_rejected",
        details: {
          approvalId: claimed.id,
          method,
          oldAmount: claimed.oldAmount,
          newAmount: claimed.newAmount,
          ...(repairChargeAfter !== undefined ? { repairChargeAfter } : {}),
        },
      });
      // Keep the customer's derived due amount in sync after a charge change.
      if (repairChargeAfter !== undefined) {
        const [r2] = await tx
          .select({ customerId: repairsTable.customerId })
          .from(repairsTable)
          .where(and(eq(repairsTable.id, claimed.repairId), eq(repairsTable.shopId, shopId)));
        if (r2?.customerId) await syncCustomerStats(tx, shopId, r2.customerId);
      }
      return { row: claimed };
    });
    if ("error" in result && result.error) {
      res.status(result.error.status).json({ message: result.error.message });
      return;
    }
    res.json({ estimateApproval: estimateApprovalOut(result.row) });
  }),
);

// ── Delivery OTP (alternative to a delivery signature) ──────────────────────

router.post(
  "/repairs/:id/delivery-otp/send",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const id = String(req.params.id ?? "");
    if (!(await repairInShop(shopId, id))) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    const email = await customerEmailForRepair(shopId, id);
    if (!email) {
      res.status(400).json({ message: "This customer has no email on file.", code: "NO_CUSTOMER_EMAIL" });
      return;
    }
    const code = generateOtpCode();
    await db.insert(customerOtpCodesTable).values({
      shopId,
      purpose: "delivery_confirmation",
      targetId: id,
      codeHash: sha256(code),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    await sendOtpEmail(email, code, "delivery confirmation");
    res.json({ message: "OTP sent to the customer's email." });
  }),
);

router.post(
  "/repairs/:id/delivery-otp/verify",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const id = String(req.params.id ?? "");
    if (!(await repairInShop(shopId, id))) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    const code = str((req.body ?? {}).code);
    if (!code) {
      res.status(400).json({ message: "code is required", code: "OTP_REQUIRED" });
      return;
    }
    const verifyResult = await verifyCustomerOtp(shopId, "delivery_confirmation", id, code);
    if (verifyResult !== "ok") {
      res.status(400).json({ message: verifyResult.message, code: verifyResult.code });
      return;
    }
    await logRepairEvent(db, {
      shopId,
      repairId: id,
      user: me,
      action: "delivery_otp_verified",
    });
    res.json({ message: "Delivery OTP verified.", otpVerified: true });
  }),
);

// ── Ready notification ──────────────────────────────────────────────────────

router.post(
  "/repairs/:id/notify-ready",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const id = String(req.params.id ?? "");
    const [repair] = await db
      .select()
      .from(repairsTable)
      .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)));
    if (!repair) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    const email = await customerEmailForRepair(shopId, id);
    if (!email) {
      res.status(400).json({ message: "This customer has no email on file.", code: "NO_CUSTOMER_EMAIL" });
      return;
    }
    const { balance } = computeTotals(repair);
    const businessName = me.businessName ?? "VMC Electronic";
    await sendReadyEmail(email, {
      customerName: repair.customerName,
      brand: repair.brand,
      model: repair.model,
      ticket: repair.repairId,
      balance,
      businessName,
    });
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(repairsTable)
        .set({ customerNotifiedAt: new Date() })
        .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)))
        .returning();
      await logRepairEvent(tx, {
        shopId,
        repairId: id,
        user: me,
        action: "ready_notified",
        details: { balance },
      });
      return row;
    });
    res.json({ repair: repairOut(updated) });
  }),
);

// ── Stock movements (dealer only) ───────────────────────────────────────────

router.get(
  "/stock-movements",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    if (!isPrivileged(req)) {
      res.status(403).json({ message: "Dealer/Owner access required." });
      return;
    }
    const inventoryItemId = typeof req.query.inventoryItemId === "string" ? req.query.inventoryItemId.trim() : "";
    const conds: SQL[] = [eq(stockMovementsTable.shopId, shopId)];
    if (inventoryItemId) conds.push(eq(stockMovementsTable.inventoryItemId, inventoryItemId));
    const rows = await db
      .select()
      .from(stockMovementsTable)
      .where(and(...conds))
      .orderBy(desc(stockMovementsTable.createdAt));
    res.json({
      stockMovements: rows.map((m) => ({
        id: m.id,
        inventoryItemId: m.inventoryItemId ?? undefined,
        itemName: m.itemName,
        quantityChange: m.quantityChange,
        reason: m.reason,
        repairId: m.repairId ?? undefined,
        returnId: m.returnId ?? undefined,
        byId: m.byId ?? undefined,
        byName: m.byName ?? undefined,
        createdAt: iso(m.createdAt),
      })),
    });
  }),
);

// ── Customer summary (aggregate) ────────────────────────────────────────────

router.get(
  "/customers/:id/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const customerId = String(req.params.id ?? "");
    const [cust] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.id, customerId), eq(customersTable.shopId, shopId)));
    if (!cust) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }
    const today = todayStr();
    const [repairStats] = await db
      .select({
        totalRepairs: sql<number>`count(*) filter (where ${repairsTable.status} <> 'cancelled')::int`,
        activeRepairs: sql<number>`count(*) filter (where ${repairsTable.status} not in ('delivered','cancelled','cannot_repair'))::int`,
        deliveredRepairs: sql<number>`count(*) filter (where ${repairsTable.status} = 'delivered')::int`,
        warrantyActiveCount: sql<number>`count(*) filter (where ${repairsTable.warrantyExpiry} is not null and ${repairsTable.warrantyExpiry} >= ${today})::int`,
      })
      .from(repairsTable)
      .where(and(eq(repairsTable.shopId, shopId), eq(repairsTable.customerId, customerId)));
    const [{ afterSalesCases }] = await db
      .select({ afterSalesCases: sql<number>`count(*)::int` })
      .from(repairReturnsTable)
      .where(and(eq(repairReturnsTable.shopId, shopId), eq(repairReturnsTable.customerId, customerId)));
    const [{ paymentsTotal }] = await db
      .select({ paymentsTotal: sql<number>`coalesce(sum(${repairPaymentsTable.amount}), 0)::float` })
      .from(repairPaymentsTable)
      .where(and(eq(repairPaymentsTable.shopId, shopId), eq(repairPaymentsTable.customerId, customerId)));
    const [{ refundsTotal }] = await db
      .select({
        refundsTotal: sql<number>`coalesce(sum(${refundsTable.amount}) filter (where ${refundsTable.status} = 'paid'), 0)::float`,
      })
      .from(refundsTable)
      .where(and(eq(refundsTable.shopId, shopId), eq(refundsTable.customerId, customerId)));
    // Outstanding balance = sum over non-cancelled repairs of (total − paid),
    // clamped at 0 per repair.
    const repairs = await db
      .select()
      .from(repairsTable)
      .where(
        and(
          eq(repairsTable.shopId, shopId),
          eq(repairsTable.customerId, customerId),
          sql`${repairsTable.status} <> 'cancelled'`,
        ),
      );
    const outstandingBalance =
      Math.round(
        repairs.reduce((acc, r) => acc + Math.max(computeTotals(r).balance, 0), 0) * 100,
      ) / 100;
    res.json({
      summary: {
        totalRepairs: repairStats?.totalRepairs ?? 0,
        activeRepairs: repairStats?.activeRepairs ?? 0,
        deliveredRepairs: repairStats?.deliveredRepairs ?? 0,
        afterSalesCases: afterSalesCases ?? 0,
        refundsTotal: refundsTotal ?? 0,
        paymentsTotal: paymentsTotal ?? 0,
        outstandingBalance,
        warrantyActiveCount: repairStats?.warrantyActiveCount ?? 0,
      },
    });
  }),
);

// ── Customer OTP + email helpers ────────────────────────────────────────────

// The repair's customer email: prefer the linked customer record, fall back to
// nothing (repairs don't store an email directly).
async function customerEmailForRepair(shopId: string, repairId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: customersTable.email })
    .from(repairsTable)
    .leftJoin(customersTable, eq(repairsTable.customerId, customersTable.id))
    .where(and(eq(repairsTable.id, repairId), eq(repairsTable.shopId, shopId)));
  const email = row?.email;
  return typeof email === "string" && email.trim() ? email.trim() : null;
}

type OtpVerifyResult = "ok" | { message: string; code: string };

// Verify a customer OTP against the newest unverified code for the target.
// Enforces 10-min expiry and a max of 5 attempts (same pattern as auth OTP).
async function verifyCustomerOtp(
  shopId: string,
  purpose: string,
  targetId: string,
  code: string,
): Promise<OtpVerifyResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(customerOtpCodesTable)
      .where(
        and(
          eq(customerOtpCodesTable.shopId, shopId),
          eq(customerOtpCodesTable.purpose, purpose),
          eq(customerOtpCodesTable.targetId, targetId),
          sql`${customerOtpCodesTable.verifiedAt} IS NULL`,
        ),
      )
      .orderBy(desc(customerOtpCodesTable.createdAt))
      .limit(1)
      .for("update");
    if (!row) return { message: "No pending code. Request a new OTP.", code: "OTP_NOT_FOUND" } as const;
    if (row.expiresAt.getTime() < Date.now()) {
      return { message: "This code has expired. Request a new OTP.", code: "OTP_EXPIRED" } as const;
    }
    if (row.attempts >= 5) {
      return { message: "Too many incorrect attempts. Request a new OTP.", code: "OTP_LOCKED" } as const;
    }
    if (row.codeHash !== sha256(code)) {
      await tx
        .update(customerOtpCodesTable)
        .set({ attempts: row.attempts + 1 })
        .where(eq(customerOtpCodesTable.id, row.id));
      return { message: "Incorrect code.", code: "OTP_INVALID" } as const;
    }
    await tx
      .update(customerOtpCodesTable)
      .set({ verifiedAt: new Date() })
      .where(eq(customerOtpCodesTable.id, row.id));
    return "ok" as const;
  });
}

async function sendReadyEmail(
  to: string,
  d: { customerName: string; brand: string; model: string; ticket: string; balance: number; businessName: string },
): Promise<void> {
  const { sendReadyNotification } = await import("../lib/mailer");
  await sendReadyNotification(to, d);
}

// ── Repair parts (append-only, deducts inventory) ──────────────────────────

function repairPartOut(p: typeof repairPartsTable.$inferSelect, canSeeCosts: boolean) {
  const unitCost = canSeeCosts ? p.unitCost : 0;
  return {
    id: p.id,
    repairId: p.repairId,
    inventoryItemId: p.inventoryItemId ?? undefined,
    partName: p.partName,
    quantity: p.quantity,
    unitCost,
    totalCost: p.quantity * unitCost,
    canSeeCosts,
    addedByName: p.addedByName ?? undefined,
    createdAt: iso(p.createdAt),
  };
}

router.get(
  "/repairs/:id/parts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const id = String(req.params.id ?? "");
    if (!(await repairInShop(shopId, id))) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    const canSeeCosts = isPrivileged(req);
    const rows = await db
      .select()
      .from(repairPartsTable)
      .where(and(eq(repairPartsTable.repairId, id), eq(repairPartsTable.shopId, shopId)))
      .orderBy(desc(repairPartsTable.createdAt));
    res.json({ parts: rows.map((p) => repairPartOut(p, canSeeCosts)), canSeeCosts });
  }),
);

router.post(
  "/repairs/:id/parts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const b = req.body ?? {};
    const quantity = Math.trunc(num(b.quantity, 0));
    if (quantity <= 0) {
      res.status(400).json({ message: "Quantity must be at least 1" });
      return;
    }
    const inventoryItemId = str(b.inventoryItemId);
    try {
      const created = await db.transaction(async (tx) => {
        // Lock the repair row: guarantees it exists, is shop-owned, and is
        // not delivered/cancelled while we mutate stock + partsCharge.
        const [repair] = await tx
          .select()
          .from(repairsTable)
          .where(and(eq(repairsTable.id, String(req.params.id ?? "")), eq(repairsTable.shopId, shopId)))
          .for("update");
        if (!repair) throw new Error("NOT_FOUND");
        // Technicians may only add parts to repairs assigned to them.
        if (me.role === "technician" && repair.technicianId !== me.id) {
          throw new Error("NOT_ASSIGNED");
        }
        if (repair.status === "delivered" || repair.status === "cancelled") {
          throw new Error("REPAIR_LOCKED");
        }
        let partName = str(b.partName);
        let unitCost = num(b.unitCost, 0);
        if (inventoryItemId) {
          // Atomic conditional deduction — never lets stock go negative.
          const [item] = await tx
            .update(inventoryItemsTable)
            .set({ quantity: sql`${inventoryItemsTable.quantity} - ${quantity}` })
            .where(
              and(
                eq(inventoryItemsTable.id, inventoryItemId),
                eq(inventoryItemsTable.shopId, shopId),
                sql`${inventoryItemsTable.quantity} >= ${quantity}`,
              ),
            )
            .returning();
          if (!item) throw new Error("OUT_OF_STOCK");
          partName = partName ?? item.name;
          if (b.unitCost === undefined) unitCost = item.sellingPrice ?? item.purchasePrice ?? 0;
        }
        if (!partName) throw new Error("PART_NAME_REQUIRED");
        // Append the stock movement ledger row (negative = consumed) in the
        // same tx as the deduction. Only when a tracked item was deducted.
        if (inventoryItemId) {
          await tx.insert(stockMovementsTable).values({
            shopId,
            inventoryItemId,
            itemName: partName,
            quantityChange: -quantity,
            reason: "repair_part",
            repairId: repair.id,
            byId: me.id,
            byName: me.name,
          });
        }
        const [row] = await tx
          .insert(repairPartsTable)
          .values({
            shopId,
            repairId: repair.id,
            inventoryItemId,
            partName,
            quantity,
            unitCost: Math.max(unitCost, 0),
            addedById: me.id,
            addedByName: me.name,
          })
          .returning();
        // Keep the repair's partsCharge in sync with the consumed parts.
        const [{ total }] = await tx
          .select({
            total: sql<number>`coalesce(sum(${repairPartsTable.quantity} * ${repairPartsTable.unitCost}), 0)::float`,
          })
          .from(repairPartsTable)
          .where(and(eq(repairPartsTable.repairId, repair.id), eq(repairPartsTable.shopId, shopId)));
        await tx
          .update(repairsTable)
          .set({ partsCharge: total })
          .where(and(eq(repairsTable.id, repair.id), eq(repairsTable.shopId, shopId)));
        await logRepairEvent(tx, {
          shopId,
          repairId: repair.id,
          user: me,
          action: "part_used",
          // Do NOT log unitCost — repair events are readable by staff, and the
          // part cost is privileged. Log only the part name and quantity.
          details: { partName, quantity },
        });
        if (repair.customerId) await syncCustomerStats(tx, shopId, repair.customerId);
        return row;
      });
      res.json({ part: repairPartOut(created, isPrivileged(req)) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "NOT_FOUND") {
        res.status(404).json({ message: "Repair not found" });
        return;
      }
      if (msg === "NOT_ASSIGNED") {
        res.status(403).json({ message: "You can only update repairs assigned to you.", code: "NOT_ASSIGNED" });
        return;
      }
      if (msg === "REPAIR_LOCKED") {
        res.status(400).json({ message: "Parts cannot be added to a delivered or cancelled repair." });
        return;
      }
      if (msg === "OUT_OF_STOCK") {
        res.status(400).json({ message: "Not enough stock for this part." });
        return;
      }
      if (msg === "PART_NAME_REQUIRED") {
        res.status(400).json({ message: "Part name is required." });
        return;
      }
      throw err;
    }
  }),
);

// ── Inventory ──────────────────────────────────────────────────────────────

const INVENTORY_CATEGORIES = ["product", "accessory", "spare_part"] as const;

function inventoryOut(i: typeof inventoryItemsTable.$inferSelect, canSeeCosts = true) {
  return {
    id: i.id,
    name: i.name,
    category: i.category,
    brand: i.brand,
    quantity: i.quantity,
    minStock: i.minStock,
    // Purchase (cost) price is hidden from non-privileged staff — kept in the
    // payload as 0 so the mobile client's shape is preserved.
    purchasePrice: canSeeCosts ? i.purchasePrice : 0,
    sellingPrice: i.sellingPrice,
    sku: i.sku ?? undefined,
    supplier: i.supplier ?? undefined,
    canSeeCosts,
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
    const canSeeCosts = isPrivileged(req);
    const rows = await db
      .select()
      .from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.shopId, shopId))
      .orderBy(asc(inventoryItemsTable.createdAt));
    res.json({ items: rows.map((i) => inventoryOut(i, canSeeCosts)), canSeeCosts });
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
        sku: str(b.sku),
        supplier: str(b.supplier),
      })
      .returning();
    res.json({ item: inventoryOut(created, isPrivileged(req)) });
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
    if (b.sku !== undefined) patch.sku = str(b.sku);
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
    res.json({ item: inventoryOut(updated, isPrivileged(req)) });
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
    // NOTE: GET /finance is intentionally NOT finance-gated yet. The mobile
    // DataContext loads finance for every role in a blocking Promise.all, so a
    // 403 here would break the whole app for non-finance staff. Gating this
    // must be done together with a mobile change (role-gate or non-blocking
    // fetch). Tracked as a follow-up — see the money-visibility audit.
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
