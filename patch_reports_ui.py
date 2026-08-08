with open('artifacts/mobile/app/(tabs)/more/reports.tsx', 'r') as f:
    content = f.read()

target = """const REPORT_TYPES: ReportType[] = [
  { id: 'repair', title: 'Repair Report', description: 'All repair jobs with status & billing', icon: 'tool', color: '#0284C7' },
  { id: 'customer', title: 'Customer Report', description: 'Customer list with dues & history', icon: 'users', color: '#7C3AED' },
  { id: 'inventory', title: 'Inventory Report', description: 'Stock levels, low stock alerts', icon: 'package', color: '#059669' },
  { id: 'purchase', title: 'Purchase Report', description: 'Purchase orders, supplier payments', icon: 'shopping-bag', color: '#D97706' },
  { id: 'finance', title: 'Finance Report', description: 'Income, expense, profit & loss', icon: 'bar-chart-2', color: '#DC2626' },
  { id: 'staff', title: 'Staff Report', description: 'Staff list, roles & status', icon: 'user-check', color: '#64748B' },
  { id: 'technician', title: 'Technician Report', description: 'Jobs completed per technician', icon: 'award', color: '#F59E0B' },
  { id: 'warranty', title: 'Warranty Report', description: 'Repair warranties & expiry', icon: 'shield', color: '#6366F1' },
];"""

new_content = """const REPORT_TYPES: ReportType[] = [
  { id: 'repair', title: 'Repair Report', description: 'All repair jobs with status & billing', icon: 'tool', color: '#0284C7' },
  { id: 'customer', title: 'Customer Report', description: 'Customer list with dues & history', icon: 'users', color: '#7C3AED' },
  { id: 'inventory', title: 'Inventory Report', description: 'Stock levels, low stock alerts', icon: 'package', color: '#059669' },
  { id: 'purchase', title: 'Purchase Report', description: 'Purchase orders, supplier payments', icon: 'shopping-bag', color: '#D97706' },
  { id: 'finance', title: 'Finance Report', description: 'Income, expense, profit & loss', icon: 'bar-chart-2', color: '#DC2626' },
  { id: 'staff', title: 'Staff Report', description: 'Staff list, roles & status', icon: 'user-check', color: '#64748B' },
  { id: 'technician', title: 'Technician Report', description: 'Jobs completed per technician', icon: 'award', color: '#F59E0B' },
  { id: 'warranty', title: 'Warranty Report', description: 'Repair warranties & expiry', icon: 'shield', color: '#6366F1' },
  { id: 'pending', title: 'Pending Payments', description: 'Repairs with outstanding balances', icon: 'credit-card', color: '#DC2626' },
  { id: 'refunds', title: 'Refunds', description: 'List of all processed refunds', icon: 'corner-up-left', color: '#9333EA' },
  { id: 'parts', title: 'Parts Consumption', description: 'Parts used across repairs', icon: 'settings', color: '#F97316' },
];"""

content = content.replace(target, new_content)

# We need to add useData and refunds fetch. Wait, where is `useData`?
with open('artifacts/mobile/app/(tabs)/more/reports.tsx', 'w') as f:
    f.write(content)
