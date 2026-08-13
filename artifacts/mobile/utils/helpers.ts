export const formatCurrency = (amount: number): string =>
  `₹${amount.toLocaleString('en-IN')}`;

export const formatDate = (dateStr: string): string => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const getGreeting = (): string => {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  if (h < 21) return 'Good Evening';
  return 'Good Night';
};

export const generateId = (): string =>
  Date.now().toString() + Math.random().toString(36).substring(2, 9);

export const generateRepairId = (count: number): string =>
  `VMC-${String(count + 1).padStart(3, '0')}`;

export const generatePurchaseId = (count: number): string =>
  `PUR-${String(count + 1).padStart(3, '0')}`;

export const getTodayStr = (): string =>
  new Date().toISOString().split('T')[0];

/** True when s is a real calendar date in YYYY-MM-DD form. */
export const isValidDateStr = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().split('T')[0] === s;
};

export const getNextWeekStr = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
};

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  dealer: 'Dealer / Owner',
  reception: 'Reception Staff',
  technician: 'Technician',
  store_manager: 'Store Manager',
  accountant: 'Accountant',
};

export const DEVICE_TYPES = ['Smartphone', 'Tablet', 'Laptop', 'Desktop', 'Smart Watch', 'Feature Phone', 'Other'];

export const BRANDS = ['Samsung', 'Apple / iPhone', 'OnePlus', 'Xiaomi / Redmi', 'Vivo', 'OPPO', 'Realme', 'Nokia', 'Dell', 'HP', 'Lenovo', 'Acer', 'Other'];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

// Statuses selectable in the Update Status picker. waiting_parts / testing /
// customer_approval were removed from manual selection per user request —
// they remain valid on the server (and in labels/badges) for legacy repairs
// and server-driven flows like customer approval requests.
export const REPAIR_STATUSES = ['received', 'diagnosing', 'repairing', 'cannot_repair', 'ready', 'delivered', 'cancelled'];
export const REPAIR_STATUS_LABELS: Record<string, string> = {
  received: 'Received', diagnosing: 'Diagnosing', waiting_parts: 'Waiting for Parts',
  repairing: 'In Repair', testing: 'Testing', ready: 'Repair Completed (Ready)',
  delivered: 'Delivered', cancelled: 'Cancelled',
  cannot_repair: 'Cannot Repair', customer_approval: 'Customer Approval Required'
};

export function getReturnStatusColor(status: string, colors: any) {
  if (['repaired', 'closed', 'refund_paid'].includes(status)) return colors.success;
  if (['returned', 'inspection'].includes(status)) return colors.info;
  if (['no_fault_found', 'cannot_repair', 'customer_declined', 'refund_approved'].includes(status)) return colors.destructive;
  return colors.warning;
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
