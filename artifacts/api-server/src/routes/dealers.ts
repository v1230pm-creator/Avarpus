import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  dealersTable,
  repairsTable,
  repairReturnsTable,
  refundsTable,
  customerUsersTable,
  shopsTable,
  usersTable,
  type DbUser,
  type DbDealer,
} from "@workspace/db";
import {
  DealersCreateBody,
  DealersDetectQueryParams,
  DealersListQueryParams,
  DealersUpdateBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { isDealerPortalRole } from "../lib/dealerPortal";
import { requireFeature } from "../lib/roleFeatures";
import { lockNormalizedMobiles } from "../lib/mobileIdentityLock";
import { normaliseIndianMobile } from "../lib/hanuOtp";
import { getShopRoleFeatureMatrix } from "../lib/roleFeatures";
import { portalRepairOut } from "../lib/repairProjection";
import { parseBody, parseQuery, uuidParam } from "../lib/validate";
import type { Request, Response } from "express";

// ── B2B Dealer repair management ────────────────────────────────────────────
// Dealers are external parties (partner shops) whose devices come in for
// repair. Repairs link to a dealer via repairs.dealer_id (single record —
// never duplicated). All data is shop-scoped; dealer-portal accounts
// (dealer_owner / dealer_staff) only ever see their own dealer via
// /dealers/me (everything else is blocked in requireAuth).

const router: IRouter = Router();
router.param("id", uuidParam);
router.param("dealerId", uuidParam);

type AuthedRequest = Request & { user: DbUser };

function shopIdOr403(req: Request, res: Response): string | null {
  const me = (req as AuthedRequest).user;
  if (!me.shopId) {
    res.status(403).json({
      message: "Your account is not linked to a shop.",
    });
    return null;
  }
  return me.shopId;
}

const PRIVILEGED = ["dealer", "super_admin"];
const iso = (d: Date) => d.toISOString();
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

function dealerOut(d: DbDealer) {
  return {
    id: d.id,
    dealerCode: d.dealerCode,
    name: d.name,
    shopName: d.shopName ?? undefined,
    mobile: d.mobile,
    location: d.location ?? undefined,
    isActive: d.isActive,
    createdById: d.createdById ?? undefined,
    createdByName: d.createdByName ?? undefined,
    createdAt: iso(d.createdAt),
  };
}

// Per-dealer aggregate stats computed from the single source-of-truth
// repairs table (+ returns/refunds). Never cached — always live.
// `ownCustomerIds` widens the set for the dealer portal: repairs booked under
// the portal login's own walk-in customer rows count as theirs too, so the
// header numbers match the list the same login is shown.
async function dealerStats(shopId: string, dealerId: string, ownCustomerIds: string[] = []) {
  const owned: SQL = ownCustomerIds.length > 0
    ? (or(eq(repairsTable.dealerId, dealerId), inArray(repairsTable.customerId, ownCustomerIds)) as SQL)
    : eq(repairsTable.dealerId, dealerId);
  const [r] = await db
    .select({
      totalRepairs: sql<number>`count(*)::int`,
      received: sql<number>`count(*) filter (where ${repairsTable.status} = 'received')::int`,
      repairing: sql<number>`count(*) filter (where ${repairsTable.status} in ('diagnosing','waiting_parts','repairing','testing','customer_approval'))::int`,
      ready: sql<number>`count(*) filter (where ${repairsTable.status} = 'ready')::int`,
      delivered: sql<number>`count(*) filter (where ${repairsTable.status} = 'delivered')::int`,
      cancelled: sql<number>`count(*) filter (where ${repairsTable.status} in ('cancelled','cannot_repair'))::int`,
      totalValue: sql<number>`coalesce(sum(
        case when ${repairsTable.status} in ('cancelled','cannot_repair') then 0
        else greatest(
          (${repairsTable.repairCharge} + ${repairsTable.partsCharge} + ${repairsTable.serviceCharge} + ${repairsTable.otherCharge} - ${repairsTable.discount})
          * (1 + ${repairsTable.taxPercent} / 100.0), 0)
        end), 0)::float`,
      paid: sql<number>`coalesce(sum(case when ${repairsTable.status} in ('cancelled','cannot_repair') then 0 else ${repairsTable.advance} end), 0)::float`,
    })
    .from(repairsTable)
    .where(and(eq(repairsTable.shopId, shopId), owned));

  const [as] = await db
    .select({
      afterSaleReturns: sql<number>`count(*)::int`,
    })
    .from(repairReturnsTable)
    .innerJoin(repairsTable, eq(repairReturnsTable.repairId, repairsTable.id))
    .where(and(eq(repairReturnsTable.shopId, shopId), owned));

  const [rf] = await db
    .select({
      refunded: sql<number>`count(*) filter (where ${refundsTable.status} in ('approved','paid'))::int`,
      refundedAmount: sql<number>`coalesce(sum(${refundsTable.amount}) filter (where ${refundsTable.status} in ('approved','paid')), 0)::float`,
    })
    .from(refundsTable)
    .innerJoin(repairsTable, eq(refundsTable.repairId, repairsTable.id))
    .where(and(eq(refundsTable.shopId, shopId), owned));

  const totalValue = Math.round((r?.totalValue ?? 0) * 100) / 100;
  const paid = Math.round((r?.paid ?? 0) * 100) / 100;
  return {
    totalRepairs: r?.totalRepairs ?? 0,
    received: r?.received ?? 0,
    repairing: r?.repairing ?? 0,
    ready: r?.ready ?? 0,
    delivered: r?.delivered ?? 0,
    cancelled: r?.cancelled ?? 0,
    afterSaleReturns: as?.afterSaleReturns ?? 0,
    refunded: rf?.refunded ?? 0,
    refundedAmount: rf?.refundedAmount ?? 0,
    totalRepairValue: totalValue,
    pendingAmount: Math.max(Math.round((totalValue - paid) * 100) / 100, 0),
  };
}

// ── Dealer portal: own profile + stats ─────────────────────────────────────
router.get(
  "/dealers/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    if (!isDealerPortalRole(me.role) || !me.dealerId || !me.shopId) {
      res.status(403).json({ message: "This endpoint is for dealer accounts only." });
      return;
    }
    const [dealer] = await db
      .select()
      .from(dealersTable)
      .where(and(eq(dealersTable.id, me.dealerId), eq(dealersTable.shopId, me.shopId)));
    if (!dealer) {
      res.status(404).json({ message: "Dealer profile not found" });
      return;
    }
    const [ownCustomerLinks, [shop]] = await Promise.all([
      db.select({ customerId: customerUsersTable.customerId })
        .from(customerUsersTable)
        .where(and(eq(customerUsersTable.userId, me.id), eq(customerUsersTable.shopId, me.shopId))),
      db.select({
        businessName: shopsTable.businessName,
        address: shopsTable.address,
        ownerName: usersTable.name,
        ownerMobile: usersTable.mobile,
      })
        .from(shopsTable)
        .innerJoin(usersTable, eq(usersTable.id, shopsTable.dealerId))
        .where(eq(shopsTable.id, me.shopId))
        .limit(1),
    ]);
    const stats = await dealerStats(me.shopId, dealer.id, ownCustomerLinks.map((link) => link.customerId));
    // From the portal login's side the repair shop is their supplier: the
    // shop that repairs the phones they send in. Only the owner's contact is
    // exposed — never staff details or shop settings.
    const supplier = shop
      ? {
          businessName: shop.businessName,
          address: shop.address ?? undefined,
          ownerName: shop.ownerName,
          ownerMobile: shop.ownerMobile,
        }
      : null;
    res.json({ dealer: dealerOut(dealer), stats, supplier });
  }),
);

// ── Supplier view: my repairs at other shops ────────────────────────────────
// A shop owner (or staff member) can also be a B2B dealer of ANOTHER shop:
// that shop files a `dealers` row carrying this person's mobile and books
// repairs against it. OTP proved control of `users.mobile` (a session cannot
// change it without a fresh OTP), so every ACTIVE dealer row in another shop
// whose mobile matches is this caller's own party record. This mirrors the
// single-shop dealer portal, but from inside a full business account, across
// every shop that lists this person. Read-only, portal projection only, and
// each supplier shop's own "portal_repairs" switch is honoured.

type SupplierLink = {
  dealer: DbDealer;
  supplier: { businessName: string; address: string | null; ownerName: string; ownerMobile: string };
};

// Same acceptance rules as normaliseIndianMobile, expressed in SQL over the
// stored (possibly unnormalised) dealer mobile.
function dealerMobileMatches(mobile: string): SQL {
  const compact = sql`regexp_replace(${dealersTable.mobile}, '[[:space:]().-]', '', 'g')`;
  return inArray(compact, [mobile, `0${mobile}`, `91${mobile}`, `+91${mobile}`]);
}

async function supplierLinksFor(me: DbUser, dealerId?: string): Promise<SupplierLink[]> {
  const mobile = me.mobile ? normaliseIndianMobile(me.mobile) : null;
  if (!mobile) return [];
  const conds: SQL[] = [eq(dealersTable.isActive, true), dealerMobileMatches(mobile)];
  // A shop listing its own owner's number as a dealer is not a supplier.
  if (me.shopId) conds.push(sql`${dealersTable.shopId} <> ${me.shopId}`);
  if (dealerId) conds.push(eq(dealersTable.id, dealerId));
  const rows = await db
    .select({
      dealer: dealersTable,
      businessName: shopsTable.businessName,
      address: shopsTable.address,
      ownerName: usersTable.name,
      ownerMobile: usersTable.mobile,
    })
    .from(dealersTable)
    .innerJoin(shopsTable, eq(shopsTable.id, dealersTable.shopId))
    .innerJoin(usersTable, eq(usersTable.id, shopsTable.dealerId))
    .where(and(...conds))
    .orderBy(desc(dealersTable.createdAt), asc(dealersTable.id));
  const links: SupplierLink[] = [];
  for (const row of rows) {
    // The supplier shop can switch its dealer portal off per role; that
    // switch governs this view too — same data, different door.
    const matrix = await getShopRoleFeatureMatrix(row.dealer.shopId);
    if (matrix.dealer_owner?.portal_repairs === false) continue;
    links.push({
      dealer: row.dealer,
      supplier: {
        businessName: row.businessName,
        address: row.address ?? null,
        ownerName: row.ownerName,
        ownerMobile: row.ownerMobile ?? "",
      },
    });
  }
  return links;
}

function supplierViewer(req: Request, res: Response): DbUser | null {
  const me = (req as AuthedRequest).user;
  // Portal and customer accounts have their own single-shop read paths.
  if (isDealerPortalRole(me.role) || me.role === "customer") {
    res.status(403).json({ message: "This view is for business accounts." });
    return null;
  }
  return me;
}

router.get(
  "/dealers/suppliers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = supplierViewer(req, res);
    if (!me) return;
    const links = await supplierLinksFor(me);
    const suppliers = [];
    for (const link of links) {
      const stats = await dealerStats(link.dealer.shopId, link.dealer.id);
      suppliers.push({
        dealerId: link.dealer.id,
        dealerCode: link.dealer.dealerCode,
        dealerName: link.dealer.name,
        shopId: link.dealer.shopId,
        supplier: {
          businessName: link.supplier.businessName,
          address: link.supplier.address ?? undefined,
          ownerName: link.supplier.ownerName,
          ownerMobile: link.supplier.ownerMobile,
        },
        stats,
      });
    }
    res.json({ suppliers });
  }),
);

router.get(
  "/dealers/suppliers/:dealerId/repairs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = supplierViewer(req, res);
    if (!me) return;
    const dealerId = req.params.dealerId as string;
    const [link] = await supplierLinksFor(me, dealerId);
    if (!link) {
      // Not this caller's party (or inactive / switched off): indistinguishable
      // from a dealer that does not exist.
      res.status(404).json({ message: "Supplier not found" });
      return;
    }
    const conds: SQL[] = [
      eq(repairsTable.shopId, link.dealer.shopId),
      eq(repairsTable.dealerId, link.dealer.id),
    ];
    const status = str(req.query.status);
    if (status) {
      const wanted = status.split(",").map((v) => v.trim()).filter(Boolean);
      if (wanted.length === 1) conds.push(eq(repairsTable.status, wanted[0]));
      else if (wanted.length > 1) conds.push(inArray(repairsTable.status, wanted));
    }
    const q = str(req.query.q);
    if (q) {
      const like = `%${q}%`;
      conds.push(or(
        ilike(repairsTable.repairId, like),
        ilike(repairsTable.customerName, like),
        ilike(repairsTable.brand, like),
        ilike(repairsTable.model, like),
        ilike(repairsTable.problem, like),
      ) as SQL);
    }
    const pageRaw = Number(req.query.page);
    const limitRaw = Number(req.query.limit);
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.trunc(pageRaw) : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.trunc(limitRaw), 200) : 50;
    const where = and(...conds);
    const [[{ total }], rows] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(repairsTable).where(where),
      db.select().from(repairsTable).where(where)
        .orderBy(desc(repairsTable.createdAt), desc(repairsTable.id))
        .limit(limit).offset((page - 1) * limit),
    ]);
    res.json({ repairs: rows.map(portalRepairOut), total, page, limit });
  }),
);

// ── Detect dealer by mobile number (intake auto-detection) ──────────────────
// Any repair-receiving role (incl. technicians) may check whether an entered
// mobile belongs to an ACTIVE dealer. Only exact matches on the registered
// primary mobile count — normal customers must never be classified as dealers.
// NOTE: registered before /dealers/:id so "detect" isn't captured as an id.
router.get(
  "/dealers/detect",
  requireAuth,
  requireFeature("customers"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const query = parseQuery(DealersDetectQueryParams, req, res);
    if (!query) return;
    const mobile = str(query.mobile);
    if (!mobile || !/^\d{10}$/.test(mobile)) {
      res.json({ dealers: [] });
      return;
    }
    const rows = await db
      .select()
      .from(dealersTable)
      .where(and(
        eq(dealersTable.shopId, shopId),
        eq(dealersTable.mobile, mobile),
        eq(dealersTable.isActive, true),
      ))
      .orderBy(asc(dealersTable.createdAt));
    res.json({ dealers: rows.map(dealerOut) });
  }),
);

// ── List dealers (shop staff) with live counts ──────────────────────────────
router.get(
  "/dealers",
  requireAuth,
  requireFeature("customers"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    // All shop staff (including technicians) may browse the dealer directory
    // so they can link repairs to dealers.
    const conds: SQL[] = [eq(dealersTable.shopId, shopId)];
    const query = parseQuery(DealersListQueryParams, req, res);
    if (!query) return;
    const q = str(query.q);
    if (q) {
      const like = `%${q}%`;
      const orCond = or(
        ilike(dealersTable.name, like),
        ilike(dealersTable.dealerCode, like),
        ilike(dealersTable.shopName, like),
        ilike(dealersTable.mobile, like),
        ilike(dealersTable.location, like),
      );
      if (orCond) conds.push(orCond);
    }
    const rows = await db
      .select()
      .from(dealersTable)
      .where(and(...conds))
      .orderBy(asc(dealersTable.createdAt));

    // One grouped pass over repairs for the per-dealer counts.
    const counts = await db
      .select({
        dealerId: repairsTable.dealerId,
        totalRepairs: sql<number>`count(*)::int`,
        repairing: sql<number>`count(*) filter (where ${repairsTable.status} in ('diagnosing','waiting_parts','repairing','testing','customer_approval'))::int`,
        received: sql<number>`count(*) filter (where ${repairsTable.status} = 'received')::int`,
        ready: sql<number>`count(*) filter (where ${repairsTable.status} = 'ready')::int`,
        delivered: sql<number>`count(*) filter (where ${repairsTable.status} = 'delivered')::int`,
      })
      .from(repairsTable)
      .where(and(eq(repairsTable.shopId, shopId), sql`${repairsTable.dealerId} is not null`))
      .groupBy(repairsTable.dealerId);
    const byDealer = new Map(counts.map((c) => [c.dealerId, c]));

    res.json({
      dealers: rows.map((d) => {
        const c = byDealer.get(d.id);
        return {
          ...dealerOut(d),
          totalRepairs: c?.totalRepairs ?? 0,
          received: c?.received ?? 0,
          repairing: c?.repairing ?? 0,
          ready: c?.ready ?? 0,
          delivered: c?.delivered ?? 0,
        };
      }),
    });
  }),
);

// ── Admin overview: per-dealer table + overall stats ────────────────────────
router.get(
  "/dealers/overview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    if (!PRIVILEGED.includes(me.role)) {
      res.status(403).json({ message: "Dealer/Owner access required." });
      return;
    }
    const [overall] = await db
      .select({
        totalDealerRepairs: sql<number>`count(*)::int`,
        activeRepairs: sql<number>`count(*) filter (where ${repairsTable.status} in ('received','diagnosing','waiting_parts','repairing','testing','customer_approval'))::int`,
        completedRepairs: sql<number>`count(*) filter (where ${repairsTable.status} in ('ready','delivered'))::int`,
        deliveredRepairs: sql<number>`count(*) filter (where ${repairsTable.status} = 'delivered')::int`,
        totalRevenue: sql<number>`coalesce(sum(case when ${repairsTable.status} in ('cancelled','cannot_repair') then 0 else ${repairsTable.advance} end), 0)::float`,
        totalValue: sql<number>`coalesce(sum(
          case when ${repairsTable.status} in ('cancelled','cannot_repair') then 0
          else greatest(
            (${repairsTable.repairCharge} + ${repairsTable.partsCharge} + ${repairsTable.serviceCharge} + ${repairsTable.otherCharge} - ${repairsTable.discount})
            * (1 + ${repairsTable.taxPercent} / 100.0), 0)
          end), 0)::float`,
      })
      .from(repairsTable)
      .where(and(eq(repairsTable.shopId, shopId), sql`${repairsTable.dealerId} is not null`));

    const [asRow] = await db
      .select({ afterSaleReturns: sql<number>`count(*)::int` })
      .from(repairReturnsTable)
      .innerJoin(repairsTable, eq(repairReturnsTable.repairId, repairsTable.id))
      .where(and(eq(repairReturnsTable.shopId, shopId), sql`${repairsTable.dealerId} is not null`));
    const [rfRow] = await db
      .select({
        refunds: sql<number>`count(*) filter (where ${refundsTable.status} in ('approved','paid'))::int`,
      })
      .from(refundsTable)
      .innerJoin(repairsTable, eq(refundsTable.repairId, repairsTable.id))
      .where(and(eq(refundsTable.shopId, shopId), sql`${repairsTable.dealerId} is not null`));

    const totalValue = Math.round((overall?.totalValue ?? 0) * 100) / 100;
    const revenue = Math.round((overall?.totalRevenue ?? 0) * 100) / 100;

    res.json({
      stats: {
        totalDealerRepairs: overall?.totalDealerRepairs ?? 0,
        activeRepairs: overall?.activeRepairs ?? 0,
        completedRepairs: overall?.completedRepairs ?? 0,
        deliveredRepairs: overall?.deliveredRepairs ?? 0,
        afterSaleReturns: asRow?.afterSaleReturns ?? 0,
        refunds: rfRow?.refunds ?? 0,
        totalRepairRevenue: revenue,
        pendingPayments: Math.max(Math.round((totalValue - revenue) * 100) / 100, 0),
      },
    });
  }),
);

// ── Dealer profile + full stats ──────────────────────────────────────────────
router.get(
  "/dealers/:id",
  requireAuth,
  requireFeature("customers"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    // All shop staff (including technicians) may view dealer profiles.
    const [dealer] = await db
      .select()
      .from(dealersTable)
      .where(and(eq(dealersTable.id, String(req.params.id ?? "")), eq(dealersTable.shopId, shopId)));
    if (!dealer) {
      res.status(404).json({ message: "Dealer not found" });
      return;
    }
    const stats = await dealerStats(shopId, dealer.id);
    res.json({ dealer: dealerOut(dealer), stats });
  }),
);

// ── Create dealer ───────────────────────────────────────────────────────────
router.post(
  "/dealers",
  requireAuth,
  requireFeature("customers"),
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    // All shop staff (including technicians) may add dealers to the directory.
    const b = parseBody(DealersCreateBody, req, res);
    if (!b) return;
    const name = str(b.name);
    const mobile = str(b.mobile);
    if (!name || !mobile) {
      res.status(400).json({ message: "Dealer name and mobile are required" });
      return;
    }
    if (!/^\d{10}$/.test(mobile)) {
      res.status(400).json({ message: "Mobile must be a 10-digit number" });
      return;
    }
    // Duplicate protection: same mobile = same dealer within a shop.
    const [existing] = await db
      .select()
      .from(dealersTable)
      .where(and(eq(dealersTable.shopId, shopId), eq(dealersTable.mobile, mobile)));
    if (existing) {
      res.status(409).json({
        message: `Dealer with this mobile already exists (${existing.dealerCode} — ${existing.name})`,
        code: "DEALER_EXISTS",
        dealer: dealerOut(existing),
      });
      return;
    }
    // Sequential per-shop code; retry on the rare concurrent-create clash.
    for (let attempt = 0; attempt < 3; attempt++) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(dealersTable)
        .where(eq(dealersTable.shopId, shopId));
      const dealerCode = `DLR-${String(count + 1 + attempt).padStart(3, "0")}`;
      try {
        const [created] = await db.transaction(async (tx) => {
          await lockNormalizedMobiles(tx, mobile);
          // Re-check after acquiring the identity lock: two writers that both
          // passed the optimistic preflight must not create an ambiguous OTP
          // identity.
          const [lockedExisting] = await tx.select().from(dealersTable)
            .where(and(eq(dealersTable.shopId, shopId), eq(dealersTable.mobile, mobile)))
            .limit(1);
          if (lockedExisting) {
            const error = new Error("DEALER_EXISTS_LOCKED") as Error & { dealer?: DbDealer };
            error.dealer = lockedExisting;
            throw error;
          }
          return tx.insert(dealersTable).values({
            shopId,
            dealerCode,
            name,
            shopName: str(b.shopName),
            mobile,
            location: str(b.location),
            createdById: me.id,
            createdByName: me.name,
          }).returning();
        });
        res.json({ dealer: dealerOut(created) });
        return;
      } catch (err) {
        if (err instanceof Error && err.message === "DEALER_EXISTS_LOCKED") {
          const existing = (err as Error & { dealer?: DbDealer }).dealer!;
          res.status(409).json({
            message: `Dealer with this mobile already exists (${existing.dealerCode} — ${existing.name})`,
            code: "DEALER_EXISTS",
            dealer: dealerOut(existing),
          });
          return;
        }
        if ((err as { code?: string })?.code === "23505" && attempt < 2) continue;
        throw err;
      }
    }
  }),
);

// ── Update dealer (privileged only) ─────────────────────────────────────────
router.patch(
  "/dealers/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const me = (req as AuthedRequest).user;
    if (!PRIVILEGED.includes(me.role)) {
      res.status(403).json({ message: "Dealer/Owner access required." });
      return;
    }
    const b = parseBody(DealersUpdateBody, req, res);
    if (!b) return;
    const patch: Partial<typeof dealersTable.$inferInsert> = {};
    if (b.name !== undefined) {
      const name = str(b.name);
      if (!name) {
        res.status(400).json({ message: "Dealer name cannot be empty" });
        return;
      }
      patch.name = name;
    }
    if (b.mobile !== undefined) {
      const mobile = str(b.mobile);
      if (!mobile || !/^\d{10}$/.test(mobile)) {
        res.status(400).json({ message: "Mobile must be a 10-digit number" });
        return;
      }
      patch.mobile = mobile;
    }
    if (b.shopName !== undefined) patch.shopName = str(b.shopName);
    if (b.location !== undefined) patch.location = str(b.location);
    if (b.isActive !== undefined) patch.isActive = b.isActive === true;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ message: "Nothing to update" });
      return;
    }
    const dealerId = String(req.params.id ?? "");
    const [updated] = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ mobile: dealersTable.mobile }).from(dealersTable)
        .where(and(eq(dealersTable.id, dealerId), eq(dealersTable.shopId, shopId))).for("update");
      if (!existing) return [];
      await lockNormalizedMobiles(tx, existing.mobile, patch.mobile);
      return tx.update(dealersTable).set(patch)
        .where(and(eq(dealersTable.id, dealerId), eq(dealersTable.shopId, shopId))).returning();
    });
    if (!updated) {
      res.status(404).json({ message: "Dealer not found" });
      return;
    }
    // Keep the denormalized snapshot on repairs in sync with the new name.
    if (patch.name) {
      await db
        .update(repairsTable)
        .set({ dealerName: updated.name })
        .where(and(eq(repairsTable.shopId, shopId), eq(repairsTable.dealerId, updated.id)));
    }
    res.json({ dealer: dealerOut(updated) });
  }),
);

export default router;
