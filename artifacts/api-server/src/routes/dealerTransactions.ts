import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import {
  db,
  repairsTable,
  shopsTable,
  usersTable,
  type DbUser,
} from "@workspace/db";
import {
  DealersLookupQueryParams,
  DealerTransactionsCreateBody,
  DealerTransactionsListQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireFeature } from "../lib/roleFeatures";
import { asyncHandler } from "../lib/asyncHandler";
import { parseBody, parseQuery, uuidParam } from "../lib/validate";
import { computeTotals, paymentStatusOf, portalRepairOut } from "../lib/repairProjection";
import { notifyShop, notifyUser } from "../lib/notify";

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
  };
}

// Outgoing (sender-side) projection — same read-only shape already used for
// the dealer-portal supplier view, plus the transaction's own metadata.
function outgoingRepairOut(r: typeof repairsTable.$inferSelect) {
  return {
    ...portalRepairOut(r),
    sourceDealerReceivedAt: r.sourceDealerReceivedAt
      ? r.sourceDealerReceivedAt.toISOString()
      : undefined,
  };
}

router.get(
  "/dealers/lookup",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const query = parseQuery(DealersLookupQueryParams, req, res);
    if (!query) return;
    const mobile = query.mobile.trim();
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
        eq(usersTable.role, "dealer"),
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

router.post(
  "/dealers/transactions",
  requireAuth,
  requireFeature("repairs_update"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    const body = parseBody(DealerTransactionsCreateBody, req, res);
    if (!body) return;
    if (body.receiverShopId === shopId) {
      res.status(400).json({ message: "Cannot send a device to your own shop." });
      return;
    }
    const [sourceShop] = await db
      .select({ businessName: shopsTable.businessName })
      .from(shopsTable)
      .where(eq(shopsTable.id, shopId))
      .limit(1);
    const [receiverShop] = await db
      .select({ id: shopsTable.id, ownerUserId: shopsTable.dealerId })
      .from(shopsTable)
      .where(eq(shopsTable.id, body.receiverShopId))
      .limit(1);
    if (!sourceShop || !receiverShop) {
      res.status(404).json({ message: "That shop could not be found." });
      return;
    }
    // Resolve the source shop's owner (needed as the notification/chat
    // target) directly via shops.dealerId — never by mobile matching.
    const [owner] = await db
      .select({ id: usersTable.id, name: usersTable.name, mobile: usersTable.mobile })
      .from(shopsTable)
      .innerJoin(usersTable, eq(usersTable.id, shopsTable.dealerId))
      .where(eq(shopsTable.id, shopId))
      .limit(1);
    if (!owner) {
      res.status(500).json({ message: "Could not resolve your shop's owner account." });
      return;
    }
    const customerName = body.customerName?.trim() || `${sourceShop.businessName} (Dealer)`;
    const customerMobile = body.customerMobile?.trim() || owner.mobile;
    const created = await db.transaction(async (tx) => {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(repairsTable)
        .where(eq(repairsTable.shopId, receiverShop.id));
      const repairId = `VMC-${String(count + 1).padStart(3, "0")}`;
      const [row] = await tx
        .insert(repairsTable)
        .values({
          shopId: receiverShop.id,
          repairId,
          customerName,
          mobile: customerMobile,
          deviceType: body.deviceType,
          brand: body.brand,
          model: body.model,
          imei: body.imei ?? null,
          imei2: body.imei2 ?? null,
          serialNumber: body.serialNumber ?? null,
          problem: body.problem,
          status: "received",
          priority: "normal",
          estimatedCost: body.estimatedCost ?? null,
          receiveDate: new Date().toISOString().split("T")[0],
          expectedDate: body.expectedDate,
          notes: body.notes ?? null,
          createdById: me.id,
          createdByName: me.name,
          sourceDealerShopId: shopId,
          sourceDealerUserId: owner.id,
          sourceDealerBusinessName: sourceShop.businessName,
        })
        .returning();
      return row;
    });
    void notifyShop({
      shopId: receiverShop.id,
      type: "dealer_transaction_incoming",
      title: `New device from ${sourceShop.businessName}`,
      body: `${created.brand} ${created.model} — ${created.problem}`,
      data: { repairId: created.id },
    });
    res.json({ repair: fullRepairOut(created) });
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
    if (row.shopId === shopId) {
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
      res.json({ repair: fullRepairOut(row), counterpart });
      return;
    }
    if (row.sourceDealerShopId === shopId) {
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
      res.json({ repair: outgoingRepairOut(row), counterpart: receiver ?? null });
      return;
    }
    res.status(404).json({ message: "Not found" });
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
    let updated = row;
    if (!row.sourceDealerReceivedAt) {
      [updated] = await db
        .update(repairsTable)
        .set({ sourceDealerReceivedAt: new Date() })
        .where(eq(repairsTable.id, id))
        .returning();
      if (updated.sourceDealerUserId) {
        void notifyUser({
          userId: updated.sourceDealerUserId,
          shopId: updated.sourceDealerShopId,
          type: "dealer_transaction_status",
          title: "Device received",
          body: `${updated.brand} ${updated.model} was received by the repairing shop.`,
          dedupeKey: `dealer-txn:${updated.id}:received`,
        });
      }
    }
    res.json({ repair: fullRepairOut(updated) });
  }),
);

export default router;
