import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  db,
  dealerTransferRequestsTable,
  refundsTable,
  repairEventsTable,
  repairPaymentsTable,
  repairsTable,
  shopsTable,
  usersTable,
  type DbUser,
} from "@workspace/db";
import {
  DealersDirectoryQueryParams,
  DealersLookupQueryParams,
  DealerTransactionsListQueryParams,
  DealerTransfersDeclineBody,
  DealerTransfersListQueryParams,
  RepairsTransferBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { OWNER_ROLES, requireFeature, userHasFeature } from "../lib/roleFeatures";
import { asyncHandler } from "../lib/asyncHandler";
import { parseBody, parseQuery, uuidParam } from "../lib/validate";
import { normaliseIndianMobile } from "../lib/hanuOtp";
import { computeTotals, paymentStatusOf, portalRepairOut } from "../lib/repairProjection";
import { notifyShop, notifyUser } from "../lib/notify";
import {
  allRefundsForRepair,
  billPosted,
  dealerLedgerEntries,
  dealerLedgerParties,
  repairMoney,
  repairMoneyRows,
  sharedTimeline,
  transactionCodeOf,
  type LedgerDirection,
} from "../lib/dealerLedger";
import {
  ACTIVE_RESULT_STATUSES,
  dealerCodeOf,
  importTransferPhotos,
  importedRepairFields,
  transferRequestsOut,
  type TransferRow,
} from "../lib/dealerTransfers";

// ── Dealer-to-dealer transactions ───────────────────────────────────────────
// A registered shop (the "source dealer") sends a device to ANOTHER
// registered shop for repair. The repair lives ENTIRELY in the receiving
// shop's own repairs table and goes through their normal workflow — these
// routes only add: (1) discovery of the other shop by mobile, (2) a
// cross-shop READ so the sender can track their one sent-in row, and (3) a
// physical-receipt confirmation + status-change notifications back to the
// sender. Everything else (status transitions, money, notes, testing) stays
// on the existing repair endpoints in business.ts — unchanged.

const router: IRouter = Router();
router.param("id", uuidParam);

type AuthedRequest = Request & { user: DbUser };

function shopIdOr403(req: Request, res: Response): string | null {
  const me = (req as AuthedRequest).user;
  if (!me.shopId) {
    res.status(403).json({ message: "Your account is not linked to a shop." });
    return null;
  }
  return me.shopId;
}

// Timeline entries that reveal money movement; hidden from staff without
// the `payments` feature alongside the financial block itself.
const MONEY_EVENT_ACTIONS = new Set(["payment_recorded", "payment_voided"]);

// Full repair projection for the RECEIVING shop's own view (same shape as
// GET /repairs/:id). Kept local to avoid importing business.ts's router.
function fullRepairOut(r: typeof repairsTable.$inferSelect) {
  const t = computeTotals(r);
  return {
    id: r.id,
    repairId: r.repairId,
    customerName: r.customerName,
    mobile: r.mobile,
    deviceType: r.deviceType,
    brand: r.brand,
    model: r.model,
    imei: r.imei ?? undefined,
    imei2: r.imei2 ?? undefined,
    serialNumber: r.serialNumber ?? undefined,
    problem: r.problem,
    diagnosis: r.diagnosis ?? undefined,
    workPerformed: r.workPerformed ?? undefined,
    status: r.status,
    priority: r.priority,
    estimatedCost: r.estimatedCost ?? undefined,
    repairCharge: r.repairCharge,
    partsCharge: r.partsCharge,
    serviceCharge: r.serviceCharge,
    otherCharge: r.otherCharge,
    discount: r.discount,
    taxPercent: r.taxPercent,
    advance: r.advance,
    receiveDate: r.receiveDate,
    expectedDate: r.expectedDate,
    deliveryDate: r.deliveryDate ?? undefined,
    notes: r.notes ?? undefined,
    warrantyDays: r.warrantyDays,
    warrantyExpiry: r.warrantyExpiry ?? undefined,
    createdAt: r.createdAt.toISOString(),
    sourceDealerShopId: r.sourceDealerShopId ?? undefined,
    sourceDealerBusinessName: r.sourceDealerBusinessName ?? undefined,
    sourceDealerReceivedAt: r.sourceDealerReceivedAt
      ? r.sourceDealerReceivedAt.toISOString()
      : undefined,
    totalAmount: t.totalAmount,
    paidAmount: t.paidAmount,
    balance: t.balance,
    paymentStatus: paymentStatusOf(t.totalAmount, t.paidAmount),
    transactionCode: r.sourceDealerShopId ? transactionCodeOf(r) : undefined,
    sourceRepairId: r.sourceRepairId ?? undefined,
    sourceDealerUserId: r.sourceDealerUserId ?? undefined,
    // Imported device facts + who accepted, so the receiving shop's screens
    // can show "Received From / Received By" straight from the accept reply.
    color: r.color ?? undefined,
    storage: r.storage ?? undefined,
    ram: r.ram ?? undefined,
    accessories: r.accessories ?? undefined,
    accessoriesList: Array.isArray(r.accessoriesList) ? (r.accessoriesList as string[]) : undefined,
    deviceCondition: r.deviceCondition ?? undefined,
    receivedById: r.receivedById ?? undefined,
    receivedByName: r.receivedByName ?? undefined,
  };
}

// Outgoing (sender-side) projection — same read-only shape already used for
// the dealer-portal supplier view, plus the transaction's own metadata.
function outgoingRepairOut(r: typeof repairsTable.$inferSelect) {
  return {
    ...portalRepairOut(r),
    imei: r.imei ?? undefined,
    imei2: r.imei2 ?? undefined,
    serialNumber: r.serialNumber ?? undefined,
    // `notes` is deliberately omitted: the receiving shop may overwrite it
    // with internal notes that the sender must not see.
    createdAt: r.createdAt.toISOString(),
    sourceDealerShopId: r.sourceDealerShopId ?? undefined,
    sourceDealerBusinessName: r.sourceDealerBusinessName ?? undefined,
    sourceDealerReceivedAt: r.sourceDealerReceivedAt
      ? r.sourceDealerReceivedAt.toISOString()
      : undefined,
    transactionCode: transactionCodeOf(r),
  };
}

type PaymentRow = typeof repairPaymentsTable.$inferSelect;
type RefundRow = typeof refundsTable.$inferSelect;

// Shared money projections: the SAME rows shown to both shops. Only fields a
// counterpart is entitled to (no customer ids, no sample flags).
function sharedPaymentOut(p: PaymentRow) {
  return {
    id: p.id,
    repairId: p.repairId,
    amount: p.amount,
    method: p.method,
    kind: p.kind,
    note: p.note ?? undefined,
    referenceNo: p.referenceNo ?? undefined,
    receivedById: p.receivedById ?? undefined,
    receivedByName: p.receivedByName ?? undefined,
    voidedAt: p.voidedAt ? p.voidedAt.toISOString() : undefined,
    voidedById: p.voidedById ?? undefined,
    voidedByName: p.voidedByName ?? undefined,
    voidReason: p.voidReason ?? undefined,
    createdAt: p.createdAt.toISOString(),
  };
}

function sharedRefundOut(x: RefundRow) {
  return {
    id: x.id,
    repairId: x.repairId,
    returnId: x.returnId,
    amount: x.amount,
    originalPaid: x.originalPaid,
    method: x.method,
    status: x.status,
    reason: x.reason,
    referenceNo: x.referenceNo ?? undefined,
    requestedByName: x.requestedByName ?? undefined,
    approvedByName: x.approvedByName ?? undefined,
    approvedAt: x.approvedAt ? x.approvedAt.toISOString() : undefined,
    paidByName: x.paidByName ?? undefined,
    paidAt: x.paidAt ? x.paidAt.toISOString() : undefined,
    rejectionReason: x.rejectionReason ?? undefined,
    createdAt: x.createdAt.toISOString(),
  };
}

function parseDirection(raw: unknown): LedgerDirection | null {
  return raw === "receivable" || raw === "payable" ? raw : null;
}

router.get(
  "/dealers/lookup",
  requireAuth,
  // Resolving a mobile to a shop owner is only needed to start a transfer /
  // dealer transaction, so it carries the same bar as those mutations —
  // otherwise any staff login could probe owner mobiles.
  requireFeature("repairs_update"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const query = parseQuery(DealersLookupQueryParams, req, res);
    if (!query) return;
    const mobile = normaliseIndianMobile(query.mobile) ?? "";
    if (!/^\d{10}$/.test(mobile)) {
      res.status(400).json({ message: "Enter a valid 10-digit mobile number." });
      return;
    }
    const [row] = await db
      .select({
        shopId: shopsTable.id,
        businessName: shopsTable.businessName,
        ownerUserId: usersTable.id,
        ownerName: usersTable.name,
        ownerMobile: usersTable.mobile,
      })
      .from(usersTable)
      .innerJoin(shopsTable, eq(shopsTable.dealerId, usersTable.id))
      .where(and(
        eq(usersTable.mobile, mobile),
        inArray(usersTable.role, [...OWNER_ROLES]),
        eq(usersTable.isActive, true),
        ne(shopsTable.id, shopId),
      ))
      .limit(1);
    res.json({ match: row ?? null });
  }),
);

router.get(
  "/dealers/transactions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const query = parseQuery(DealerTransactionsListQueryParams, req, res);
    if (!query) return;
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const scopeFilter =
      query.direction === "incoming"
        ? and(eq(repairsTable.shopId, shopId), isNotNull(repairsTable.sourceDealerShopId))
        : eq(repairsTable.sourceDealerShopId, shopId);
    const where = query.status
      ? and(scopeFilter, eq(repairsTable.status, query.status))
      : scopeFilter;
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(repairsTable)
      .where(where);
    const rows = await db
      .select()
      .from(repairsTable)
      .where(where)
      .orderBy(desc(repairsTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const repairs =
      query.direction === "incoming" ? rows.map(fullRepairOut) : rows.map(outgoingRepairOut);
    res.json({ repairs, total: count, page, limit });
  }),
);

// ── Send to Dealer: transfer requests ───────────────────────────────────────
// Shop A offers one of ITS OWN repair rows to shop B. Until B accepts, the
// only thing that exists is the request row; B's repair queue is untouched.

router.get(
  "/dealers/directory",
  requireAuth,
  // The only thing the directory is for is sending a repair to another shop,
  // so discovery carries the same bar as POST /repairs/:id/transfer. Staff
  // who cannot send must not be able to confirm mobile → owner/shop links.
  requireFeature("repairs_update"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const query = parseQuery(DealersDirectoryQueryParams, req, res);
    if (!query) return;
    const q = query.q.trim();
    if (!q) {
      res.json({ dealers: [] });
      return;
    }
    // Owners paste numbers from contacts as "+91 98765 43210" / "098765…";
    // treat anything that normalises to a valid Indian mobile as an exact
    // owner-mobile lookup (never a prefix search — mobiles must not be
    // enumerable through this endpoint).
    const mobile = normaliseIndianMobile(q);
    const isMobile = mobile !== null;
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const codeLike = /^[0-9a-f-]{3,36}$/i.test(q) ? `${q.toLowerCase()}%` : null;
    const match = isMobile
      ? eq(usersTable.mobile, mobile)
      : or(
          ilike(shopsTable.businessName, like),
          ilike(usersTable.name, like),
          ...(codeLike ? [sql`${shopsTable.id}::text ILIKE ${codeLike}`] : []),
        );
    const rows = await db
      .select({
        shopId: shopsTable.id,
        businessName: shopsTable.businessName,
        address: shopsTable.address,
        ownerUserId: usersTable.id,
        ownerName: usersTable.name,
      })
      .from(shopsTable)
      .innerJoin(usersTable, eq(usersTable.id, shopsTable.dealerId))
      .where(and(
        // Verified shop owners only: the owner account itself must be an
        // active owner login (`dealer`, or the platform `super_admin` who
        // also runs a shop) — never portal/customer logins.
        inArray(usersTable.role, [...OWNER_ROLES]),
        eq(usersTable.isActive, true),
        ne(shopsTable.id, shopId),
        match,
      ))
      .orderBy(shopsTable.businessName)
      .limit(20);
    res.json({
      dealers: rows.map((r) => ({
        shopId: r.shopId,
        dealerCode: dealerCodeOf(r.shopId),
        businessName: r.businessName,
        ownerUserId: r.ownerUserId,
        ownerName: r.ownerName,
        address: r.address ?? undefined,
        matchedByMobile: isMobile,
      })),
    });
  }),
);

async function transferOut(row: TransferRow, callerShopId: string) {
  const [out] = await transferRequestsOut([row], callerShopId);
  return out;
}

router.post(
  "/repairs/:id/transfer",
  requireAuth,
  requireFeature("repairs_update"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const id = String(req.params.id ?? "");
    const body = parseBody(RepairsTransferBody, req, res);
    if (!body) return;
    if (body.receiverShopId === shopId) {
      res.status(400).json({ message: "Cannot send a device to your own shop." });
      return;
    }
    const [repair] = await db
      .select()
      .from(repairsTable)
      .where(and(eq(repairsTable.id, id), eq(repairsTable.shopId, shopId)))
      .limit(1);
    if (!repair) {
      res.status(404).json({ message: "Repair not found" });
      return;
    }
    if (repair.status === "delivered" || repair.status === "cancelled") {
      res.status(409).json({
        message: "This repair is already closed; only a device still with your shop can be sent to a dealer.",
        code: "REPAIR_CLOSED",
      });
      return;
    }
    const [receiver] = await db
      .select({
        shopId: shopsTable.id,
        businessName: shopsTable.businessName,
        ownerUserId: usersTable.id,
      })
      .from(shopsTable)
      .innerJoin(usersTable, eq(usersTable.id, shopsTable.dealerId))
      .where(and(
        eq(shopsTable.id, body.receiverShopId),
        inArray(usersTable.role, [...OWNER_ROLES]),
        eq(usersTable.isActive, true),
      ))
      .limit(1);
    if (!receiver) {
      res.status(404).json({ message: "That shop could not be found or is not a verified dealer." });
      return;
    }
    const [source] = await db
      .select({ businessName: shopsTable.businessName, ownerUserId: shopsTable.dealerId })
      .from(shopsTable)
      .where(eq(shopsTable.id, shopId))
      .limit(1);
    if (!source) {
      res.status(500).json({ message: "Could not resolve your shop." });
      return;
    }
    // Fast path for the common case; the partial unique index below is the
    // real guarantee against two concurrent sends.
    const [pendingReq] = await db
      .select({ id: dealerTransferRequestsTable.id, businessName: shopsTable.businessName })
      .from(dealerTransferRequestsTable)
      .innerJoin(shopsTable, eq(shopsTable.id, dealerTransferRequestsTable.receiverShopId))
      .where(and(eq(dealerTransferRequestsTable.sourceRepairId, repair.id), eq(dealerTransferRequestsTable.status, "pending")))
      .limit(1);
    if (pendingReq) {
      res.status(409).json({
        message: `This repair is already waiting for ${pendingReq.businessName} to accept. Cancel that request first.`,
        code: "TRANSFER_PENDING",
      });
      return;
    }
    // An accepted transfer still being repaired elsewhere holds the device.
    const [active] = await db
      .select({ id: dealerTransferRequestsTable.id, businessName: shopsTable.businessName })
      .from(dealerTransferRequestsTable)
      .innerJoin(repairsTable, eq(repairsTable.id, dealerTransferRequestsTable.resultRepairId))
      .innerJoin(shopsTable, eq(shopsTable.id, dealerTransferRequestsTable.receiverShopId))
      .where(and(
        eq(dealerTransferRequestsTable.sourceRepairId, repair.id),
        eq(dealerTransferRequestsTable.status, "accepted"),
        inArray(repairsTable.status, ACTIVE_RESULT_STATUSES),
      ))
      .limit(1);
    if (active) {
      res.status(409).json({
        message: `This device is currently with ${active.businessName}. It can be sent again once that repair is delivered.`,
        code: "TRANSFER_ACTIVE",
      });
      return;
    }
    let created: TransferRow;
    try {
      created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(dealerTransferRequestsTable)
          .values({
            sourceShopId: shopId,
            sourceRepairId: repair.id,
            sourceOwnerUserId: source.ownerUserId,
            sentById: me.id,
            sentByName: me.name,
            receiverShopId: receiver.shopId,
            receiverOwnerUserId: receiver.ownerUserId,
            status: "pending",
            message: body.message?.trim() || null,
          })
          .returning();
        await tx.insert(repairEventsTable).values({
          shopId,
          repairId: repair.id,
          userId: me.id,
          userName: me.name,
          userRole: me.role,
          action: "dealer_transfer_sent",
          details: {
            transferId: row.id,
            receiverShopId: receiver.shopId,
            receiverBusinessName: receiver.businessName,
          },
        });
        return row;
      });
    } catch (err) {
      // Partial unique index: one pending request per repair. Drizzle may
      // surface the pg error directly or wrapped as `cause`.
      const pgCode = (err as { code?: string })?.code ?? ((err as { cause?: { code?: string } })?.cause?.code);
      if (pgCode === "23505") {
        res.status(409).json({
          message: "This repair is already waiting for another dealer to accept. Cancel that request first.",
          code: "TRANSFER_PENDING",
        });
        return;
      }
      throw err;
    }
    void notifyShop({
      shopId: receiver.shopId,
      type: "dealer_transfer_request",
      title: `Incoming device from ${source.businessName}`,
      body: `${repair.brand} ${repair.model} — ${repair.problem}. Accept or decline in Dealer Transactions.`,
      data: { transferId: created.id, dealerTransfer: true },
    });
    res.json({ request: await transferOut(created, shopId) });
  }),
);

router.get(
  "/dealers/transfers",
  requireAuth,
  // Same read bar as GET /repairs: device details (IMEI, serial, problem)
  // are visible to staff who can see repairs, never to finance-only roles.
  requireFeature("repairs"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const query = parseQuery(DealerTransfersListQueryParams, req, res);
    if (!query) return;
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const scope =
      query.direction === "incoming"
        ? eq(dealerTransferRequestsTable.receiverShopId, shopId)
        : eq(dealerTransferRequestsTable.sourceShopId, shopId);
    const where = query.status ? and(scope, eq(dealerTransferRequestsTable.status, query.status)) : scope;
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dealerTransferRequestsTable)
      .where(where);
    const rows = await db
      .select()
      .from(dealerTransferRequestsTable)
      .where(where)
      .orderBy(desc(dealerTransferRequestsTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json({ requests: await transferRequestsOut(rows, shopId), total: count, page, limit });
  }),
);

async function loadTransferForParty(id: string, shopId: string): Promise<TransferRow | null> {
  const [row] = await db
    .select()
    .from(dealerTransferRequestsTable)
    .where(and(
      eq(dealerTransferRequestsTable.id, id),
      or(
        eq(dealerTransferRequestsTable.sourceShopId, shopId),
        eq(dealerTransferRequestsTable.receiverShopId, shopId),
      ),
    ))
    .limit(1);
  return row ?? null;
}

router.get(
  "/dealers/transfers/:id",
  requireAuth,
  // Same read bar as GET /repairs: device details (IMEI, serial, problem)
  // are visible to staff who can see repairs, never to finance-only roles.
  requireFeature("repairs"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const row = await loadTransferForParty(String(req.params.id ?? ""), shopId);
    if (!row) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    res.json({ request: await transferOut(row, shopId) });
  }),
);

router.post(
  "/dealers/transfers/:id/accept",
  requireAuth,
  requireFeature("repairs_update"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const id = String(req.params.id ?? "");
    const existing = await loadTransferForParty(id, shopId);
    if (!existing || existing.receiverShopId !== shopId) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    if (existing.status === "accepted" && existing.resultRepairId) {
      const [repair] = await db.select().from(repairsTable).where(eq(repairsTable.id, existing.resultRepairId));
      res.json({ request: await transferOut(existing, shopId), repair: repair ? fullRepairOut(repair) : undefined });
      return;
    }
    if (existing.status !== "pending") {
      res.status(409).json({ message: `This request was already ${existing.status}.`, code: "TRANSFER_NOT_PENDING" });
      return;
    }
    const [senderShop] = await db
      .select({ businessName: shopsTable.businessName, ownerUserId: shopsTable.dealerId })
      .from(shopsTable)
      .where(eq(shopsTable.id, existing.sourceShopId))
      .limit(1);
    const [receiverShop] = await db
      .select({ businessName: shopsTable.businessName })
      .from(shopsTable)
      .where(eq(shopsTable.id, shopId))
      .limit(1);
    if (!senderShop || !receiverShop) {
      res.status(409).json({ message: "The sending shop no longer exists.", code: "TRANSFER_NOT_PENDING" });
      return;
    }
    const [senderOwner] = await db
      .select({ id: usersTable.id, name: usersTable.name, mobile: usersTable.mobile })
      .from(usersTable)
      .where(eq(usersTable.id, senderShop.ownerUserId))
      .limit(1);
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const outcome = await db.transaction(async (tx) => {
      // Conditional claim: the first accept wins; a concurrent decline/cancel
      // or a second tap sees zero rows and leaves the queue untouched.
      const [claimed] = await tx
        .update(dealerTransferRequestsTable)
        .set({ status: "accepted", respondedById: me.id, respondedByName: me.name, respondedAt: now })
        .where(and(
          eq(dealerTransferRequestsTable.id, id),
          eq(dealerTransferRequestsTable.receiverShopId, shopId),
          eq(dealerTransferRequestsTable.status, "pending"),
        ))
        .returning();
      if (!claimed) return null;
      const [source] = await tx
        .select()
        .from(repairsTable)
        .where(eq(repairsTable.id, claimed.sourceRepairId))
        .for("update")
        .limit(1);
      if (!source) throw new Error("TRANSFER_SOURCE_MISSING");
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(repairsTable)
        .where(eq(repairsTable.shopId, shopId));
      const ticket = `VMC-${String(count + 1).padStart(3, "0")}`;
      const expectedDate =
        source.expectedDate && source.expectedDate >= today
          ? source.expectedDate
          : new Date(now.getTime() + 7 * 86400000).toISOString().split("T")[0];
      const [repair] = await tx
        .insert(repairsTable)
        .values({
          shopId,
          repairId: ticket,
          // The repairing shop's "customer" is the SENDING SHOP, never the
          // sender's end customer — their identity stays in the sender's books.
          customerName: `${senderShop.businessName} (Dealer)`,
          mobile: senderOwner?.mobile ?? "",
          ...importedRepairFields(source),
          status: "received",
          receiveDate: today,
          expectedDate,
          createdById: me.id,
          createdByName: me.name,
          receivedById: me.id,
          receivedByName: me.name,
          sourceDealerShopId: claimed.sourceShopId,
          sourceDealerUserId: senderOwner?.id ?? claimed.sourceOwnerUserId,
          sourceDealerBusinessName: senderShop.businessName,
          // Accepting IS the physical handover confirmation.
          sourceDealerReceivedAt: now,
          sourceRepairId: source.id,
        })
        .returning();
      const [linked] = await tx
        .update(dealerTransferRequestsTable)
        .set({ resultRepairId: repair.id })
        .where(eq(dealerTransferRequestsTable.id, claimed.id))
        .returning();
      await tx.insert(repairEventsTable).values([
        {
          shopId,
          repairId: repair.id,
          userId: me.id,
          userName: me.name,
          userRole: me.role,
          action: "dealer_transfer_accepted",
          details: {
            transferId: claimed.id,
            sourceShopId: claimed.sourceShopId,
            sourceBusinessName: senderShop.businessName,
            sourceTicket: source.repairId,
          },
        },
        {
          shopId,
          repairId: repair.id,
          userId: me.id,
          userName: me.name,
          userRole: me.role,
          action: "dealer_received",
          details: { sourceDealerShopId: claimed.sourceShopId, transferId: claimed.id },
        },
        {
          shopId: claimed.sourceShopId,
          repairId: source.id,
          userId: me.id,
          userName: me.name,
          userRole: me.role,
          action: "dealer_transfer_accepted",
          details: {
            transferId: claimed.id,
            receiverShopId: shopId,
            receiverBusinessName: receiverShop.businessName,
            resultRepairId: repair.id,
            resultTicket: repair.repairId,
          },
        },
      ]);
      return { request: linked, repair, source };
    });
    if (!outcome) {
      const fresh = await loadTransferForParty(id, shopId);
      res.status(409).json({
        message: `This request was already ${fresh?.status ?? "handled"}.`,
        code: "TRANSFER_NOT_PENDING",
      });
      return;
    }
    // Device photos travel with the device — copied into OUR namespace so
    // shop-scoped storage rules keep holding. Best-effort; never blocks accept.
    const importedPhotos = await importTransferPhotos({
      sourceRepairId: outcome.source.id,
      targetRepair: { id: outcome.repair.id, shopId },
      importedByName: `${senderShop.businessName} (transfer)`,
    });
    void notifyShop({
      shopId: outcome.request.sourceShopId,
      type: "dealer_transfer_accepted",
      title: `${receiverShop.businessName} accepted your device`,
      body: `${outcome.repair.brand} ${outcome.repair.model} (${outcome.source.repairId}) is now with ${receiverShop.businessName}.`,
      data: { repairId: outcome.repair.id, dealerTransaction: true, transferId: outcome.request.id },
    });
    res.json({
      request: await transferOut(outcome.request, shopId),
      repair: fullRepairOut(outcome.repair),
      importedPhotos,
    });
  }),
);

router.post(
  "/dealers/transfers/:id/decline",
  requireAuth,
  requireFeature("repairs_update"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const id = String(req.params.id ?? "");
    // Body is optional: an empty decline carries no reason.
    const hasBody = !!req.body && typeof req.body === "object" && Object.keys(req.body as object).length > 0;
    const body = hasBody ? parseBody(DealerTransfersDeclineBody, req, res) : {};
    if (!body) return;
    const existing = await loadTransferForParty(id, shopId);
    if (!existing || existing.receiverShopId !== shopId) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    if (existing.status === "declined") {
      res.json({ request: await transferOut(existing, shopId) });
      return;
    }
    const now = new Date();
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
    const [receiverShop] = await db
      .select({ businessName: shopsTable.businessName })
      .from(shopsTable)
      .where(eq(shopsTable.id, shopId))
      .limit(1);
    const declined = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(dealerTransferRequestsTable)
        .set({ status: "declined", respondedById: me.id, respondedByName: me.name, respondedAt: now, declineReason: reason })
        .where(and(
          eq(dealerTransferRequestsTable.id, id),
          eq(dealerTransferRequestsTable.receiverShopId, shopId),
          eq(dealerTransferRequestsTable.status, "pending"),
        ))
        .returning();
      if (!claimed) return null;
      await tx.insert(repairEventsTable).values({
        shopId: claimed.sourceShopId,
        repairId: claimed.sourceRepairId,
        userId: me.id,
        userName: me.name,
        userRole: me.role,
        action: "dealer_transfer_declined",
        details: {
          transferId: claimed.id,
          receiverShopId: shopId,
          receiverBusinessName: receiverShop?.businessName ?? "",
          reason: reason ?? undefined,
        },
      });
      return claimed;
    });
    if (!declined) {
      const fresh = await loadTransferForParty(id, shopId);
      res.status(409).json({ message: `This request was already ${fresh?.status ?? "handled"}.`, code: "TRANSFER_NOT_PENDING" });
      return;
    }
    const [source] = await db
      .select({ brand: repairsTable.brand, model: repairsTable.model, repairId: repairsTable.repairId })
      .from(repairsTable)
      .where(eq(repairsTable.id, declined.sourceRepairId))
      .limit(1);
    void notifyShop({
      shopId: declined.sourceShopId,
      type: "dealer_transfer_declined",
      title: `${receiverShop?.businessName ?? "The dealer"} declined your device`,
      body: `${source ? `${source.brand} ${source.model} (${source.repairId})` : "Your device"} was not accepted${reason ? `: ${reason}` : "."} You can send it to another dealer.`,
      data: { repairId: declined.sourceRepairId, transferId: declined.id },
    });
    res.json({ request: await transferOut(declined, shopId) });
  }),
);

router.post(
  "/dealers/transfers/:id/cancel",
  requireAuth,
  requireFeature("repairs_update"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const id = String(req.params.id ?? "");
    const existing = await loadTransferForParty(id, shopId);
    if (!existing || existing.sourceShopId !== shopId) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    if (existing.status === "cancelled") {
      res.json({ request: await transferOut(existing, shopId) });
      return;
    }
    const now = new Date();
    const cancelled = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(dealerTransferRequestsTable)
        .set({ status: "cancelled", respondedById: me.id, respondedByName: me.name, respondedAt: now })
        .where(and(
          eq(dealerTransferRequestsTable.id, id),
          eq(dealerTransferRequestsTable.sourceShopId, shopId),
          eq(dealerTransferRequestsTable.status, "pending"),
        ))
        .returning();
      if (!claimed) return null;
      await tx.insert(repairEventsTable).values({
        shopId,
        repairId: claimed.sourceRepairId,
        userId: me.id,
        userName: me.name,
        userRole: me.role,
        action: "dealer_transfer_cancelled",
        details: { transferId: claimed.id, receiverShopId: claimed.receiverShopId },
      });
      return claimed;
    });
    if (!cancelled) {
      const fresh = await loadTransferForParty(id, shopId);
      res.status(409).json({
        message: fresh?.status === "accepted"
          ? "The dealer already accepted this device; it can no longer be withdrawn."
          : `This request was already ${fresh?.status ?? "handled"}.`,
        code: "TRANSFER_NOT_PENDING",
      });
      return;
    }
    const [sourceShop] = await db
      .select({ businessName: shopsTable.businessName })
      .from(shopsTable)
      .where(eq(shopsTable.id, shopId))
      .limit(1);
    void notifyShop({
      shopId: cancelled.receiverShopId,
      type: "dealer_transfer_cancelled",
      title: `${sourceShop?.businessName ?? "The sender"} withdrew a device request`,
      body: "The incoming device request was cancelled before you responded.",
      data: { transferId: cancelled.id, dealerTransfer: true },
    });
    res.json({ request: await transferOut(cancelled, shopId) });
  }),
);

// ── Dealer ledger (Khata → Suppliers / dealer receivables) ─────────────────
// Registered BEFORE the `:id` routes so "ledger" is never parsed as an id.
// Read-only: balances are derived from the shared rows on every request.
// Any shop member with the `payments` feature may read (same rule as the
// customer khata); portal/customer roles never reach here (no own shop).
router.get(
  "/dealers/transactions/ledger",
  requireAuth,
  requireFeature("payments"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    res.json(await dealerLedgerParties(shopId));
  }),
);

router.get(
  "/dealers/transactions/ledger/:shopId",
  requireAuth,
  requireFeature("payments"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const otherShopId = String(req.params.shopId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(otherShopId)) {
      res.status(400).json({ message: "Invalid shop id" });
      return;
    }
    const direction = parseDirection(req.query.direction);
    if (!direction) {
      res.status(400).json({ message: "direction must be receivable or payable" });
      return;
    }
    if (otherShopId === shopId) {
      res.status(400).json({ message: "A shop has no dealer ledger with itself." });
      return;
    }
    const ledger = await dealerLedgerEntries(shopId, otherShopId, direction);
    if (!ledger) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    res.json(ledger);
  }),
);

router.get(
  "/dealers/transactions/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const id = String(req.params.id ?? "");
    const [row] = await db.select().from(repairsTable).where(eq(repairsTable.id, id));
    if (!row) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const isReceiver = row.shopId === shopId;
    const isSender = row.sourceDealerShopId === shopId;
    if (!isReceiver && !isSender) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    // Shared, side-independent facts: the same payment/refund rows, the
    // same timeline, the same derived balance — read once, shown to both.
    const [{ payments, refunds: paidRefunds }, refunds, events] = await Promise.all([
      repairMoneyRows(row.id),
      allRefundsForRepair(row.id),
      sharedTimeline(row),
    ]);
    const money = repairMoney(row, payments, paidRefunds);
    // Money is a separate permission from seeing the repair: staff without
    // the `payments` feature get the transaction and timeline but no
    // balances, payment rows, references or refunds.
    const canSeeMoney = await userHasFeature(req.user!, "payments");
    const shared = {
      transactionCode: transactionCodeOf(row),
      acceptance: row.sourceDealerReceivedAt ? ("received" as const) : ("waiting" as const),
      ...(canSeeMoney
        ? {
            financials: {
              ...money,
              liveTotal: computeTotals(row).totalAmount,
              billPosted: billPosted(row),
            },
            payments: payments.map(sharedPaymentOut),
            refunds: refunds
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
              .map(sharedRefundOut),
          }
        : {}),
      events: canSeeMoney ? events : events.filter((e) => !MONEY_EVENT_ACTIONS.has(e.action)),
    };
    if (isReceiver) {
      // Incoming: the counterpart is the shop that sent this device in.
      let counterpart = null as null | {
        shopId: string; businessName: string; ownerUserId: string; ownerName: string; ownerMobile: string;
      };
      if (row.sourceDealerShopId && row.sourceDealerUserId) {
        const [owner] = await db
          .select({ name: usersTable.name, mobile: usersTable.mobile })
          .from(usersTable)
          .where(eq(usersTable.id, row.sourceDealerUserId))
          .limit(1);
        counterpart = {
          shopId: row.sourceDealerShopId,
          businessName: row.sourceDealerBusinessName ?? "",
          ownerUserId: row.sourceDealerUserId,
          ownerName: owner?.name ?? "",
          ownerMobile: owner?.mobile ?? "",
        };
      }
      res.json({ repair: fullRepairOut(row), counterpart, side: "receiver", ...shared });
      return;
    }
    // Outgoing: the counterpart is the shop repairing the device.
    const [receiver] = await db
      .select({
        shopId: shopsTable.id,
        businessName: shopsTable.businessName,
        ownerUserId: usersTable.id,
        ownerName: usersTable.name,
        ownerMobile: usersTable.mobile,
      })
      .from(shopsTable)
      .innerJoin(usersTable, eq(usersTable.id, shopsTable.dealerId))
      .where(eq(shopsTable.id, row.shopId))
      .limit(1);
    res.json({ repair: outgoingRepairOut(row), counterpart: receiver ?? null, side: "sender", ...shared });
  }),
);

router.post(
  "/dealers/transactions/:id/receive",
  requireAuth,
  requireFeature("repairs_update"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const id = String(req.params.id ?? "");
    const [row] = await db
      .select()
      .from(repairsTable)
      .where(and(
        eq(repairsTable.id, id),
        eq(repairsTable.shopId, shopId),
        isNotNull(repairsTable.sourceDealerShopId),
      ));
    if (!row) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const me = (req as AuthedRequest).user;
    let updated = row;
    let accepted = false;
    if (!row.sourceDealerReceivedAt) {
      // Conditional claim: only the first confirmation wins, so two staff
      // tapping at once never produce two acceptance events.
      const result = await db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(repairsTable)
          .set({
            sourceDealerReceivedAt: new Date(),
            receivedById: row.receivedById ?? me.id,
            receivedByName: row.receivedByName ?? me.name,
          })
          .where(and(eq(repairsTable.id, id), isNull(repairsTable.sourceDealerReceivedAt)))
          .returning();
        if (!claimed) return null;
        await tx.insert(repairEventsTable).values({
          shopId,
          repairId: id,
          userId: me.id,
          userName: me.name,
          userRole: me.role,
          action: "dealer_received",
          details: { sourceDealerShopId: claimed.sourceDealerShopId },
        });
        return claimed;
      });
      if (result) {
        updated = result;
        accepted = true;
      } else {
        const [fresh] = await db.select().from(repairsTable).where(eq(repairsTable.id, id));
        if (fresh) updated = fresh;
      }
      if (accepted && updated.sourceDealerUserId) {
        void notifyUser({
          userId: updated.sourceDealerUserId,
          shopId: updated.sourceDealerShopId,
          type: "dealer_transaction_status",
          title: "Device received",
          body: `${updated.brand} ${updated.model} was received by the repairing shop.`,
          data: { repairId: updated.id, dealerTransaction: true },
          dedupeKey: `dealer-txn:${updated.id}:received`,
        });
      }
    }
    res.json({ repair: fullRepairOut(updated) });
  }),
);

export default router;
