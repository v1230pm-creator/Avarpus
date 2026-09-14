import type { repairsTable } from "@workspace/db";

type RepairRow = typeof repairsTable.$inferSelect;

// The subtotal + tax + total for a repair, derived from its charge fields.
// subtotal = repairCharge + partsCharge + serviceCharge + otherCharge − discount
// total    = subtotal + subtotal * taxPercent/100
export function computeTotals(r: {
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

// Derived payment status from the bill total and net paid amount (both in ₹).
// unpaid | partial | paid | overpaid; refund state is carried by the refunds
// rows themselves, not collapsed into this.
export function paymentStatusOf(totalAmount: number, paidAmount: number): string {
  const total = Math.round(totalAmount * 100);
  const paid = Math.round(paidAmount * 100);
  if (paid <= 0) return "unpaid";
  if (paid < total) return "partial";
  if (paid === total) return "paid";
  return "overpaid";
}

// Read-only projection of a repair for the party who sent the device in
// (dealer portal, linked customer, or a dealer viewing a supplier's shop).
// Deliberately omits staff, cost, internal-note and technician fields.
export function portalRepairOut(r: RepairRow) {
  const totals = computeTotals(r);
  return {
    id: r.id, repairId: r.repairId, status: r.status, priority: r.priority,
    customerName: r.customerName, dealerName: r.dealerName ?? undefined,
    deviceType: r.deviceType, brand: r.brand, model: r.model,
    problem: r.problem, diagnosis: r.diagnosis ?? undefined,
    workPerformed: r.workPerformed ?? undefined,
    receiveDate: r.receiveDate, expectedDate: r.expectedDate,
    deliveryDate: r.deliveryDate ?? undefined,
    repairCompletedAt: r.repairCompletedAt ? r.repairCompletedAt.toISOString() : undefined,
    warrantyDays: r.warrantyDays, warrantyExpiry: r.warrantyExpiry ?? undefined,
    repairCharge: r.repairCharge, partsCharge: r.partsCharge,
    serviceCharge: r.serviceCharge, otherCharge: r.otherCharge,
    discount: r.discount, taxPercent: r.taxPercent,
    totalAmount: totals.totalAmount, paidAmount: totals.paidAmount,
    balance: totals.balance,
    paymentStatus: paymentStatusOf(totals.totalAmount, totals.paidAmount),
  };
}
