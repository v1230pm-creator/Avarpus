import { and, eq, sql } from "drizzle-orm";
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

export const PAYMENT_KINDS = ["advance", "partial", "final"] as const;
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

  // Recompute the cached advance sum from the ledger (never increment).
  const [{ newTotal }] = await tx
    .select({ newTotal: sql<number>`coalesce(sum(${repairPaymentsTable.amount}), 0)::float` })
    .from(repairPaymentsTable)
    .where(and(eq(repairPaymentsTable.repairId, repairId), eq(repairPaymentsTable.shopId, shopId)));
  await tx
    .update(repairsTable)
    .set({ advance: newTotal })
    .where(and(eq(repairsTable.id, repairId), eq(repairsTable.shopId, shopId)));

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
