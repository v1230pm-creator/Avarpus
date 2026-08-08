import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  repairsTable,
  repairEventsTable,
  repairReturnsTable,
  returnPartsTable,
  refundsTable,
  inventoryItemsTable,
  financeEntriesTable,
  stockMovementsTable,
  type DbUser,
  type DbRepairReturn,
  type DbRefund,
  type DbRepair,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import type { Request, Response } from "express";

// Return / Rework / Refund workflow.
// The original repair is NEVER edited or deleted — a return case links to it
// and every step is appended to the repair's immutable event timeline.
// Financial reversals are separate REFUND transactions; staff can only
// request them, dealer/owner approves / rejects / marks paid (enforced here,
// server-side).

const router: IRouter = Router();

type AuthedRequest = Request & { user: DbUser };

const DEALER_ROLES = ["dealer", "super_admin"];
// Cost visibility: only privileged roles see internal costs (partsCost and
// return-part unitCost). Customer-facing prices (labourCost, customerPayable)
// are always shown.
function isPrivileged(req: Request): boolean {
  return DEALER_ROLES.includes((req as AuthedRequest).user.role);
}
// Finance visibility: roles allowed to read money figures across the shop
// (refund amounts, finance ledger). Mirrors the dashboard FINANCE_ROLES so the
// rule is consistent everywhere. dealer + super_admin own the shop, accountant
// handles the books.
const FINANCE_ROLES = ["dealer", "super_admin", "accountant"];
function canSeeFinance(req: Request): boolean {
  return FINANCE_ROLES.includes((req as AuthedRequest).user.role);
}
const RETURN_STATUSES = [
  "returned",
  "inspection",
  "rework_required",
  "warranty_service",
  "waiting_for_parts",
  "repaired",
  "refund_requested",
  "refund_approved",
  "refund_paid",
  "no_fault_found",
  "cannot_repair",
  "customer_declined",
  "closed",
] as const;
// Explicit state machine — a target status is only reachable from the listed
// current states. Dealer-only transitions are additionally gated by role.
// refund_* statuses are NOT reachable via PATCH — they are set exclusively by
// the refund endpoints (request/approve/mark-paid) so the case status always
// mirrors the real refund transaction.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  inspection: ["returned"],
  rework_required: ["inspection", "warranty_service", "waiting_for_parts"], // dealer only
  warranty_service: ["inspection", "rework_required", "waiting_for_parts"],
  waiting_for_parts: ["rework_required", "warranty_service"],
  repaired: ["rework_required", "warranty_service", "waiting_for_parts"],
  no_fault_found: ["inspection"],
  cannot_repair: ["inspection", "rework_required", "warranty_service", "waiting_for_parts"],
  customer_declined: ["inspection", "rework_required", "warranty_service", "waiting_for_parts", "cannot_repair"],
  closed: RETURN_STATUSES.filter((s) => s !== "closed"),
};
// Statuses set only through the refund flow, never via a direct PATCH.
const REFUND_FLOW_STATUSES = ["refund_requested", "refund_approved", "refund_paid"];
// Transitions only the dealer/owner may perform.
const DEALER_ONLY_STATUSES = ["rework_required", "closed"];
// Terminal outcomes that stamp a completion time.
const COMPLETING_STATUSES = ["repaired", "no_fault_found", "cannot_repair", "customer_declined", "refund_paid", "closed"];
const RETURN_REASONS = [
  "same_problem",
  "stopped_working",
  "repair_failed",
  "new_problem",
  "complaint",
  "warranty_rework",
  "refund_requested",
  "other",
];
const RESOLUTIONS = [
  "rework",
  "parts_replacement",
  "no_fault_found",
  "cannot_repair",
  "refund",
  "partial_refund",
  "customer_declined",
  "other",
];
const REFUND_METHODS = ["Cash", "UPI", "Bank Transfer", "Card", "Other"];

const todayStr = () => new Date().toISOString().split("T")[0];
const iso = (d: Date) => d.toISOString();

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function shopIdOr403(req: Request, res: Response): string | null {
  const me = (req as AuthedRequest).user;
  if (!me.shopId) {
    res.status(403).json({ message: "Your account is not linked to a shop." });
    return null;
  }
  return me.shopId;
}

function isDealer(req: Request): boolean {
  return DEALER_ROLES.includes((req as AuthedRequest).user.role);
}

type ReturnWithRepair = { ret: DbRepairReturn; repair: DbRepair | null };

function returnOut(r: DbRepairReturn, repair: DbRepair | null | undefined, canSeeCosts: boolean) {
  return {
    id: r.id,
    returnId: r.returnId,
    repairId: r.repairId,
    repairTicket: repair?.repairId ?? undefined,
    customerId: r.customerId ?? undefined,
    customerName: repair?.customerName ?? undefined,
    mobile: repair?.mobile ?? undefined,
    deviceType: repair?.deviceType ?? undefined,
    brand: repair?.brand ?? undefined,
    model: repair?.model ?? undefined,
    imei: repair?.imei ?? undefined,
    // Original repair history (read-only reference — the original record is
    // never duplicated or edited by the after-sales case).
    originalProblem: repair?.problem ?? undefined,
    originalReceiveDate: repair?.receiveDate ?? undefined,
    originalDeliveryDate: repair?.deliveryDate ?? undefined,
    originalAmount: repair ? Math.max(repair.repairCharge + repair.partsCharge, 0) : undefined,
    status: r.status,
    returnDate: r.returnDate,
    daysAfterDelivery: r.daysAfterDelivery ?? undefined,
    reason: r.reason,
    complaint: r.complaint,
    deviceCondition: r.deviceCondition ?? undefined,
    underWarranty: r.underWarranty,
    receivedByName: r.receivedByName ?? undefined,
    resolution: r.resolution ?? undefined,
    technicianId: r.technicianId ?? undefined,
    technicianName: r.technicianName ?? undefined,
    diagnosis: r.diagnosis ?? undefined,
    workPerformed: r.workPerformed ?? undefined,
    // partsCost is an INTERNAL cost — zeroed for non-privileged roles.
    partsCost: canSeeCosts ? r.partsCost : 0,
    // labourCost & customerPayable are customer-facing prices — always shown.
    labourCost: r.labourCost,
    customerPayable: r.customerPayable,
    canSeeCosts,
    notes: r.notes ?? undefined,
    completedAt: r.completedAt ? iso(r.completedAt) : undefined,
    createdAt: iso(r.createdAt),
  };
}

function refundOut(f: DbRefund, extra?: { repairTicket?: string; returnId?: string; customerName?: string }) {
  return {
    id: f.id,
    repairId: f.repairId,
    repairTicket: extra?.repairTicket,
    returnId: f.returnId,
    returnCaseId: extra?.returnId,
    customerId: f.customerId ?? undefined,
    customerName: extra?.customerName,
    amount: f.amount,
    originalPaid: f.originalPaid,
    method: f.method,
    status: f.status,
    reason: f.reason,
    referenceNo: f.referenceNo ?? undefined,
    requestedByName: f.requestedByName ?? undefined,
    approvedByName: f.approvedByName ?? undefined,
    approvedAt: f.approvedAt ? iso(f.approvedAt) : undefined,
    paidByName: f.paidByName ?? undefined,
    paidAt: f.paidAt ? iso(f.paidAt) : undefined,
    rejectionReason: f.rejectionReason ?? undefined,
    createdAt: iso(f.createdAt),
  };
}

async function logEvent(
  dbOrTx: Pick<typeof db, "insert">,
  args: { shopId: string; repairId: string; user: DbUser; action: string; details?: Record<string, unknown> },
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

async function loadReturn(res: Response, shopId: string, id: string): Promise<ReturnWithRepair | null> {
  const [row] = await db
    .select({ ret: repairReturnsTable, repair: repairsTable })
    .from(repairReturnsTable)
    .leftJoin(repairsTable, eq(repairReturnsTable.repairId, repairsTable.id))
    .where(and(eq(repairReturnsTable.id, id), eq(repairReturnsTable.shopId, shopId)));
  if (!row) {
    res.status(404).json({ message: "Return case not found" });
    return null;
  }
  return row;
}

// ── Create a return case ────────────────────────────────────────────────────

router.post(
  "/repairs/:id/returns",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const b = req.body ?? {};
    const reason = RETURN_REASONS.includes(b.reason) ? b.reason : null;
    const complaint = str(b.complaint);
    if (!reason || !complaint) {
      res.status(400).json({ message: "Return reason and customer complaint are required" });
      return;
    }
    const [repair] = await db
      .select()
      .from(repairsTable)
      .where(and(eq(repairsTable.id, String(req.params.id ?? "")), eq(repairsTable.shopId, shopId)));
    if (!repair) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    if (repair.status !== "delivered") {
      res.status(400).json({ message: "A return case can only be opened for a delivered repair." });
      return;
    }
    const returnDate = str(b.returnDate) ?? todayStr();
    let daysAfterDelivery: number | null = null;
    if (repair.deliveryDate) {
      const diff = Math.round(
        (new Date(`${returnDate}T00:00:00Z`).getTime() - new Date(`${repair.deliveryDate}T00:00:00Z`).getTime()) /
          86400000,
      );
      daysAfterDelivery = Number.isFinite(diff) ? Math.max(diff, 0) : null;
    }
    const underWarranty = Boolean(repair.warrantyExpiry && returnDate <= repair.warrantyExpiry);

    const created = await db.transaction(async (tx) => {
      // Lock the repair row to serialize concurrent return openings for the
      // same repair — combined with the unique (shop_id, return_id) index
      // this prevents duplicate AS-…-NN ids.
      await tx
        .select({ id: repairsTable.id })
        .from(repairsTable)
        .where(and(eq(repairsTable.id, repair.id), eq(repairsTable.shopId, shopId)))
        .for("update");
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(repairReturnsTable)
        .where(and(eq(repairReturnsTable.repairId, repair.id), eq(repairReturnsTable.shopId, shopId)));
      const [row] = await tx
        .insert(repairReturnsTable)
        .values({
          shopId,
          returnId: `AS-${repair.repairId}-${String(count + 1).padStart(2, "0")}`,
          repairId: repair.id,
          customerId: repair.customerId,
          status: "returned",
          returnDate,
          daysAfterDelivery,
          reason,
          complaint,
          deviceCondition: str(b.deviceCondition),
          underWarranty,
          receivedById: me.id,
          receivedByName: me.name,
        })
        .returning();
      await logEvent(tx, {
        shopId,
        repairId: repair.id,
        user: me,
        action: "return_opened",
        details: { returnId: row.returnId, reason, daysAfterDelivery, underWarranty },
      });
      return row;
    });
    res.json({ return: returnOut(created, repair, isPrivileged(req)) });
  }),
);

// ── List / detail ───────────────────────────────────────────────────────────

router.get(
  "/returns",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const rows = await db
      .select({ ret: repairReturnsTable, repair: repairsTable })
      .from(repairReturnsTable)
      .leftJoin(repairsTable, eq(repairReturnsTable.repairId, repairsTable.id))
      .where(eq(repairReturnsTable.shopId, shopId))
      .orderBy(desc(repairReturnsTable.createdAt));
    const canSeeCosts = isPrivileged(req);
    res.json({ returns: rows.map((r) => returnOut(r.ret, r.repair, canSeeCosts)) });
  }),
);

router.get(
  "/returns/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const found = await loadReturn(res, shopId, String(req.params.id ?? ""));
    if (!found) return;
    const [parts, refunds] = await Promise.all([
      db
        .select()
        .from(returnPartsTable)
        .where(and(eq(returnPartsTable.returnId, found.ret.id), eq(returnPartsTable.shopId, shopId)))
        .orderBy(desc(returnPartsTable.createdAt)),
      db
        .select()
        .from(refundsTable)
        .where(and(eq(refundsTable.returnId, found.ret.id), eq(refundsTable.shopId, shopId)))
        .orderBy(desc(refundsTable.createdAt)),
    ]);
    const canSeeCosts = isPrivileged(req);
    res.json({
      return: returnOut(found.ret, found.repair, canSeeCosts),
      canSeeCosts,
      parts: parts.map((p) => ({
        id: p.id,
        returnId: p.returnId,
        inventoryItemId: p.inventoryItemId ?? undefined,
        partName: p.partName,
        quantity: p.quantity,
        // return-part unitCost is an INTERNAL cost — zeroed for staff.
        unitCost: canSeeCosts ? p.unitCost : 0,
        canSeeCosts,
        addedByName: p.addedByName ?? undefined,
        createdAt: iso(p.createdAt),
      })),
      refunds: refunds.map((f) =>
        refundOut(f, {
          repairTicket: found.repair?.repairId,
          returnId: found.ret.returnId,
          customerName: found.repair?.customerName,
        }),
      ),
    });
  }),
);

// ── Update (status transitions + inspection/resolution) ────────────────────

router.patch(
  "/returns/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const found = await loadReturn(res, shopId, String(req.params.id ?? ""));
    if (!found) return;
    const { ret, repair } = found;
    const b = req.body ?? {};

    // A closed case is frozen: nothing can be edited by anyone until the
    // dealer/owner reopens it (status back to inspection).
    const reopening = ret.status === "closed" && b.status === "inspection";
    if (ret.status === "closed" && !reopening) {
      res.status(isDealer(req) ? 400 : 403).json({
        message: "This return case is closed. The dealer/owner must reopen it first.",
      });
      return;
    }

    const patch: Partial<typeof repairReturnsTable.$inferInsert> = {};
    const events: Array<{ action: string; details?: Record<string, unknown> }> = [];

    if (b.status !== undefined) {
      const status = RETURN_STATUSES.includes(b.status) ? (b.status as string) : null;
      if (!status) {
        res.status(400).json({ message: "Invalid return status" });
        return;
      }
      if (status !== ret.status) {
        // Refund statuses are managed by the refund endpoints only.
        if (REFUND_FLOW_STATUSES.includes(status)) {
          res.status(400).json({ message: "Refund statuses are set through the refund request/approval flow." });
          return;
        }
        // Reopening a closed case and dealer-only targets require dealer.
        if ((DEALER_ONLY_STATUSES.includes(status) || reopening) && !isDealer(req)) {
          res.status(403).json({ message: "Dealer/Owner approval required." });
          return;
        }
        // Enforce the state machine — no skipping steps (e.g. staff jumping
        // from returned straight to repaired past inspection/rework approval).
        if (!reopening && !(ALLOWED_TRANSITIONS[status] ?? []).includes(ret.status)) {
          res.status(400).json({
            message: `Cannot move from '${ret.status.replace(/_/g, " ")}' to '${status.replace(/_/g, " ")}'.`,
          });
          return;
        }
        patch.status = status;
        if (COMPLETING_STATUSES.includes(status)) patch.completedAt = new Date();
        events.push({
          action: reopening ? "return_reopened" : "return_status_changed",
          details: { returnId: ret.returnId, from: ret.status, to: status },
        });
      }
    }

    if (b.resolution !== undefined) {
      const resolution = RESOLUTIONS.includes(b.resolution) ? (b.resolution as string) : null;
      if (!resolution) {
        res.status(400).json({ message: "Invalid resolution" });
        return;
      }
      patch.resolution = resolution;
      events.push({ action: "return_resolved", details: { returnId: ret.returnId, resolution } });
    }

    if (b.technicianId !== undefined || b.technicianName !== undefined) {
      patch.technicianId = str(b.technicianId);
      patch.technicianName = str(b.technicianName);
      events.push({
        action: "return_technician_assigned",
        details: { returnId: ret.returnId, technicianName: str(b.technicianName) },
      });
    }
    if (b.diagnosis !== undefined) patch.diagnosis = str(b.diagnosis);
    if (b.workPerformed !== undefined) patch.workPerformed = str(b.workPerformed);
    if (b.deviceCondition !== undefined) patch.deviceCondition = str(b.deviceCondition);
    if (b.notes !== undefined) patch.notes = str(b.notes);
    if (b.labourCost !== undefined) patch.labourCost = Math.max(num(b.labourCost), 0);
    if (b.customerPayable !== undefined) patch.customerPayable = Math.max(num(b.customerPayable), 0);

    if (!Object.keys(patch).length) {
      res.json({ return: returnOut(ret, repair, isPrivileged(req)) });
      return;
    }

    // All checks above ran against an unlocked read — re-verify under a row
    // lock and only write if the status hasn't moved since (CAS). This
    // serializes PATCH with concurrent close/refund/parts operations so a
    // stale transition can never overwrite a newer state (e.g. a close
    // clobbering refund_requested, or edits landing on a just-closed case).
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(repairReturnsTable)
        .set(patch)
        .where(
          and(
            eq(repairReturnsTable.id, ret.id),
            eq(repairReturnsTable.shopId, shopId),
            eq(repairReturnsTable.status, ret.status),
          ),
        )
        .returning();
      if (!row) throw new Error("STATUS_MOVED");
      for (const ev of events) {
        await logEvent(tx, { shopId, repairId: ret.repairId, user: me, action: ev.action, details: ev.details });
      }
      return row;
    }).catch((err) => {
      if (err instanceof Error && err.message === "STATUS_MOVED") return null;
      throw err;
    });
    if (!updated) {
      res.status(409).json({ message: "This case was just updated by someone else — please refresh and retry." });
      return;
    }
    res.json({ return: returnOut(updated, repair, isPrivileged(req)) });
  }),
);

// ── Parts used during rework (deducts inventory) ────────────────────────────

router.post(
  "/returns/:id/parts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const b = req.body ?? {};
    const quantity = Math.trunc(num(b.quantity, 0));
    if (quantity < 1) {
      res.status(400).json({ message: "Quantity must be at least 1" });
      return;
    }
    const inventoryItemId = str(b.inventoryItemId);
    let partName = str(b.partName);
    let unitCost = Math.max(num(b.unitCost), 0);

    try {
      const created = await db.transaction(async (tx) => {
        // Lock the return row so a concurrent close can't slip past the check.
        const [ret] = await tx
          .select()
          .from(repairReturnsTable)
          .where(and(eq(repairReturnsTable.id, String(req.params.id ?? "")), eq(repairReturnsTable.shopId, shopId)))
          .for("update");
        if (!ret) throw new Error("NOT_FOUND");
        if (ret.status === "closed") throw new Error("CASE_CLOSED");
        if (inventoryItemId) {
          // Atomic stock deduction — fails if not enough stock.
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
          if (b.unitCost === undefined) unitCost = item.purchasePrice;
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
            reason: "return_part",
            repairId: ret.repairId,
            returnId: ret.id,
            byId: me.id,
            byName: me.name,
          });
        }
        const [row] = await tx
          .insert(returnPartsTable)
          .values({
            shopId,
            returnId: ret.id,
            inventoryItemId,
            partName,
            quantity,
            unitCost,
            addedById: me.id,
            addedByName: me.name,
          })
          .returning();
        // Keep the return's parts cost in sync (derived, not client-provided).
        const [{ total }] = await tx
          .select({ total: sql<number>`coalesce(sum(${returnPartsTable.quantity} * ${returnPartsTable.unitCost}), 0)::float` })
          .from(returnPartsTable)
          .where(and(eq(returnPartsTable.returnId, ret.id), eq(returnPartsTable.shopId, shopId)));
        await tx
          .update(repairReturnsTable)
          .set({ partsCost: total })
          .where(eq(repairReturnsTable.id, ret.id));
        await logEvent(tx, {
          shopId,
          repairId: ret.repairId,
          user: me,
          action: "return_part_used",
          details: { returnId: ret.returnId, partName, quantity, inventoryItemId },
        });
        return row;
      });
      const canSeeCosts = isPrivileged(req);
      res.json({
        part: {
          id: created.id,
          returnId: created.returnId,
          inventoryItemId: created.inventoryItemId ?? undefined,
          partName: created.partName,
          quantity: created.quantity,
          // return-part unitCost is an INTERNAL cost — zeroed for staff.
          unitCost: canSeeCosts ? created.unitCost : 0,
          canSeeCosts,
          addedByName: created.addedByName ?? undefined,
          createdAt: iso(created.createdAt),
        },
      });
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND") {
        res.status(404).json({ message: "Return case not found" });
        return;
      }
      if (err instanceof Error && err.message === "CASE_CLOSED") {
        res.status(400).json({ message: "This return case is closed." });
        return;
      }
      if (err instanceof Error && err.message === "OUT_OF_STOCK") {
        res.status(400).json({ message: "Not enough stock for this part." });
        return;
      }
      if (err instanceof Error && err.message === "PART_NAME_REQUIRED") {
        res.status(400).json({ message: "Part name is required when no inventory item is selected." });
        return;
      }
      throw err;
    }
  }),
);

// ── Refunds ─────────────────────────────────────────────────────────────────

router.post(
  "/returns/:id/refunds",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const b = req.body ?? {};
    const amount = num(b.amount, NaN);
    const reason = str(b.reason);
    if (!Number.isFinite(amount) || amount <= 0 || !reason) {
      res.status(400).json({ message: "A positive refund amount and a reason are required" });
      return;
    }
    const method = REFUND_METHODS.includes(b.method) ? b.method : "Cash";
    const dealer = isDealer(req);

    const result = await db.transaction(async (tx) => {
      // Lock the return row: serializes concurrent refund requests and a
      // concurrent close, and guarantees we act on the current status.
      const [ret] = await tx
        .select()
        .from(repairReturnsTable)
        .where(and(eq(repairReturnsTable.id, String(req.params.id ?? "")), eq(repairReturnsTable.shopId, shopId)))
        .for("update");
      if (!ret) return { error: { status: 404, message: "Return case not found" } };
      if (ret.status === "closed") {
        return { error: { status: 400, message: "This return case is closed." } };
      }
      // Lock the repair too — the refundable balance is repair-level, so
      // parallel refunds across multiple return cases must serialize here.
      const [repair] = await tx
        .select()
        .from(repairsTable)
        .where(and(eq(repairsTable.id, ret.repairId), eq(repairsTable.shopId, shopId)))
        .for("update");
      const originalPaid = repair ? Math.max(repair.repairCharge + repair.partsCharge, 0) : 0;
      // Cumulative cap: everything not rejected (pending + approved + paid)
      // across ALL return cases of this repair counts against the balance.
      const [{ committed }] = await tx
        .select({
          committed: sql<number>`coalesce(sum(${refundsTable.amount}) filter (where ${refundsTable.status} <> 'rejected'), 0)::float`,
        })
        .from(refundsTable)
        .where(and(eq(refundsTable.repairId, ret.repairId), eq(refundsTable.shopId, shopId)));
      if (amount + committed > originalPaid) {
        const remaining = Math.max(originalPaid - committed, 0);
        return {
          error: {
            status: 400,
            message: `Refund cannot exceed the remaining refundable amount (₹${remaining} of ₹${originalPaid}).`,
          },
        };
      }
      const [row] = await tx
        .insert(refundsTable)
        .values({
          shopId,
          repairId: ret.repairId,
          returnId: ret.id,
          customerId: ret.customerId,
          amount,
          originalPaid,
          method,
          // Dealer's own refunds don't need approval; staff refunds do.
          status: dealer ? "approved" : "pending_approval",
          reason,
          requestedById: me.id,
          requestedByName: me.name,
          ...(dealer ? { approvedById: me.id, approvedByName: me.name, approvedAt: new Date() } : {}),
        })
        .returning();
      // Mirror the refund transaction onto the case status (spec statuses
      // refund_requested / refund_approved are transaction-driven only).
      await tx
        .update(repairReturnsTable)
        .set({ status: dealer ? "refund_approved" : "refund_requested" })
        .where(and(eq(repairReturnsTable.id, ret.id), eq(repairReturnsTable.shopId, shopId)));
      await logEvent(tx, {
        shopId,
        repairId: ret.repairId,
        user: me,
        action: dealer ? "refund_approved" : "refund_requested",
        details: { returnId: ret.returnId, amount, method, reason },
      });
      return { row, ret, repair };
    });
    if ("error" in result && result.error) {
      res.status(result.error.status).json({ message: result.error.message });
      return;
    }
    res.json({
      refund: refundOut(result.row, {
        repairTicket: result.repair?.repairId,
        returnId: result.ret.returnId,
        customerName: result.repair?.customerName,
      }),
    });
  }),
);

router.get(
  "/refunds",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    // Refund amounts are money figures — only finance-visible roles may list
    // them. Other staff get 403 (consistent with the dashboard finance gate).
    if (!canSeeFinance(req)) {
      res.status(403).json({ message: "Only dealer/owner or accountant may view refunds." });
      return;
    }
    const rows = await db
      .select({ refund: refundsTable, repair: repairsTable, ret: repairReturnsTable })
      .from(refundsTable)
      .leftJoin(repairsTable, eq(refundsTable.repairId, repairsTable.id))
      .leftJoin(repairReturnsTable, eq(refundsTable.returnId, repairReturnsTable.id))
      .where(eq(refundsTable.shopId, shopId))
      .orderBy(desc(refundsTable.createdAt));
    res.json({
      refunds: rows.map((r) =>
        refundOut(r.refund, {
          repairTicket: r.repair?.repairId,
          returnId: r.ret?.returnId,
          customerName: r.repair?.customerName,
        }),
      ),
      pendingCount: rows.filter((r) => r.refund.status === "pending_approval").length,
    });
  }),
);

function dealerOr403(req: Request, res: Response): DbUser | null {
  if (!isDealer(req)) {
    res.status(403).json({ message: "Dealer/Owner approval required." });
    return null;
  }
  return (req as AuthedRequest).user;
}

// Atomically claim a refund in an expected status; exactly one concurrent
// decision wins (conditional UPDATE ... WHERE status = expected).
async function claimRefund(
  tx: Pick<typeof db, "update" | "select">,
  shopId: string,
  id: string,
  expected: string,
  set: Partial<typeof refundsTable.$inferInsert>,
): Promise<DbRefund | { error: { status: number; message: string } }> {
  const [claimed] = await tx
    .update(refundsTable)
    .set(set)
    .where(and(eq(refundsTable.id, id), eq(refundsTable.shopId, shopId), eq(refundsTable.status, expected)))
    .returning();
  if (claimed) return claimed;
  const [existing] = await tx
    .select()
    .from(refundsTable)
    .where(and(eq(refundsTable.id, id), eq(refundsTable.shopId, shopId)));
  return existing
    ? { error: { status: 400, message: `This refund is ${existing.status.replace("_", " ")} — expected ${expected.replace("_", " ")}.` } }
    : { error: { status: 404, message: "Refund not found" } };
}

router.post(
  "/refunds/:id/approve",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = dealerOr403(req, res);
    if (!me) return;
    const b = req.body ?? {};
    const result = await db.transaction(async (tx) => {
      const set: Partial<typeof refundsTable.$inferInsert> = {
        status: "approved",
        approvedById: me.id,
        approvedByName: me.name,
        approvedAt: new Date(),
      };
      if (b.amount !== undefined) {
        const amount = num(b.amount, NaN);
        if (!Number.isFinite(amount) || amount <= 0) return { error: { status: 400, message: "Invalid refund amount" } };
        set.amount = amount;
      }
      const claimed = await claimRefund(tx, shopId, String(req.params.id ?? ""), "pending_approval", set);
      if ("error" in claimed) return claimed;
      // Re-check the cumulative cap (dealer may have raised the amount, and
      // other refunds may have been approved since the request was filed).
      await tx
        .select({ id: repairsTable.id })
        .from(repairsTable)
        .where(and(eq(repairsTable.id, claimed.repairId), eq(repairsTable.shopId, shopId)))
        .for("update");
      const [{ committedOther }] = await tx
        .select({
          committedOther: sql<number>`coalesce(sum(${refundsTable.amount}) filter (where ${refundsTable.status} <> 'rejected' and ${refundsTable.id} <> ${claimed.id}), 0)::float`,
        })
        .from(refundsTable)
        .where(and(eq(refundsTable.repairId, claimed.repairId), eq(refundsTable.shopId, shopId)));
      if (claimed.amount + committedOther > claimed.originalPaid) {
        throw Object.assign(new Error("AMOUNT_TOO_HIGH"), {
          originalPaid: Math.max(claimed.originalPaid - committedOther, 0),
        });
      }
      if (claimed.returnId) {
        await tx
          .update(repairReturnsTable)
          .set({ status: "refund_approved" })
          .where(
            and(
              eq(repairReturnsTable.id, claimed.returnId),
              eq(repairReturnsTable.shopId, shopId),
              eq(repairReturnsTable.status, "refund_requested"),
            ),
          );
      }
      await logEvent(tx, {
        shopId,
        repairId: claimed.repairId,
        user: me,
        action: "refund_approved",
        details: { refundId: claimed.id, amount: claimed.amount },
      });
      return claimed;
    }).catch((err) => {
      if (err instanceof Error && err.message === "AMOUNT_TOO_HIGH") {
        return { error: { status: 400, message: `Refund cannot exceed the original charge (₹${(err as Error & { originalPaid: number }).originalPaid}).` } };
      }
      throw err;
    });
    if ("error" in result) {
      res.status(result.error.status).json({ message: result.error.message });
      return;
    }
    res.json({ refund: refundOut(result) });
  }),
);

router.post(
  "/refunds/:id/reject",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = dealerOr403(req, res);
    if (!me) return;
    const reason = str((req.body ?? {}).reason);
    if (!reason) {
      res.status(400).json({ message: "A rejection reason is required" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const claimed = await claimRefund(tx, shopId, String(req.params.id ?? ""), "pending_approval", {
        status: "rejected",
        approvedById: me.id,
        approvedByName: me.name,
        approvedAt: new Date(),
        rejectionReason: reason,
      });
      if ("error" in claimed) return claimed;
      if (claimed.returnId) {
        // A rejected request drops the case back to inspection so work can
        // continue (only if the case was sitting in refund_requested).
        await tx
          .update(repairReturnsTable)
          .set({ status: "inspection" })
          .where(
            and(
              eq(repairReturnsTable.id, claimed.returnId),
              eq(repairReturnsTable.shopId, shopId),
              eq(repairReturnsTable.status, "refund_requested"),
            ),
          );
      }
      await logEvent(tx, {
        shopId,
        repairId: claimed.repairId,
        user: me,
        action: "refund_rejected",
        details: { refundId: claimed.id, amount: claimed.amount, reason },
      });
      return claimed;
    });
    if ("error" in result) {
      res.status(result.error.status).json({ message: result.error.message });
      return;
    }
    res.json({ refund: refundOut(result) });
  }),
);

router.post(
  "/refunds/:id/mark-paid",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = dealerOr403(req, res);
    if (!me) return;
    const referenceNo = str((req.body ?? {}).referenceNo);
    const result = await db.transaction(async (tx) => {
      const claimed = await claimRefund(tx, shopId, String(req.params.id ?? ""), "approved", {
        status: "paid",
        paidById: me.id,
        paidByName: me.name,
        paidAt: new Date(),
        ...(referenceNo ? { referenceNo } : {}),
      });
      if ("error" in claimed) return claimed;
      // The refund is a separate financial transaction — the original income
      // stays untouched in the books.
      const [ret] = await tx
        .select()
        .from(repairReturnsTable)
        .where(eq(repairReturnsTable.id, claimed.returnId));
      await tx.insert(financeEntriesTable).values({
        shopId,
        type: "expense",
        category: "Refund",
        amount: claimed.amount,
        description: `REFUND ${ret?.returnId ?? ""}${referenceNo ? ` · Ref ${referenceNo}` : ""}`.trim(),
        paymentMethod: claimed.method,
        date: todayStr(),
      });
      if (claimed.returnId) {
        await tx
          .update(repairReturnsTable)
          .set({ status: "refund_paid", completedAt: new Date() })
          .where(
            and(
              eq(repairReturnsTable.id, claimed.returnId),
              eq(repairReturnsTable.shopId, shopId),
              eq(repairReturnsTable.status, "refund_approved"),
            ),
          );
      }
      await logEvent(tx, {
        shopId,
        repairId: claimed.repairId,
        user: me,
        action: "refund_paid",
        details: { refundId: claimed.id, amount: claimed.amount, method: claimed.method, referenceNo },
      });
      return claimed;
    });
    if ("error" in result) {
      res.status(result.error.status).json({ message: result.error.message });
      return;
    }
    res.json({ refund: refundOut(result) });
  }),
);

export default router;
