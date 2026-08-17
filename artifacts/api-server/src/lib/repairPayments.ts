import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  repairsTable,
  repairPaymentsTable,
  financeEntriesTable,
} from "@workspace/db";

// The ONE place that writes money to a repair. `repairs.advance` is a cached
// mirror of SUM(repair_payments.amount) and must never be set by any other
// code path — every advance/partial/final payment flows through here so the
// ledger, the cache and the finance books stay in lock-step inside a single
// transaction.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const PAYMENT_KINDS = ["advance", "partial", "final", "due"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export interface RecordPaymentInput {
  shopId: string;
  repairId: string;
  customerId: string | null;
  amount: number;
  method: string;
  kind: PaymentKind;
  note?: string | null;
  referenceNo?: string | null;
  receivedById?: string | null;
  receivedByName?: string | null;
  // Date to book the finance entry under (YYYY-MM-DD). Defaults to today; the
  // backdated-entry approval flow passes the approved (old) date here.
  financeDate?: string;
  isSample?: boolean;
}

const todayStr = () => new Date().toISOString().split("T")[0];

/**
 * Insert a payment row, recompute the cached advance from the ledger, and book
 * the matching finance income — all inside the caller's transaction. Returns
 * the inserted payment row. The caller is responsible for locking the repair
 * (`.for("update")`) and for any overpayment validation it needs.
 */
export async function recordPayment(
  tx: Tx,
  input: RecordPaymentInput,
): Promise<typeof repairPaymentsTable.$inferSelect> {
  const {
    shopId,
    repairId,
    customerId,
    amount,
    method,
    kind,
    note = null,
    referenceNo = null,
    receivedById = null,
    receivedByName = null,
    financeDate,
    isSample = false,
  } = input;

  const [row] = await tx
    .insert(repairPaymentsTable)
    .values({
      shopId,
      repairId,
      customerId,
      amount,
      method,
      kind,
      note,
      referenceNo,
      receivedById,
      receivedByName,
      isSample,
    })
    .returning();

  await recomputeAdvance(tx, shopId, repairId);

  // Book the income in finance.
  await tx.insert(financeEntriesTable).values({
    shopId,
    type: "income",
    category: "Repair Payment",
    amount,
    description: note ? `Repair payment (${kind}): ${note}` : `Repair payment (${kind})`,
    paymentMethod: method,
    date: financeDate ?? todayStr(),
    isSample,
  });

  return row;
}

/**
 * Recompute the cached `repairs.advance` from the ledger, excluding voided
 * payments (never increment — always a full recompute).
 */
export async function recomputeAdvance(tx: Tx, shopId: string, repairId: string): Promise<number> {
  const [{ newTotal }] = await tx
    .select({ newTotal: sql<number>`coalesce(sum(${repairPaymentsTable.amount}), 0)::float` })
    .from(repairPaymentsTable)
    .where(
      and(
        eq(repairPaymentsTable.repairId, repairId),
        eq(repairPaymentsTable.shopId, shopId),
        isNull(repairPaymentsTable.voidedAt),
      ),
    );
  await tx
    .update(repairsTable)
    .set({ advance: newTotal })
    .where(and(eq(repairsTable.id, repairId), eq(repairsTable.shopId, shopId)));
  return newTotal;
}

export interface VoidPaymentInput {
  shopId: string;
  repairId: string;
  paymentId: string;
  reason: string;
  voidedById: string;
  voidedByName: string;
}

/**
 * Void (reverse) a payment: the row stays visible forever, is flagged with the
 * audit fields, drops out of every sum, and a matching finance expense entry
 * ("Payment Reversal") offsets the original income so the books balance.
 * Caller must have locked the repair. Returns the updated row, or a string
 * error code ("NOT_FOUND" | "ALREADY_VOIDED").
 */
export async function voidPayment(
  tx: Tx,
  input: VoidPaymentInput,
): Promise<typeof repairPaymentsTable.$inferSelect | "NOT_FOUND" | "ALREADY_VOIDED"> {
  const { shopId, repairId, paymentId, reason, voidedById, voidedByName } = input;
  const [existing] = await tx
    .select()
    .from(repairPaymentsTable)
    .where(
      and(
        eq(repairPaymentsTable.id, paymentId),
        eq(repairPaymentsTable.repairId, repairId),
        eq(repairPaymentsTable.shopId, shopId),
      ),
    )
    .for("update");
  if (!existing) return "NOT_FOUND";
  if (existing.voidedAt) return "ALREADY_VOIDED";

  const [row] = await tx
    .update(repairPaymentsTable)
    .set({ voidedAt: new Date(), voidedById, voidedByName, voidReason: reason })
    .where(eq(repairPaymentsTable.id, paymentId))
    .returning();

  await recomputeAdvance(tx, shopId, repairId);

  // Offset the original income — never delete financial records.
  await tx.insert(financeEntriesTable).values({
    shopId,
    type: "expense",
    category: "Payment Reversal",
    amount: existing.amount,
    description: `Voided ${existing.kind} payment of ₹${existing.amount} (${existing.method}) — ${reason}`,
    paymentMethod: existing.method,
    date: todayStr(),
    isSample: existing.isSample,
  });

  return row;
}
