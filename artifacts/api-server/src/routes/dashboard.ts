import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  repairsTable,
  customersTable,
  financeEntriesTable,
  refundsTable,
  approvalRequestsTable,
  repairReturnsTable,
  repairEventsTable,
  loginEventsTable,
  usersTable,
  type DbUser,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import type { Request, Response } from "express";

// Read-only dashboard: aggregate stats + a global activity feed. Every route
// requires an authenticated shop user and is filtered by that shopId. There
// are deliberately NO mutation endpoints here.

const router: IRouter = Router();

type AuthedRequest = Request & { user: DbUser };

function shopIdOr403(req: Request, res: Response): string | null {
  const me = (req as AuthedRequest).user;
  if (!me.shopId) {
    res.status(403).json({
      message: "Your account is not linked to a shop. Dashboard data is only available for shop accounts.",
    });
    return null;
  }
  return me.shopId;
}

// Roles allowed to see money figures. Mirrors the finance-visibility rule used
// elsewhere: dealer + super_admin own the shop, accountant handles books.
const FINANCE_ROLES = ["dealer", "super_admin", "accountant"];
function canSeeFinance(req: Request): boolean {
  return FINANCE_ROLES.includes((req as AuthedRequest).user.role);
}

// Roles allowed to view the cross-shop activity feed / audit log.
const ACTIVITY_ROLES = ["dealer", "super_admin"];

const todayStr = () => new Date().toISOString().split("T")[0];

// ── GET /dashboard/stats ─────────────────────────────────────────────────────
// Any authenticated shop user. Money figures are omitted for non-finance roles
// (canSeeFinance:false), so staff still get operational counts.
router.get(
  "/dashboard/stats",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const today = todayStr();
    const seeFinance = canSeeFinance(req);

    // Operational counts — computed in SQL, shop-scoped.
    const [ops] = await db
      .select({
        todayRepairs: sql<number>`count(*) filter (where (${repairsTable.createdAt} at time zone 'UTC')::date = ${today}::date)::int`,
        pendingRepairs: sql<number>`count(*) filter (where ${repairsTable.status} not in ('delivered','cancelled'))::int`,
        readyForPickup: sql<number>`count(*) filter (where ${repairsTable.status} = 'ready')::int`,
      })
      .from(repairsTable)
      .where(eq(repairsTable.shopId, shopId));

    const [{ totalCustomers }] = await db
      .select({ totalCustomers: sql<number>`count(*)::int` })
      .from(customersTable)
      .where(eq(customersTable.shopId, shopId));

    const [{ openApprovalRequests }] = await db
      .select({ openApprovalRequests: sql<number>`count(*)::int` })
      .from(approvalRequestsTable)
      .where(and(eq(approvalRequestsTable.shopId, shopId), eq(approvalRequestsTable.status, "pending")));

    const [{ openReturnCases }] = await db
      .select({ openReturnCases: sql<number>`count(*) filter (where ${repairReturnsTable.status} <> 'closed')::int` })
      .from(repairReturnsTable)
      .where(eq(repairReturnsTable.shopId, shopId));

    const stats: Record<string, unknown> = {
      todayRepairs: ops?.todayRepairs ?? 0,
      pendingRepairs: ops?.pendingRepairs ?? 0,
      readyForPickup: ops?.readyForPickup ?? 0,
      totalCustomers: totalCustomers ?? 0,
      openApprovalRequests: openApprovalRequests ?? 0,
      openReturnCases: openReturnCases ?? 0,
      canSeeFinance: seeFinance,
    };

    if (seeFinance) {
      // Today's income / expense from finance entries (date is a yyyy-mm-dd text col).
      // Today's sales split: repair collections vs everything else (product /
      // accessory sales etc.). Repair money flows through finance as category
      // 'Repair Payment' (income) with voids offset by 'Payment Reversal'
      // (expense), so repair sales = repair income − today's reversals.
      const [fin] = await db
        .select({
          todayIncome: sql<number>`coalesce(sum(${financeEntriesTable.amount}) filter (where ${financeEntriesTable.type} = 'income'), 0)::float`,
          todayExpense: sql<number>`coalesce(sum(${financeEntriesTable.amount}) filter (where ${financeEntriesTable.type} = 'expense'), 0)::float`,
          todayRepairIncomeRaw: sql<number>`coalesce(sum(${financeEntriesTable.amount}) filter (where ${financeEntriesTable.type} = 'income' and ${financeEntriesTable.category} = 'Repair Payment'), 0)::float`,
          todayReversals: sql<number>`coalesce(sum(${financeEntriesTable.amount}) filter (where ${financeEntriesTable.type} = 'expense' and ${financeEntriesTable.category} = 'Payment Reversal'), 0)::float`,
          todayProductIncome: sql<number>`coalesce(sum(${financeEntriesTable.amount}) filter (where ${financeEntriesTable.type} = 'income' and ${financeEntriesTable.category} <> 'Repair Payment'), 0)::float`,
        })
        .from(financeEntriesTable)
        .where(and(eq(financeEntriesTable.shopId, shopId), eq(financeEntriesTable.date, today)));

      // Outstanding customer dues, split by whether the phone already left the
      // shop: pendingPayments = due on DELIVERED repairs (customer took the
      // phone without paying in full); readyBalance = due on READY repairs
      // still waiting for pickup.
      const totalExpr = sql<number>`
        greatest(${repairsTable.repairCharge} + ${repairsTable.partsCharge} + ${repairsTable.serviceCharge}
          + ${repairsTable.otherCharge} - ${repairsTable.discount}, 0)
        * (1 + ${repairsTable.taxPercent} / 100.0)`;
      const dueExpr = sql<number>`greatest(${totalExpr} - ${repairsTable.advance}, 0)`;
      const [{ pendingPayments, readyBalance }] = await db
        .select({
          pendingPayments: sql<number>`coalesce(sum(${dueExpr}) filter (where ${repairsTable.status} = 'delivered'), 0)::float`,
          readyBalance: sql<number>`coalesce(sum(${dueExpr}) filter (where ${repairsTable.status} = 'ready'), 0)::float`,
        })
        .from(repairsTable)
        .where(eq(repairsTable.shopId, shopId));

      // Refunds paid out — total and today (by paid date).
      const [ref] = await db
        .select({
          refundsTotal: sql<number>`coalesce(sum(${refundsTable.amount}) filter (where ${refundsTable.status} = 'paid'), 0)::float`,
          refundsToday: sql<number>`coalesce(sum(${refundsTable.amount}) filter (where ${refundsTable.status} = 'paid' and (${refundsTable.paidAt} at time zone 'UTC')::date = ${today}::date), 0)::float`,
        })
        .from(refundsTable)
        .where(eq(refundsTable.shopId, shopId));

      stats.todayIncome = fin?.todayIncome ?? 0;
      stats.todayExpense = fin?.todayExpense ?? 0;
      // Signed net: voiding a previous day's payment today legitimately makes
      // today's repair sales negative — don't clamp, keep the books honest.
      stats.todayRepairIncome = (fin?.todayRepairIncomeRaw ?? 0) - (fin?.todayReversals ?? 0);
      stats.todayProductIncome = fin?.todayProductIncome ?? 0;
      stats.pendingPayments = pendingPayments ?? 0;
      stats.readyBalance = readyBalance ?? 0;
      stats.refundsTotal = ref?.refundsTotal ?? 0;
      stats.refundsToday = ref?.refundsToday ?? 0;
    }

    res.json({ stats });
  }),
);

// ── GET /dashboard/daily-repairs ─────────────────────────────────────────────
// Date-wise operational counts: phones received per day (receiveDate) vs
// phones repaired per day (repairCompletedAt — first transition to ready or
// delivered). Counts only, no money, so any authenticated shop user may view.
router.get(
  "/dashboard/daily-repairs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const rawDays = String(req.query.days ?? "30");
    const days = /^\d+$/.test(rawDays) ? Math.min(365, Math.max(1, Number.parseInt(rawDays, 10))) : 30;
    const toDate = todayStr();
    const fromDate = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // receiveDate is a yyyy-mm-dd (or ISO) text column — take the date part.
    const receivedRows = await db
      .select({
        date: sql<string>`left(${repairsTable.receiveDate}, 10)`,
        count: sql<number>`count(*)::int`,
      })
      .from(repairsTable)
      .where(and(
        eq(repairsTable.shopId, shopId),
        sql`left(${repairsTable.receiveDate}, 10) >= ${fromDate}`,
        sql`left(${repairsTable.receiveDate}, 10) <= ${toDate}`,
      ))
      .groupBy(sql`left(${repairsTable.receiveDate}, 10)`);

    const repairedRows = await db
      .select({
        date: sql<string>`((${repairsTable.repairCompletedAt} at time zone 'UTC')::date)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(repairsTable)
      .where(and(
        eq(repairsTable.shopId, shopId),
        sql`${repairsTable.repairCompletedAt} is not null`,
        sql`(${repairsTable.repairCompletedAt} at time zone 'UTC')::date >= ${fromDate}::date`,
        sql`(${repairsTable.repairCompletedAt} at time zone 'UTC')::date <= ${toDate}::date`,
      ))
      .groupBy(sql`(${repairsTable.repairCompletedAt} at time zone 'UTC')::date`);

    // Fill every date in the window (zero counts included) so the report is a
    // complete daily table, newest first.
    const byDate = new Map<string, { date: string; received: number; repaired: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      byDate.set(d, { date: d, received: 0, repaired: 0 });
    }
    for (const r of receivedRows) {
      const row = byDate.get(r.date);
      if (row) row.received = r.count;
    }
    for (const r of repairedRows) {
      const row = byDate.get(r.date);
      if (row) row.repaired = r.count;
    }
    const daysOut = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

    res.json({ days: daysOut });
  }),
);

// ── GET /activity ────────────────────────────────────────────────────────────
// Dealer / super_admin only. Merges the repair-events audit log with per-shop
// login events into a single paginated, filterable feed. Read-only.
router.get(
  "/activity",
  requireAuth,
  asyncHandler(async (req, res) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    if (!ACTIVITY_ROLES.includes((req as AuthedRequest).user.role)) {
      res.status(403).json({ message: "Only the dealer/owner can view the activity feed." });
      return;
    }

    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? "20"), 10) || 20));
    const offset = (page - 1) * limit;

    // Optional date range. dateFrom/dateTo are yyyy-mm-dd (inclusive).
    const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom.trim() ? req.query.dateFrom.trim() : null;
    const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo.trim() ? req.query.dateTo.trim() : null;
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`) : null;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : null;
    // type filter: 'repair' (repair events) | 'login' (login events).
    const typeFilter = typeof req.query.type === "string" && req.query.type.trim() ? req.query.type.trim() : null;
    const includeRepair = !typeFilter || typeFilter === "repair";
    const includeLogin = !typeFilter || typeFilter === "login";

    // A unified event shape produced from two sources.
    type Activity = {
      id: string;
      type: "repair" | "login";
      action: string;
      userId: string | null;
      userName: string;
      userRole: string;
      repairId: string | null;
      details: Record<string, unknown> | null;
      createdAt: string;
    };

    const items: Activity[] = [];

    // Fetch a page's worth from each source, then merge/sort/slice. We over-fetch
    // (offset + limit) from each so the merged window is correct.
    const take = offset + limit;

    if (includeRepair) {
      const conds: SQL[] = [eq(repairEventsTable.shopId, shopId)];
      if (fromTs) conds.push(gte(repairEventsTable.createdAt, fromTs));
      if (toTs) conds.push(lte(repairEventsTable.createdAt, toTs));
      const rows = await db
        .select({
          id: repairEventsTable.id,
          action: repairEventsTable.action,
          userId: repairEventsTable.userId,
          userName: repairEventsTable.userName,
          userRole: repairEventsTable.userRole,
          repairId: repairEventsTable.repairId,
          details: repairEventsTable.details,
          createdAt: repairEventsTable.createdAt,
        })
        .from(repairEventsTable)
        .where(and(...conds))
        .orderBy(desc(repairEventsTable.createdAt))
        .limit(take);
      for (const r of rows) {
        items.push({
          id: r.id,
          type: "repair",
          action: r.action,
          userId: r.userId ?? null,
          userName: r.userName,
          userRole: r.userRole,
          repairId: r.repairId,
          details: (r.details as Record<string, unknown> | null) ?? null,
          createdAt: r.createdAt.toISOString(),
        });
      }
    }

    if (includeLogin) {
      // login_events has no shopId — scope by joining users of this shop.
      const conds: SQL[] = [eq(usersTable.shopId, shopId)];
      if (fromTs) conds.push(gte(loginEventsTable.createdAt, fromTs));
      if (toTs) conds.push(lte(loginEventsTable.createdAt, toTs));
      const rows = await db
        .select({
          id: loginEventsTable.id,
          method: loginEventsTable.method,
          rememberMe: loginEventsTable.rememberMe,
          deviceInfo: loginEventsTable.deviceInfo,
          userId: loginEventsTable.userId,
          userName: usersTable.name,
          userRole: usersTable.role,
          createdAt: loginEventsTable.createdAt,
        })
        .from(loginEventsTable)
        .innerJoin(usersTable, eq(loginEventsTable.userId, usersTable.id))
        .where(and(...conds))
        .orderBy(desc(loginEventsTable.createdAt))
        .limit(take);
      for (const r of rows) {
        items.push({
          id: r.id,
          type: "login",
          action: "login",
          userId: r.userId,
          userName: r.userName,
          userRole: r.userRole,
          repairId: null,
          details: { method: r.method, rememberMe: r.rememberMe, deviceInfo: r.deviceInfo ?? null },
          createdAt: r.createdAt.toISOString(),
        });
      }
    }

    // Merge newest-first, then apply the requested page window.
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const pageItems = items.slice(offset, offset + limit);

    res.json({
      activity: pageItems,
      page,
      limit,
      hasMore: items.length > offset + limit,
    });
  }),
);

export default router;
