import re

with open('artifacts/mobile/utils/reportHtml.ts', 'r') as f:
    content = f.read()

# Update ReportData interface
target_interface = """export interface ReportData {
  repairs: Repair[];
  customers: Customer[];
  inventory: InventoryItem[];
  purchases: Purchase[];
  finance: FinanceEntry[];
  staff: StaffMember[];
  shopName?: string;
}"""
new_interface = """export interface ReportData {
  repairs: Repair[];
  customers: Customer[];
  inventory: InventoryItem[];
  purchases: Purchase[];
  finance: FinanceEntry[];
  staff: StaffMember[];
  refunds?: any[];
  shopName?: string;
}"""
content = content.replace(target_interface, new_interface)

# Add the new generators before BUILDERS
new_generators = """
function pendingPaymentsReport(d: ReportData): ReportTable {
  const pending = d.repairs.filter((r) => r.status !== 'cancelled' && ((r.repairCharge ?? 0) + (r.partsCharge ?? 0) - (r.advance ?? 0) - (r.paidAmount ?? 0)) > 0);
  const totalDue = pending.reduce((sum, r) => sum + ((r.repairCharge ?? 0) + (r.partsCharge ?? 0) - (r.advance ?? 0) - (r.paidAmount ?? 0)), 0);
  
  return {
    title: 'Pending Payments Report',
    summary: [
      `Total Pending Tickets: ${pending.length}`,
      `Total Balance Due: ${formatCurrency(totalDue)}`
    ],
    headers: ['Ticket', 'Customer', 'Total', 'Paid', 'Balance Due'],
    rows: pending.map((r) => {
      const total = (r.repairCharge ?? 0) + (r.partsCharge ?? 0);
      const paid = (r.advance ?? 0) + (r.paidAmount ?? 0);
      const balance = total - paid;
      return [
        r.repairId,
        r.customerName,
        formatCurrency(total),
        formatCurrency(paid),
        formatCurrency(balance)
      ];
    })
  };
}

function refundsReport(d: ReportData): ReportTable {
  const refunds = d.refunds || [];
  const total = refunds.reduce((sum, r) => sum + (r.amount || 0), 0);
  
  return {
    title: 'Refunds Report',
    summary: [
      `Total Refunds: ${refunds.length}`,
      `Total Amount Refunded: ${formatCurrency(total)}`
    ],
    headers: ['Repair Ticket', 'Customer', 'Date', 'Method', 'Amount'],
    rows: refunds.map((r) => [
      r.repairTicket || '—',
      r.customerName || '—',
      r.createdAt ? formatDate(r.createdAt) : '—',
      r.method || '—',
      formatCurrency(r.amount || 0)
    ])
  };
}

function partsConsumptionReport(d: ReportData): ReportTable {
  // Aggregate parts from repairs data
  const partsMap = new Map<string, number>();
  d.repairs.forEach((r) => {
    if (r.parts && Array.isArray(r.parts)) {
      r.parts.forEach((p: any) => {
        if (p.name) {
          const qty = parseInt(p.quantity) || 1;
          partsMap.set(p.name, (partsMap.get(p.name) || 0) + qty);
        }
      });
    }
  });
  
  const sortedParts = Array.from(partsMap.entries()).sort((a, b) => b[1] - a[1]);
  const totalParts = sortedParts.reduce((sum, [_, qty]) => sum + qty, 0);
  
  return {
    title: 'Parts Consumption Report',
    summary: [
      `Unique Parts Used: ${sortedParts.length}`,
      `Total Units Consumed: ${totalParts}`
    ],
    headers: ['Part Name', 'Quantity Used'],
    rows: sortedParts.map(([name, qty]) => [
      name,
      String(qty)
    ])
  };
}
"""

content = content.replace("const BUILDERS: Record<string, (d: ReportData) => ReportTable> = {", new_generators + "\nconst BUILDERS: Record<string, (d: ReportData) => ReportTable> = {")

content = content.replace(
"""const BUILDERS: Record<string, (d: ReportData) => ReportTable> = {
  repair: repairReport,
  customer: customerReport,
  inventory: inventoryReport,
  purchase: purchaseReport,
  finance: financeReport,
  staff: staffReport,
  technician: technicianReport,
  warranty: warrantyReport,
};""",
"""const BUILDERS: Record<string, (d: ReportData) => ReportTable> = {
  repair: repairReport,
  customer: customerReport,
  inventory: inventoryReport,
  purchase: purchaseReport,
  finance: financeReport,
  staff: staffReport,
  technician: technicianReport,
  warranty: warrantyReport,
  pending: pendingPaymentsReport,
  refunds: refundsReport,
  parts: partsConsumptionReport,
};"""
)

with open('artifacts/mobile/utils/reportHtml.ts', 'w') as f:
    f.write(content)
