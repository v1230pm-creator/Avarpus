import type { Repair, Customer, InventoryItem, Purchase, FinanceEntry } from '@/types';
import { formatCurrency, formatDate, ROLE_LABELS, REPAIR_STATUS_LABELS } from '@/utils/helpers';

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: string;
  isActive: boolean;
  designation?: string;
}

export interface ReportData {
  repairs: Repair[];
  customers: Customer[];
  inventory: InventoryItem[];
  purchases: Purchase[];
  finance: FinanceEntry[];
  staff: StaffMember[];
  refunds?: any[];
  stockMovements?: any[];
  shopName?: string;
}

interface ReportTable {
  title: string;
  /** Summary lines shown above the table. */
  summary: string[];
  headers: string[];
  rows: string[][];
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const statusLabel = (s: string) => REPAIR_STATUS_LABELS[s] ?? s;

function repairReport(d: ReportData): ReportTable {
  const active = d.repairs.filter((r) => !['delivered', 'cancelled'].includes(r.status));
  const billed = d.repairs.reduce((s, r) => s + (r.repairCharge ?? 0) + (r.partsCharge ?? 0), 0);
  return {
    title: 'Repair Report',
    summary: [
      `Total repairs: ${d.repairs.length}`,
      `Active: ${active.length}`,
      `Total billed: ${formatCurrency(billed)}`,
    ],
    headers: ['ID', 'Customer', 'Device', 'Problem', 'Status', 'Technician', 'Charges', 'Received'],
    rows: d.repairs.map((r) => [
      r.repairId,
      r.customerName,
      `${r.brand} ${r.model}`.trim(),
      r.problem,
      statusLabel(r.status),
      r.technicianName ?? '—',
      formatCurrency((r.repairCharge ?? 0) + (r.partsCharge ?? 0)),
      r.receiveDate ? formatDate(r.receiveDate) : '—',
    ]),
  };
}

function customerReport(d: ReportData): ReportTable {
  const withDues = d.customers.filter((c) => c.dueAmount > 0);
  const totalDue = withDues.reduce((s, c) => s + c.dueAmount, 0);
  return {
    title: 'Customer Report',
    summary: [
      `Total customers: ${d.customers.length}`,
      `With dues: ${withDues.length}`,
      `Total dues: ${formatCurrency(totalDue)}`,
    ],
    headers: ['Name', 'Mobile', 'Email', 'Repairs', 'Due Amount'],
    rows: d.customers.map((c) => [
      c.name,
      c.mobile,
      c.email ?? '—',
      String(c.totalRepairs ?? 0),
      formatCurrency(c.dueAmount ?? 0),
    ]),
  };
}

function inventoryReport(d: ReportData): ReportTable {
  const low = d.inventory.filter((i) => i.quantity <= i.minStock);
  const stockValue = d.inventory.reduce((s, i) => s + i.quantity * (i.purchasePrice ?? 0), 0);
  return {
    title: 'Inventory Report',
    summary: [
      `Items: ${d.inventory.length}`,
      `Low stock: ${low.length}`,
      `Stock value (purchase): ${formatCurrency(stockValue)}`,
    ],
    headers: ['Item', 'Category', 'Brand', 'Qty', 'Min Stock', 'Purchase ₹', 'Selling ₹', 'Supplier'],
    rows: d.inventory.map((i) => [
      i.name,
      i.category ?? '—',
      i.brand ?? '—',
      i.quantity <= i.minStock ? `${i.quantity} (LOW)` : String(i.quantity),
      String(i.minStock),
      formatCurrency(i.purchasePrice ?? 0),
      formatCurrency(i.sellingPrice ?? 0),
      i.supplier ?? '—',
    ]),
  };
}

function purchaseReport(d: ReportData): ReportTable {
  const unpaid = d.purchases.filter((p) => p.paymentStatus === 'unpaid');
  const total = d.purchases.reduce((s, p) => s + (p.total ?? 0), 0);
  return {
    title: 'Purchase Report',
    summary: [
      `Purchases: ${d.purchases.length}`,
      `Unpaid: ${unpaid.length}`,
      `Total value: ${formatCurrency(total)}`,
    ],
    headers: ['Invoice', 'Supplier', 'Item', 'Qty', 'Total', 'Payment', 'Date'],
    rows: d.purchases.map((p) => [
      p.invoiceNo ?? '—',
      p.supplier,
      p.itemName,
      String(p.quantity),
      formatCurrency(p.total ?? 0),
      p.paymentStatus,
      p.date ? formatDate(p.date) : '—',
    ]),
  };
}

function financeReport(d: ReportData): ReportTable {
  const income = d.finance.filter((f) => f.type === 'income').reduce((s, f) => s + f.amount, 0);
  const expense = d.finance.filter((f) => f.type === 'expense').reduce((s, f) => s + f.amount, 0);
  return {
    title: 'Finance Report',
    summary: [
      `Entries: ${d.finance.length}`,
      `Income: ${formatCurrency(income)}`,
      `Expense: ${formatCurrency(expense)}`,
      `Profit / Loss: ${formatCurrency(income - expense)}`,
    ],
    headers: ['Type', 'Category', 'Description', 'Amount', 'Method', 'Date'],
    rows: d.finance.map((f) => [
      f.type === 'income' ? 'Income' : 'Expense',
      f.category ?? '—',
      f.description ?? '—',
      formatCurrency(f.amount),
      f.paymentMethod ?? '—',
      f.date ? formatDate(f.date) : '—',
    ]),
  };
}

function staffReport(d: ReportData): ReportTable {
  const active = d.staff.filter((s) => s.isActive);
  return {
    title: 'Staff Report',
    summary: [
      `Total staff: ${d.staff.length}`,
      `Active: ${active.length}`,
      `Pending approval: ${d.staff.length - active.length}`,
    ],
    headers: ['Name', 'Role', 'Email', 'Mobile', 'Status'],
    rows: d.staff.map((s) => [
      s.name,
      ROLE_LABELS[s.role] ?? s.role,
      s.email,
      s.mobile ?? '—',
      s.isActive ? 'Active' : 'Pending',
    ]),
  };
}

function technicianReport(d: ReportData): ReportTable {
  const byTech = new Map<string, { name: string; total: number; completed: number; active: number }>();
  for (const r of d.repairs) {
    if (!r.technicianId && !r.technicianName) continue;
    const key = r.technicianId ?? r.technicianName!;
    const entry = byTech.get(key) ?? { name: r.technicianName ?? 'Unknown', total: 0, completed: 0, active: 0 };
    entry.total += 1;
    if (r.status === 'delivered') entry.completed += 1;
    else if (r.status !== 'cancelled') entry.active += 1;
    byTech.set(key, entry);
  }
  const techs = [...byTech.values()].sort((a, b) => b.total - a.total);
  return {
    title: 'Technician Report',
    summary: [
      `Technicians with assigned jobs: ${techs.length}`,
      `Assigned repairs: ${techs.reduce((s, t) => s + t.total, 0)}`,
    ],
    headers: ['Technician', 'Total Jobs', 'Completed', 'Active'],
    rows: techs.map((t) => [t.name, String(t.total), String(t.completed), String(t.active)]),
  };
}

function warrantyReport(d: ReportData): ReportTable {
  const today = new Date().toISOString().split('T')[0];
  const withWarranty = d.repairs.filter((r) => (r.warrantyDays ?? 0) > 0 || r.warrantyExpiry);
  const inWarranty = withWarranty.filter((r) => r.warrantyExpiry && r.warrantyExpiry >= today);
  return {
    title: 'Warranty Report',
    summary: [
      `Repairs with warranty: ${withWarranty.length}`,
      `Currently in warranty: ${inWarranty.length}`,
    ],
    headers: ['Repair ID', 'Customer', 'Device', 'Warranty (days)', 'Expires', 'Status'],
    rows: withWarranty.map((r) => [
      r.repairId,
      r.customerName,
      `${r.brand} ${r.model}`.trim(),
      String(r.warrantyDays ?? '—'),
      r.warrantyExpiry ? formatDate(r.warrantyExpiry) : '—',
      r.warrantyExpiry ? (r.warrantyExpiry >= today ? 'In warranty' : 'Expired') : '—',
    ]),
  };
}


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
  const partsMap = new Map<string, number>();
  
  if (d.stockMovements) {
    d.stockMovements.forEach((m) => {
      // Look for negative quantity change indicating consumption
      if (m.quantityChange < 0 && m.itemName) {
        const qty = Math.abs(m.quantityChange);
        partsMap.set(m.itemName, (partsMap.get(m.itemName) || 0) + qty);
      }
    });
  }
  
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

const BUILDERS: Record<string, (d: ReportData) => ReportTable> = {
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
};

export interface BuiltReport {
  title: string;
  html: string;
  rowCount: number;
}

/** Build a printable HTML report for the given report type, or null for unknown types. */
export function buildReportHtml(reportId: string, data: ReportData): BuiltReport | null {
  const builder = BUILDERS[reportId];
  if (!builder) return null;
  const t = builder(data);
  const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  const body =
    t.rows.length === 0
      ? `<p class="empty">No data available for this report yet.</p>`
      : `<table>
          <thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${t.rows
            .map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody>
        </table>`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(t.title)}</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #0F172A; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .meta { color: #64748B; font-size: 12px; margin-bottom: 14px; }
  .summary { background: #F1F5F9; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; }
  .summary div { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; background: #0284C7; color: #fff; padding: 6px 8px; }
  td { padding: 5px 8px; border-bottom: 1px solid #E2E8F0; }
  tr:nth-child(even) td { background: #F8FAFC; }
  .empty { color: #64748B; font-size: 14px; }
</style>
</head>
<body>
  <h1>${esc(t.title)}</h1>
   <div class="meta">${esc(data.shopName ?? 'Avarpus')} · Generated ${esc(generatedAt)}</div>
  <div class="summary">${t.summary.map((s) => `<div>${esc(s)}</div>`).join('')}</div>
  ${body}
</body>
</html>`;

  return { title: t.title, html, rowCount: t.rows.length };
}
