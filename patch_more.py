import sys

with open('artifacts/mobile/app/(tabs)/more/index.tsx', 'r') as f:
    content = f.read()

target = """const MENU_ITEMS: MenuItem[] = [
  { id: 'finance', label: 'Finance', icon: 'bar-chart-2', route: '/(tabs)/more/finance', color: '#059669', description: 'Income, expense, cash book', roles: ['super_admin', 'dealer', 'accountant'] },
  { id: 'approvals', label: 'Approvals', icon: 'check-circle', route: '/(tabs)/more/approvals', color: '#E11D48', description: 'Backdated entry requests', roles: ['super_admin', 'dealer', 'accountant', 'store_manager', 'reception', 'technician'] },
  { id: 'staff', label: 'Staff', icon: 'users', route: '/(tabs)/more/staff', color: '#7C3AED', description: 'Manage staff and roles', roles: ['super_admin', 'dealer'] },
  { id: 'purchases', label: 'Purchases', icon: 'shopping-bag', route: '/(tabs)/more/purchases', color: '#0284C7', description: 'Purchase orders, suppliers', roles: ['super_admin', 'dealer', 'store_manager', 'accountant'] },
  { id: 'reports', label: 'Reports', icon: 'file-text', route: '/(tabs)/more/reports', color: '#D97706', description: 'Generate and export reports', roles: ['super_admin', 'dealer', 'accountant'] },
  { id: 'settings', label: 'Settings', icon: 'settings', route: '/(tabs)/more/settings', color: '#64748B', description: 'Company, app configuration', roles: ['super_admin', 'dealer'] },
];"""

new = """const MENU_ITEMS: MenuItem[] = [
  { id: 'activity', label: 'Activity Log', icon: 'activity', route: '/(tabs)/more/activity', color: '#10B981', description: 'View system events', roles: ['super_admin', 'dealer'] },
  { id: 'finance', label: 'Finance', icon: 'bar-chart-2', route: '/(tabs)/more/finance', color: '#059669', description: 'Income, expense, cash book', roles: ['super_admin', 'dealer', 'accountant'] },
  { id: 'approvals', label: 'Approvals', icon: 'check-circle', route: '/(tabs)/more/approvals', color: '#E11D48', description: 'Backdated entry requests', roles: ['super_admin', 'dealer', 'accountant', 'store_manager', 'reception', 'technician'] },
  { id: 'staff', label: 'Staff', icon: 'users', route: '/(tabs)/more/staff', color: '#7C3AED', description: 'Manage staff and roles', roles: ['super_admin', 'dealer'] },
  { id: 'purchases', label: 'Purchases', icon: 'shopping-bag', route: '/(tabs)/more/purchases', color: '#0284C7', description: 'Purchase orders, suppliers', roles: ['super_admin', 'dealer', 'store_manager', 'accountant'] },
  { id: 'reports', label: 'Reports', icon: 'file-text', route: '/(tabs)/more/reports', color: '#D97706', description: 'Generate and export reports', roles: ['super_admin', 'dealer', 'accountant'] },
  { id: 'settings', label: 'Settings', icon: 'settings', route: '/(tabs)/more/settings', color: '#64748B', description: 'Company, app configuration', roles: ['super_admin', 'dealer'] },
];"""

content = content.replace(target, new)
with open('artifacts/mobile/app/(tabs)/more/index.tsx', 'w') as f:
    f.write(content)
