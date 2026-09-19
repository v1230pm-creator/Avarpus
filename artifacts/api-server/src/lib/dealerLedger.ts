import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import {
  db,
  refundsTable,
  repairEventsTable,
  repairPaymentsTable,
  repairsTable,
  shopsTable,
  usersTable,
} from "@workspace/db";
import { computeTotals } from "./repairProjection";

// ── Dealer-to-dealer ledger ─────────────────────────────────────────────────
// A dealer-to-dealer transaction IS the receiving shop's ordinary repair row
// (tagged with sourceDealerShopId). Both shops read the SAME row, the SAME
// append-only repair_payments rows and the SAME refunds rows, so the two
// sides can never disagree: every number here is derived on read, nothing is
// stored per side.
//
// Direction is always expressed from the caller's point of view:
//   receivable — the caller's shop repaired the device; the other shop owes.
//   payable    — the caller's shop sent the device; the caller owes.
//
// Bill posting policy: a repair bill enters the ledger once the repairing
// shop marks the job ready or delivered (the amount is final and the device is
// awaiting return). Payments always post the moment they are recorded, voids
// stay visible as zero-value audit entries, paid refunds post as a reversal.

type RepairRow = typeof repairsTable.$inferSelect;
type PaymentRow = typeof repairPaymentsTable.$inferSelect;
type RefundRow = typeof refundsTable.$inferSelect;

export type LedgerDirection = "receivable" | "payable";
export type LedgerEntryKind = "bill" | "payment" | "void" | "refund";

// Human direction of one entry, from the caller's side. Never colour-only.
export type LedgerEntryDirection =
  | "you_owe"
  | "they_owe_you"
  | "you_paid"
  | "you_received"
  | "refund_to_you"
  | "refund_by_you"
  | "voided";

export const BILL_POSTING_STATUSES = new Set(["ready", "delivered"]);

export function transactionCodeOf(r: Pick<RepairRow, "repairId">): string {
  return `DT-${r.repairId}`;
}

export function billPosted(r: Pick<RepairRow, "status">): boolean {
  return BILL_POSTING_STATUSES.has(r.status);
}

export interface LedgerParty {
  shopId: string;
  businessName: string;
  ownerUserId: string;
  ownerName: string;
  ownerMobile: string;
  direction: LedgerDirection;
  // Transaction-based role of the OTHER shop, from the caller's side.
  role: "supplier" | "customer";
  billed: number;
  paid: number;
  refunded: number;
  balance: number;
  repairCount: number;
  openRepairCount: number;
  lastActivityAt: string;
}

export interface LedgerEntry {
  id: string;
  kind: LedgerEntryKind;
  direction: LedgerEntryDirection;
  repairId: string;
  transactionCode: string;
  ticket: string;
  device: string;
  amount: number;
  method?: string;
  referenceNo?: string;
  note?: string;
  actorName?: string;
  voidedAt?: string;
  voidReason?: string;
  at: string;
  runningBalance: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function billPostedAt(r: RepairRow): Date {
  if (r.readyAt) return r.readyAt;
  if (r.repairCompletedAt) return r.repairCompletedAt;
  if (r.deliveryDate) return new Date(`${r.deliveryDate}T00:00:00Z`);
  return r.createdAt;
}

function deviceLabel(r: RepairRow): string {
  return `${r.brand} ${r.model}`.trim();
}

// All dealer-to-dealer repair rows the caller's shop is a party to, in both
// directions, in one query.
async function loadPartyRepairs(shopId: string): Promise<RepairRow[]> {
  return db
    .select()
    .from(repairsTable)
    .where(
      or(
        and(eq(repairsTable.shopId, shopId), isNotNull(repairsTable.sourceDealerShopId)),
        eq(repairsTable.sourceDealerShopId, shopId),
      ),
    );
}

async function loadMoney(repairIds: string[]): Promise<{ payments: PaymentRow[]; refunds: RefundRow[] }> {
  if (repairIds.length === 0) return { payments: [], refunds: [] };
  const [payments, refunds] = await Promise.all([
    db.select().from(repairPaymentsTable).where(inArray(repairPaymentsTable.repairId, repairIds)),
    db
      .select()
      .from(refundsTable)
      .where(and(inArray(refundsTable.repairId, repairIds), eq(refundsTable.status, "paid"))),
  ]);
  return { payments, refunds };
}

async function loadShopIdentities(shopIds: string[]) {
  const out = new Map<string, { businessName: string; ownerUserId: string; ownerName: string; ownerMobile: string }>();
  if (shopIds.length === 0) return out;
  const rows = await db
    .select({
      shopId: shopsTable.id,
      businessName: shopsTable.businessName,
      ownerUserId: usersTable.id,
      ownerName: usersTable.name,
      ownerMobile: usersTable.mobile,
    })
    .from(shopsTable)
    .innerJoin(usersTable, eq(usersTable.id, shopsTable.dealerId))
    .where(inArray(shopsTable.id, shopIds));
  for (const r of rows) {
    out.set(r.shopId, {
      businessName: r.businessName,
      ownerUserId: r.ownerUserId,
      ownerName: r.ownerName,
      ownerMobile: r.ownerMobile,
    });
  }
  return out;
}

function directionOf(shopId: string, r: RepairRow): LedgerDirection {
  return r.shopId === shopId ? "receivable" : "payable";
}

function counterpartShopIdOf(shopId: string, r: RepairRow): string {
  return r.shopId === shopId ? (r.sourceDealerShopId as string) : r.shopId;
}

// Money facts for one repair from the shared rows. Identical on both sides
// by construction — there is exactly one set of rows to read.
export function repairMoney(r: RepairRow, payments: PaymentRow[], refunds: RefundRow[]) {
  const billed = billPosted(r) ? computeTotals(r).totalAmount : 0;
  const paid = round2(
    payments.filter((p) => !p.voidedAt).reduce((s, p) => s + p.amount, 0),
  );
  const refunded = round2(refunds.reduce((s, x) => s + x.amount, 0));
  const balance = round2(billed - paid + refunded);
  return { billed, paid, refunded, balance };
}

// Unposted (pre-ready) live bill total, so the UI can show "estimate so far"
// without it entering the balance.
export function repairLiveTotal(r: RepairRow): number {
  return computeTotals(r).totalAmount;
}

export async function dealerLedgerParties(shopId: string): Promise<{
  parties: LedgerParty[];
  totals: { receivable: number; payable: number };
}> {
  const repairs = await loadPartyRepairs(shopId);
  const { payments, refunds } = await loadMoney(repairs.map((r) => r.id));
  const paymentsByRepair = groupBy(payments, (p) => p.repairId);
  const refundsByRepair = groupBy(refunds, (x) => x.repairId);
  const identities = await loadShopIdentities(
    Array.from(new Set(repairs.map((r) => counterpartShopIdOf(shopId, r)))),
  );

  const buckets = new Map<string, LedgerParty>();
  for (const r of repairs) {
    const direction = directionOf(shopId, r);
    const otherShopId = counterpartShopIdOf(shopId, r);
    const identity = identities.get(otherShopId);
    if (!identity) continue; // counterpart shop no longer resolvable
    const key = `${otherShopId}:${direction}`;
    let party = buckets.get(key);
    if (!party) {
      party = {
        shopId: otherShopId,
        businessName: identity.businessName,
        ownerUserId: identity.ownerUserId,
        ownerName: identity.ownerName,
        ownerMobile: identity.ownerMobile,
        direction,
        role: direction === "payable" ? "supplier" : "customer",
        billed: 0,
        paid: 0,
        refunded: 0,
        balance: 0,
        repairCount: 0,
        openRepairCount: 0,
        lastActivityAt: r.createdAt.toISOString(),
      };
      buckets.set(key, party);
    }
    const money = repairMoney(r, paymentsByRepair.get(r.id) ?? [], refundsByRepair.get(r.id) ?? []);
    party.billed = round2(party.billed + money.billed);
    party.paid = round2(party.paid + money.paid);
    party.refunded = round2(party.refunded + money.refunded);
    party.balance = round2(party.balance + money.balance);
    party.repairCount += 1;
    if (r.status !== "delivered" && r.status !== "cancelled") party.openRepairCount += 1;
    const latest = latestActivity(r, paymentsByRepair.get(r.id) ?? [], refundsByRepair.get(r.id) ?? []);
    if (latest > new Date(party.lastActivityAt)) party.lastActivityAt = latest.toISOString();
  }

  const parties = Array.from(buckets.values()).sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
  const totals = parties.reduce(
    (acc, p) => {
      if (p.direction === "receivable") acc.receivable = round2(acc.receivable + Math.max(p.balance, 0));
      else acc.payable = round2(acc.payable + Math.max(p.balance, 0));
      return acc;
    },
    { receivable: 0, payable: 0 },
  );
  return { parties, totals };
}

function latestActivity(r: RepairRow, payments: PaymentRow[], refunds: RefundRow[]): Date {
  let latest = r.updatedAt ?? r.createdAt;
  for (const p of payments) {
    if (p.createdAt > latest) latest = p.createdAt;
    if (p.voidedAt && p.voidedAt > latest) latest = p.voidedAt;
  }
  for (const x of refunds) {
    const at = x.paidAt ?? x.createdAt;
    if (at > latest) latest = at;
  }
  return latest;
}

// Full ledger between the caller's shop and ONE other shop in ONE direction.
// The two directions between the same pair are independent ledgers — a shop
// that is a supplier in one relationship and a customer in the other must
// never have those balances netted against each other.
export async function dealerLedgerEntries(
  shopId: string,
  otherShopId: string,
  direction: LedgerDirection,
): Promise<{
  party: LedgerParty;
  entries: LedgerEntry[];
  totals: { billed: number; paid: number; refunded: number; balance: number };
} | null> {
  const repairs = await db
    .select()
    .from(repairsTable)
    .where(
      direction === "receivable"
        ? and(eq(repairsTable.shopId, shopId), eq(repairsTable.sourceDealerShopId, otherShopId))
        : and(eq(repairsTable.shopId, otherShopId), eq(repairsTable.sourceDealerShopId, shopId)),
    );
  // A ledger exists only between shops linked by at least one real
  // transaction in this direction. Resolving the other shop's owner identity
  // before that check would let any shop look up any other shop's contact.
  if (repairs.length === 0) return null;
  const identity = (await loadShopIdentities([otherShopId])).get(otherShopId);
  if (!identity) return null;
  const { payments, refunds } = await loadMoney(repairs.map((r) => r.id));
  const repairById = new Map(repairs.map((r) => [r.id, r]));

  type Raw = Omit<LedgerEntry, "runningBalance"> & { delta: number; sortAt: number };
  const raw: Raw[] = [];
  const base = (r: RepairRow) => ({
    repairId: r.id,
    transactionCode: transactionCodeOf(r),
    ticket: r.repairId,
    device: deviceLabel(r),
  });
  for (const r of repairs) {
    if (!billPosted(r)) continue;
    const total = computeTotals(r).totalAmount;
    const at = billPostedAt(r);
    raw.push({
      id: `bill:${r.id}`,
      kind: "bill",
      direction: direction === "payable" ? "you_owe" : "they_owe_you",
      ...base(r),
      amount: total,
      note: r.workPerformed ?? undefined,
      actorName: r.updatedByName ?? r.createdByName ?? undefined,
      at: at.toISOString(),
      delta: total,
      sortAt: at.getTime(),
    });
  }
  for (const p of payments) {
    const r = repairById.get(p.repairId);
    if (!r) continue;
    const live = !p.voidedAt;
    raw.push({
      id: `payment:${p.id}`,
      kind: live ? "payment" : "void",
      direction: !live ? "voided" : direction === "payable" ? "you_paid" : "you_received",
      ...base(r),
      amount: p.amount,
      method: p.method,
      referenceNo: p.referenceNo ?? undefined,
      note: p.note ?? undefined,
      actorName: p.receivedByName ?? undefined,
      voidedAt: p.voidedAt ? p.voidedAt.toISOString() : undefined,
      voidReason: p.voidReason ?? undefined,
      at: p.createdAt.toISOString(),
      delta: live ? -p.amount : 0,
      sortAt: p.createdAt.getTime(),
    });
  }
  for (const x of refunds) {
    const r = repairById.get(x.repairId);
    if (!r) continue;
    const at = x.paidAt ?? x.createdAt;
    raw.push({
      id: `refund:${x.id}`,
      kind: "refund",
      direction: direction === "payable" ? "refund_to_you" : "refund_by_you",
      ...base(r),
      amount: x.amount,
      method: x.method,
      referenceNo: x.referenceNo ?? undefined,
      note: x.reason,
      actorName: x.paidByName ?? x.approvedByName ?? undefined,
      at: at.toISOString(),
      delta: x.amount,
      sortAt: at.getTime(),
    });
  }
  raw.sort((a, b) => a.sortAt - b.sortAt || a.id.localeCompare(b.id));
  let running = 0;
  const entries: LedgerEntry[] = raw.map((e) => {
    running = round2(running + e.delta);
    const { delta: _d, sortAt: _s, ...rest } = e;
    return { ...rest, runningBalance: running };
  });

  const paymentsByRepair = groupBy(payments, (p) => p.repairId);
  const refundsByRepair = groupBy(refunds, (x) => x.repairId);
  const totals = repairs.reduce(
    (acc, r) => {
      const m = repairMoney(r, paymentsByRepair.get(r.id) ?? [], refundsByRepair.get(r.id) ?? []);
      acc.billed = round2(acc.billed + m.billed);
      acc.paid = round2(acc.paid + m.paid);
      acc.refunded = round2(acc.refunded + m.refunded);
      acc.balance = round2(acc.balance + m.balance);
      return acc;
    },
    { billed: 0, paid: 0, refunded: 0, balance: 0 },
  );
  const party: LedgerParty = {
    shopId: otherShopId,
    ...identity,
    direction,
    role: direction === "payable" ? "supplier" : "customer",
    ...totals,
    repairCount: repairs.length,
    openRepairCount: repairs.filter((r) => r.status !== "delivered" && r.status !== "cancelled").length,
    lastActivityAt: (entries.at(-1)?.at) ?? (repairs.at(0)?.createdAt.toISOString() ?? new Date(0).toISOString()),
  };
  return { party, entries, totals };
}

// Timeline events safe to show to BOTH parties. Internal notes, costs, staff
// assignment and photo bookkeeping stay on the repairing shop's own screen.
const SHARED_EVENT_ACTIONS = new Set([
  "created",
  "status_changed",
  "delivered",
  "payment_recorded",
  "payment_voided",
  "testing_confirmed",
  "ready_notified",
  "estimate_approval_requested",
  "estimate_approved",
  "estimate_rejected",
  "delivery_otp_verified",
  "dealer_received",
]);

export async function sharedTimeline(r: RepairRow) {
  const rows = await db
    .select()
    .from(repairEventsTable)
    .where(eq(repairEventsTable.repairId, r.id))
    .orderBy(repairEventsTable.createdAt);
  const events = rows
    .filter((e) => SHARED_EVENT_ACTIONS.has(e.action))
    .map((e) => ({
      id: e.id,
      repairId: e.repairId,
      action: e.action,
      details: (e.details as Record<string, unknown> | null) ?? undefined,
      userName: e.userName,
      userRole: e.userRole,
      createdAt: e.createdAt.toISOString(),
    }));
  // Synthetic milestones that live on the repair row rather than in events.
  events.unshift({
    id: `sent:${r.id}`,
    repairId: r.id,
    action: "dealer_sent",
    details: undefined,
    userName: r.createdByName ?? r.sourceDealerBusinessName ?? "",
    userRole: "dealer",
    createdAt: r.createdAt.toISOString(),
  });
  // Older rows were accepted before the acceptance event existed — derive
  // the milestone from the timestamp so the timeline stays complete.
  if (r.sourceDealerReceivedAt && !events.some((e) => e.action === "dealer_received")) {
    events.push({
      id: `received:${r.id}`,
      repairId: r.id,
      action: "dealer_received",
      details: undefined,
      userName: r.receivedByName ?? "",
      userRole: "dealer",
      createdAt: r.sourceDealerReceivedAt.toISOString(),
    });
  }
  events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return events;
}

export async function repairMoneyRows(repairId: string) {
  const { payments, refunds } = await loadMoney([repairId]);
  return {
    payments: payments.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    refunds: refunds.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  };
}

export async function allRefundsForRepair(repairId: string): Promise<RefundRow[]> {
  return db.select().from(refundsTable).where(eq(refundsTable.repairId, repairId));
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}
