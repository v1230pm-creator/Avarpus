import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  approvalRequestsTable,
  repairsTable,
  repairPaymentsTable,
  repairEventsTable,
  purchasesTable,
  financeEntriesTable,
  customersTable,
  type DbUser,
  type DbApprovalRequest,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireFeature } from "../lib/roleFeatures";
import { notifyShop } from "../lib/notify";
import { asyncHandler } from "../lib/asyncHandler";
import { recordPayment } from "../lib/repairPayments";
import type { Request, Response } from "express";

// Backdated-entry approval workflow.
// Staff cannot save records dated before today (enforced in business routes);
// instead they file a request here. The dealer/owner reviews it: on approval
// the record is saved server-side with the requested (old) date; on rejection
// nothing is saved. Requests are never deleted — they are the audit trail.

const router: IRouter = Router();

type AuthedRequest = Request & { user: DbUser };

const RECORD_TYPES = ["repair", "purchase", "finance"] as const;
const DECIDER_ROLES = ["dealer", "super_admin"];

const todayStr = () => new Date().toISOString().split("T")[0];

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().split("T")[0] === s;
}

function shopIdOr403(req: Request, res: Response): string | null {
  const me = (req as AuthedRequest).user;
  if (!me.shopId) {
    res.status(403).json({ message: "Your account is not linked to a shop." });
    return null;
  }
  return me.shopId;
}

function approvalOut(a: DbApprovalRequest) {
  return {
    id: a.id,
    requesterId: a.requesterId,
    requesterName: a.requesterName,
    requesterRole: a.requesterRole,
    recordType: a.recordType,
    mode: a.mode,
    recordId: a.recordId ?? undefined,
    payload: a.payload as Record<string, unknown>,
    requestedDate: a.requestedDate,
    reason: a.reason,
    status: a.status,
    decidedByName: a.decidedByName ?? undefined,
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : undefined,
    rejectionReason: a.rejectionReason ?? undefined,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get(
  "/approvals",
  requireAuth,
  requireFeature("approvals"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const where = DECIDER_ROLES.includes(me.role)
      ? eq(approvalRequestsTable.shopId, shopId)
      : and(eq(approvalRequestsTable.shopId, shopId), eq(approvalRequestsTable.requesterId, me.id));
    const rows = await db
      .select()
      .from(approvalRequestsTable)
      .where(where)
      .orderBy(desc(approvalRequestsTable.createdAt));
    res.json({
      approvals: rows.map(approvalOut),
      pendingCount: rows.filter((r) => r.status === "pending").length,
    });
  }),
);

router.post(
  "/approvals",
  requireAuth,
  requireFeature("approvals"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const b = req.body ?? {};
    const recordType = RECORD_TYPES.includes(b.recordType) ? b.recordType : null;
    const requestedDate = str(b.requestedDate);
    const reason = str(b.reason);
    const mode = b.mode === "update" ? "update" : "create";
    const recordId = str(b.recordId);
    const payload = b.payload && typeof b.payload === "object" && !Array.isArray(b.payload) ? b.payload : null;
    if (!recordType || !requestedDate || !reason || !payload) {
      res.status(400).json({ message: "recordType, payload, requestedDate and reason are required" });
      return;
    }
    if (!isValidDateStr(requestedDate)) {
      res.status(400).json({ message: "requestedDate must be a valid YYYY-MM-DD date" });
      return;
    }
    if (requestedDate >= todayStr()) {
      res.status(400).json({ message: "Approval is only needed for dates before today — save the record normally." });
      return;
    }
    if (mode === "update" && !recordId) {
      res.status(400).json({ message: "recordId is required for update requests" });
      return;
    }
    const [created] = await db
      .insert(approvalRequestsTable)
      .values({
        shopId,
        requesterId: me.id,
        requesterName: me.name,
        requesterRole: me.role,
        recordType,
        mode,
        recordId,
        payload,
        requestedDate,
        reason,
      })
      .returning();
    void notifyShop({
      shopId,
      type: "approval_requested",
      title: "Approval needed",
      body: `${me.name} requested a backdated ${recordType} (${requestedDate})`,
      data: { approvalId: created.id },
      actorId: me.id,
    });
    res.json({ approval: approvalOut(created) });
  }),
);

// Save the approved record with the requested (backdated) date. Runs inside
// the approval transaction so a failed save leaves the request pending.
async function executeApproved(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  a: DbApprovalRequest,
  approver: DbUser,
): Promise<void> {
  const p = a.payload as Record<string, unknown>;
  if (a.recordType === "repair") {
    if (a.mode === "update" && a.recordId) {
      // Apply the reviewed payload (allowlisted fields), not just the date.
      // NOTE: `advance` is NEVER written directly — it is a cached mirror of the
      // payments ledger. If the approved payload asks to raise the advance we
      // record the delta as a real payment row via recordPayment() below.
      // Lock the repair row and enforce the same stage lock as the generic
      // PATCH route: `problem` is frozen once the job has left 'received'.
      // Only an actual value change is rejected (payloads echo stored
      // values). Throwing here rolls back the claim, so the request stays
      // pending and nothing persists.
      const [lockedRepair] = await tx
        .select()
        .from(repairsTable)
        .where(and(eq(repairsTable.id, a.recordId), eq(repairsTable.shopId, a.shopId)))
        .for("update");
      if (!lockedRepair) throw new Error("APPROVAL_TARGET_GONE");
      // The complaint (problem) is permanently fixed once noted at intake —
      // no approval path may replace it at any stage. Echoed values pass.
      if (
        p.problem !== undefined &&
        (str(p.problem) ?? "") !== (lockedRepair.problem ?? "")
      ) {
        throw new Error("FIELD_LOCKED_STAGE");
      }
      const patch: Partial<typeof repairsTable.$inferInsert> = { receiveDate: a.requestedDate };
      if (p.problem !== undefined) patch.problem = str(p.problem) ?? undefined;
      if (p.notes !== undefined) patch.notes = str(p.notes);
      if (p.repairCharge !== undefined) patch.repairCharge = num(p.repairCharge);
      if (p.partsCharge !== undefined) patch.partsCharge = num(p.partsCharge);
      if (p.expectedDate !== undefined) patch.expectedDate = str(p.expectedDate) ?? undefined;
      await tx
        .update(repairsTable)
        .set(patch)
        .where(and(eq(repairsTable.id, a.recordId), eq(repairsTable.shopId, a.shopId)));
      // If the payload carries an advance, book only the difference between the
      // requested advance and what the ledger already holds — never rewrite it.
      if (p.advance !== undefined) {
        const requestedAdvance = num(p.advance);
        const [{ paidSoFar }] = await tx
          .select({ paidSoFar: sql<number>`coalesce(sum(${repairPaymentsTable.amount}) filter (where ${repairPaymentsTable.voidedAt} is null), 0)::float` })
          .from(repairPaymentsTable)
          .where(
            and(eq(repairPaymentsTable.repairId, a.recordId), eq(repairPaymentsTable.shopId, a.shopId)),
          );
        const delta = requestedAdvance - paidSoFar;
        if (delta > 0.01) {
          const [repair] = await tx
            .select()
            .from(repairsTable)
            .where(and(eq(repairsTable.id, a.recordId), eq(repairsTable.shopId, a.shopId)));
          await recordPayment(tx, {
            shopId: a.shopId,
            repairId: a.recordId,
            customerId: repair?.customerId ?? null,
            amount: delta,
            method: str(p.paymentMethod) ?? "Cash",
            kind: "advance",
            note: "Via backdated-entry approval",
            receivedById: a.requesterId,
            receivedByName: a.requesterName,
            financeDate: a.requestedDate,
          });
        }
      }
      return;
    }
    // Resolve or create the customer now — the client deliberately does not
    // create a customer for a pending request, so a rejected request leaves
    // no trace in the books.
    let customerId = str(p.customerId);
    const mobile = str(p.mobile) ?? "";
    if (!customerId && mobile) {
      const [existing] = await tx
        .select()
        .from(customersTable)
        .where(and(eq(customersTable.shopId, a.shopId), eq(customersTable.mobile, mobile)));
      customerId = existing?.id ?? null;
    }
    if (!customerId) {
      const [createdCustomer] = await tx
        .insert(customersTable)
        .values({
          shopId: a.shopId,
          name: str(p.customerName) ?? "Unknown",
          mobile,
          address: str(p.address),
        })
        .returning();
      customerId = createdCustomer.id;
    }
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(repairsTable)
      .where(eq(repairsTable.shopId, a.shopId));
    const [row] = await tx
      .insert(repairsTable)
      .values({
        shopId: a.shopId,
        repairId: `VMC-${String(count + 1).padStart(3, "0")}`,
        customerId,
        customerName: str(p.customerName) ?? "Unknown",
        mobile: str(p.mobile) ?? "",
        deviceType: str(p.deviceType) ?? "Other",
        brand: str(p.brand) ?? "Other",
        model: str(p.model) ?? "",
        imei: str(p.imei),
        alternateMobile: str(p.alternateMobile),
        accessories: str(p.accessories),
        problem: str(p.problem) ?? "",
        technicianId: str(p.technicianId),
        technicianName: str(p.technicianName),
        status: "received",
        priority: str(p.priority) ?? "normal",
        repairCharge: num(p.repairCharge),
        partsCharge: num(p.partsCharge),
        // advance is ledger-driven: created at 0, then any requested advance is
        // booked as a real payment row below (never written directly).
        advance: 0,
        receiveDate: a.requestedDate,
        expectedDate: str(p.expectedDate) ?? a.requestedDate,
        notes: str(p.notes),
        checklist: p.checklist && typeof p.checklist === "object" ? p.checklist : null,
        warrantyDays: [0, 7, 30, 90, 180].includes(num(p.warrantyDays)) ? num(p.warrantyDays) : 0,
        // Accountability: the original requester received the device — not
        // the approver, and never a client-supplied identity.
        receivedById: a.requesterId,
        receivedByName: a.requesterName,
      })
      .returning();
    await tx.insert(repairEventsTable).values({
      shopId: a.shopId,
      repairId: row.id,
      userId: a.requesterId,
      userName: a.requesterName,
      userRole: a.requesterRole,
      action: "created",
      details: {
        ticket: row.repairId,
        backdated: true,
        approvedByName: approver.name,
        approvalRequestId: a.id,
      },
    });
    // Any requested advance is booked as a real ledger payment (kind advance),
    // attributed to the original requester, dated to the approved date — this
    // is the ONLY way `repairs.advance` gets a non-zero value here.
    const requestedAdvance = num(p.advance);
    if (requestedAdvance > 0) {
      await recordPayment(tx, {
        shopId: a.shopId,
        repairId: row.id,
        customerId,
        amount: requestedAdvance,
        method: str(p.paymentMethod) ?? "Cash",
        kind: "advance",
        note: "Via backdated-entry approval",
        receivedById: a.requesterId,
        receivedByName: a.requesterName,
        financeDate: a.requestedDate,
      });
    }
    // Keep the customer's derived repair count in sync.
    const [{ repairCount }] = await tx
      .select({ repairCount: sql<number>`count(*) filter (where ${repairsTable.status} <> 'cancelled')::int` })
      .from(repairsTable)
      .where(and(eq(repairsTable.shopId, a.shopId), eq(repairsTable.customerId, customerId)));
    await tx
      .update(customersTable)
      .set({ totalRepairs: repairCount })
      .where(and(eq(customersTable.id, customerId), eq(customersTable.shopId, a.shopId)));
    return;
  }
  if (a.recordType === "purchase") {
    if (a.mode === "update" && a.recordId) {
      const patch: Partial<typeof purchasesTable.$inferInsert> = { date: a.requestedDate };
      if (p.invoiceNo !== undefined) patch.invoiceNo = str(p.invoiceNo) ?? "";
      if (p.supplier !== undefined) patch.supplier = str(p.supplier) ?? undefined;
      if (p.supplierMobile !== undefined) patch.supplierMobile = str(p.supplierMobile);
      if (p.itemName !== undefined) patch.itemName = str(p.itemName) ?? undefined;
      if (p.quantity !== undefined) patch.quantity = Math.trunc(num(p.quantity));
      if (p.purchasePrice !== undefined) patch.purchasePrice = num(p.purchasePrice);
      if (p.total !== undefined) patch.total = num(p.total);
      if (p.paymentStatus !== undefined) patch.paymentStatus = str(p.paymentStatus) ?? undefined;
      if (p.paymentMethod !== undefined) patch.paymentMethod = str(p.paymentMethod) ?? "Cash";
      await tx
        .update(purchasesTable)
        .set(patch)
        .where(and(eq(purchasesTable.id, a.recordId), eq(purchasesTable.shopId, a.shopId)));
      return;
    }
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(purchasesTable)
      .where(eq(purchasesTable.shopId, a.shopId));
    await tx.insert(purchasesTable).values({
      shopId: a.shopId,
      purchaseId: `PUR-${String(count + 1).padStart(3, "0")}`,
      invoiceNo: str(p.invoiceNo) ?? "",
      supplier: str(p.supplier) ?? "Unknown",
      supplierMobile: str(p.supplierMobile),
      itemName: str(p.itemName) ?? "",
      quantity: Math.trunc(num(p.quantity)),
      purchasePrice: num(p.purchasePrice),
      total: num(p.total),
      paymentStatus: str(p.paymentStatus) ?? "unpaid",
      paymentMethod: str(p.paymentMethod) ?? "Cash",
      date: a.requestedDate,
    });
    return;
  }
  // finance
  if (a.mode === "update" && a.recordId) {
    const patch: Partial<typeof financeEntriesTable.$inferInsert> = { date: a.requestedDate };
    if (p.type === "income" || p.type === "expense") patch.type = p.type;
    if (p.category !== undefined) patch.category = str(p.category) ?? undefined;
    if (p.amount !== undefined) patch.amount = num(p.amount);
    if (p.description !== undefined) patch.description = str(p.description) ?? "";
    if (p.paymentMethod !== undefined) patch.paymentMethod = str(p.paymentMethod) ?? "Cash";
    await tx
      .update(financeEntriesTable)
      .set(patch)
      .where(and(eq(financeEntriesTable.id, a.recordId), eq(financeEntriesTable.shopId, a.shopId)));
    return;
  }
  await tx.insert(financeEntriesTable).values({
    shopId: a.shopId,
    type: p.type === "income" ? "income" : "expense",
    category: str(p.category) ?? "Other",
    amount: num(p.amount),
    description: str(p.description) ?? "",
    paymentMethod: str(p.paymentMethod) ?? "Cash",
    date: a.requestedDate,
  });
}

// Atomically claim a pending request (conditional UPDATE ... WHERE
// status='pending'). Concurrent approve/reject calls race on this claim —
// exactly one wins; the loser sees "already decided". Runs inside the
// caller's transaction so a failed record save rolls the claim back too.
async function claimPending(
  tx: Pick<typeof db, "update" | "select">,
  shopId: string,
  id: string,
  set: Partial<typeof approvalRequestsTable.$inferInsert>,
): Promise<DbApprovalRequest | { error: { status: number; message: string } }> {
  const [claimed] = await tx
    .update(approvalRequestsTable)
    .set(set)
    .where(
      and(
        eq(approvalRequestsTable.id, id),
        eq(approvalRequestsTable.shopId, shopId),
        eq(approvalRequestsTable.status, "pending"),
      ),
    )
    .returning();
  if (claimed) return claimed;
  const [existing] = await tx
    .select()
    .from(approvalRequestsTable)
    .where(and(eq(approvalRequestsTable.id, id), eq(approvalRequestsTable.shopId, shopId)));
  return existing
    ? { error: { status: 400, message: `This request was already ${existing.status}.` } }
    : { error: { status: 404, message: "Approval request not found" } };
}

function deciderOr403(req: Request, res: Response): DbUser | null {
  const me = (req as AuthedRequest).user;
  if (!DECIDER_ROLES.includes(me.role)) {
    res.status(403).json({ message: "Only the dealer/owner can decide approval requests." });
    return null;
  }
  return me;
}

router.post(
  "/approvals/:id/approve",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = deciderOr403(req, res);
    if (!me) return;
    let result;
    try {
      result = await db.transaction(async (tx) => {
        const claimed = await claimPending(tx, shopId, String(req.params.id ?? ""), {
          status: "approved",
          decidedById: me.id,
          decidedByName: me.name,
          decidedAt: new Date(),
        });
        if ("error" in claimed) return claimed;
        // Save the record only after winning the claim; if this throws, the
        // whole transaction (claim included) rolls back and the request stays
        // pending.
        await executeApproved(tx, { ...claimed, status: "pending" }, me);
        return claimed;
      });
    } catch (err) {
      if (err instanceof Error && err.message === "FIELD_LOCKED_STAGE") {
        res.status(409).json({
          message: "The requested change edits a field that is locked at the repair's current stage.",
          code: "FIELD_LOCKED_STAGE",
        });
        return;
      }
      if (err instanceof Error && err.message === "APPROVAL_TARGET_GONE") {
        res.status(404).json({ message: "The repair for this request no longer exists." });
        return;
      }
      throw err;
    }
    if ("error" in result) {
      res.status(result.error.status).json({ message: result.error.message });
      return;
    }
    void notifyShop({
      shopId,
      type: "approval_decided",
      title: "Request approved",
      body: `${me.name} approved your backdated ${result.recordType} request`,
      data: { approvalId: result.id },
      actorId: me.id,
      extraUserIds: [result.requesterId],
    });
    res.json({ approval: approvalOut(result) });
  }),
);

router.post(
  "/approvals/:id/reject",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = deciderOr403(req, res);
    if (!me) return;
    const reason = str((req.body ?? {}).reason);
    if (!reason) {
      res.status(400).json({ message: "A rejection reason is required" });
      return;
    }
    const result = await claimPending(db, shopId, String(req.params.id ?? ""), {
      status: "rejected",
      decidedById: me.id,
      decidedByName: me.name,
      decidedAt: new Date(),
      rejectionReason: reason,
    });
    if ("error" in result) {
      res.status(result.error.status).json({ message: result.error.message });
      return;
    }
    void notifyShop({
      shopId,
      type: "approval_decided",
      title: "Request rejected",
      body: `${me.name} rejected your backdated ${result.recordType} request: ${reason}`,
      data: { approvalId: result.id },
      actorId: me.id,
      extraUserIds: [result.requesterId],
    });
    res.json({ approval: approvalOut(result) });
  }),
);

export default router;
