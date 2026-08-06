import { User, Repair, Customer, InventoryItem, Purchase, FinanceEntry } from '@/types';
import { storage, KEYS } from '@/utils/storage';

const now = new Date();
const today = now.toISOString().split('T')[0];
const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString().split('T')[0];
const threeDaysAgo = new Date(now.getTime() - 3 * 86400000).toISOString().split('T')[0];
const nextWeek = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

export const SEED_USERS: User[] = [
  {
    id: 'u1',
    name: 'Super Admin',
    email: 'superadmin@vmc.com',
    mobile: '9999999999',
    role: 'super_admin',
    isActive: true,
    joinDate: '2024-01-01',
    designation: 'Super Administrator',
    password: 'Admin@123',
  },
  {
    id: 'u2',
    name: 'Rajesh Kumar',
    email: 'dealer@vmc.com',
    mobile: '9876543210',
    role: 'dealer',
    isActive: true,
    joinDate: '2024-01-15',
    designation: 'Owner / Dealer',
    password: 'Dealer@123',
  },
  {
    id: 'u3',
    name: 'Priya Sharma',
    email: 'reception@vmc.com',
    mobile: '9876543211',
    role: 'reception',
    isActive: true,
    joinDate: '2024-02-01',
    designation: 'Reception Staff',
    password: 'Staff@123',
  },
  {
    id: 'u4',
    name: 'Arjun Singh',
    email: 'tech@vmc.com',
    mobile: '9876543212',
    role: 'technician',
    isActive: true,
    joinDate: '2024-02-10',
    designation: 'Senior Technician',
    password: 'Tech@123',
  },
  {
    id: 'u5',
    name: 'Meena Patel',
    email: 'store@vmc.com',
    mobile: '9876543213',
    role: 'store_manager',
    isActive: true,
    joinDate: '2024-03-01',
    designation: 'Store Manager',
    password: 'Store@123',
  },
  {
    id: 'u6',
    name: 'Suresh Joshi',
    email: 'accounts@vmc.com',
    mobile: '9876543214',
    role: 'accountant',
    isActive: true,
    joinDate: '2024-03-15',
    designation: 'Accountant',
    password: 'Accts@123',
  },
];

export const SEED_CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'Amit Verma', mobile: '9811111111', email: 'amit@gmail.com', address: '12 MG Road, Delhi', dueAmount: 500, totalRepairs: 3, createdAt: threeDaysAgo },
  { id: 'c2', name: 'Sunita Rao', mobile: '9822222222', email: 'sunita@gmail.com', address: '45 Nehru Nagar, Mumbai', dueAmount: 0, totalRepairs: 1, createdAt: twoDaysAgo },
  { id: 'c3', name: 'Vikram Gupta', mobile: '9833333333', address: '78 Civil Lines, Jaipur', dueAmount: 1200, totalRepairs: 2, createdAt: twoDaysAgo },
  { id: 'c4', name: 'Kavitha Nair', mobile: '9844444444', email: 'kavitha@gmail.com', address: '22 Gandhi Street, Chennai', dueAmount: 0, totalRepairs: 1, createdAt: yesterday },
  { id: 'c5', name: 'Rohit Mishra', mobile: '9855555555', address: '56 Station Road, Patna', dueAmount: 800, totalRepairs: 4, createdAt: yesterday },
  { id: 'c6', name: 'Deepa Sinha', mobile: '9866666666', email: 'deepa@gmail.com', address: '33 Ring Road, Bhopal', dueAmount: 0, totalRepairs: 2, createdAt: today },
];

export const SEED_REPAIRS: Repair[] = [
  {
    id: 'r1', repairId: 'VMC-001', customerId: 'c1', customerName: 'Amit Verma', mobile: '9811111111',
    deviceType: 'Smartphone', brand: 'Samsung', model: 'Galaxy S23', imei: '352456789012345',
    problem: 'Screen cracked, touch not working', technicianId: 'u4', technicianName: 'Arjun Singh',
    status: 'repairing', priority: 'high', repairCharge: 3500, partsCharge: 1800, advance: 2000,
    receiveDate: threeDaysAgo, expectedDate: today, notes: 'Original screen ordered',
    createdAt: threeDaysAgo,
  },
  {
    id: 'r2', repairId: 'VMC-002', customerId: 'c2', customerName: 'Sunita Rao', mobile: '9822222222',
    deviceType: 'Smartphone', brand: 'iPhone', model: 'iPhone 14', imei: '355123456789012',
    problem: 'Battery draining fast, charging issue', technicianId: 'u4', technicianName: 'Arjun Singh',
    status: 'ready', priority: 'normal', repairCharge: 2200, partsCharge: 800, advance: 1500,
    receiveDate: twoDaysAgo, expectedDate: today, deliveryDate: undefined,
    notes: 'Battery replaced, charging port cleaned', createdAt: twoDaysAgo,
  },
  {
    id: 'r3', repairId: 'VMC-003', customerId: 'c3', customerName: 'Vikram Gupta', mobile: '9833333333',
    deviceType: 'Tablet', brand: 'iPad', model: 'iPad Air 5th Gen', imei: '',
    problem: 'Camera not working, back glass broken',
    status: 'diagnosing', priority: 'normal', repairCharge: 0, partsCharge: 0, advance: 500,
    receiveDate: yesterday, expectedDate: nextWeek,
    createdAt: yesterday,
  },
  {
    id: 'r4', repairId: 'VMC-004', customerId: 'c4', customerName: 'Kavitha Nair', mobile: '9844444444',
    deviceType: 'Smartphone', brand: 'OnePlus', model: '11 Pro', imei: '358765432109876',
    problem: 'Phone fell in water, not turning on', technicianId: 'u4', technicianName: 'Arjun Singh',
    status: 'waiting_parts', priority: 'urgent', repairCharge: 4500, partsCharge: 2200, advance: 3000,
    receiveDate: yesterday, expectedDate: nextWeek,
    notes: 'Motherboard needs replacement, ordered', createdAt: yesterday,
  },
  {
    id: 'r5', repairId: 'VMC-005', customerId: 'c5', customerName: 'Rohit Mishra', mobile: '9855555555',
    deviceType: 'Smartphone', brand: 'Xiaomi', model: 'Redmi Note 12', imei: '356234567890123',
    problem: 'Speaker not working, SIM not detected',
    status: 'received', priority: 'low', repairCharge: 0, partsCharge: 0, advance: 0,
    receiveDate: today, expectedDate: nextWeek,
    createdAt: today,
  },
  {
    id: 'r6', repairId: 'VMC-006', customerId: 'c6', customerName: 'Deepa Sinha', mobile: '9866666666',
    deviceType: 'Laptop', brand: 'Dell', model: 'Inspiron 15', imei: '',
    problem: 'Keyboard keys not working, trackpad issue', technicianId: 'u4', technicianName: 'Arjun Singh',
    status: 'testing', priority: 'normal', repairCharge: 2800, partsCharge: 600, advance: 1500,
    receiveDate: twoDaysAgo, expectedDate: today,
    notes: 'Keyboard replaced, testing in progress', createdAt: twoDaysAgo,
  },
  {
    id: 'r7', repairId: 'VMC-007', customerId: 'c1', customerName: 'Amit Verma', mobile: '9811111111',
    deviceType: 'Smartphone', brand: 'Vivo', model: 'V27 Pro', imei: '354321098765432',
    problem: 'Back camera blurry, front camera not working', technicianId: 'u4', technicianName: 'Arjun Singh',
    status: 'delivered', priority: 'normal', repairCharge: 3200, partsCharge: 1400, advance: 3200,
    receiveDate: threeDaysAgo, expectedDate: yesterday, deliveryDate: yesterday,
    notes: 'Both cameras replaced, delivered', createdAt: threeDaysAgo,
  },
  {
    id: 'r8', repairId: 'VMC-008', customerId: 'c5', customerName: 'Rohit Mishra', mobile: '9855555555',
    deviceType: 'Smartphone', brand: 'Realme', model: 'GT 5', imei: '357890123456789',
    problem: 'Screen flickering, display issue',
    status: 'cancelled', priority: 'low', repairCharge: 0, partsCharge: 0, advance: 0,
    receiveDate: threeDaysAgo, expectedDate: yesterday,
    notes: 'Customer cancelled, parts not available locally', createdAt: threeDaysAgo,
  },
];

export const SEED_INVENTORY: InventoryItem[] = [
  { id: 'i1', name: 'iPhone 14 Screen (OLED)', category: 'spare_part', brand: 'Apple', quantity: 3, minStock: 5, purchasePrice: 4500, sellingPrice: 6000, supplier: 'TechParts India', createdAt: threeDaysAgo },
  { id: 'i2', name: 'Samsung S23 Battery', category: 'spare_part', brand: 'Samsung', quantity: 8, minStock: 5, purchasePrice: 800, sellingPrice: 1200, supplier: 'Mobile Spares Hub', createdAt: twoDaysAgo },
  { id: 'i3', name: 'USB-C Charging Cable 1m', category: 'accessory', brand: 'Anker', quantity: 25, minStock: 10, purchasePrice: 150, sellingPrice: 299, supplier: 'GadgetWala', createdAt: twoDaysAgo },
  { id: 'i4', name: 'Tempered Glass (Universal 6.5")', category: 'accessory', brand: 'Generic', quantity: 2, minStock: 10, purchasePrice: 40, sellingPrice: 99, supplier: 'Local Supplier', createdAt: yesterday },
  { id: 'i5', name: 'Redmi Note 12 Back Panel', category: 'spare_part', brand: 'Xiaomi', quantity: 4, minStock: 3, purchasePrice: 350, sellingPrice: 599, supplier: 'Mobile Spares Hub', createdAt: yesterday },
  { id: 'i6', name: 'OnePlus 11 Pro Screen', category: 'spare_part', brand: 'OnePlus', quantity: 1, minStock: 2, purchasePrice: 5500, sellingPrice: 7500, supplier: 'TechParts India', createdAt: today },
  { id: 'i7', name: 'Lightning Cable 2m', category: 'accessory', brand: 'Belkin', quantity: 15, minStock: 10, purchasePrice: 250, sellingPrice: 499, supplier: 'GadgetWala', createdAt: today },
  { id: 'i8', name: 'Wireless Charger 15W', category: 'product', brand: 'boAt', quantity: 6, minStock: 5, purchasePrice: 600, sellingPrice: 999, supplier: 'Accessories Direct', createdAt: today },
  { id: 'i9', name: 'Dell Laptop Keyboard', category: 'spare_part', brand: 'Dell', quantity: 2, minStock: 2, purchasePrice: 1200, sellingPrice: 1800, supplier: 'Laptop Parts Store', createdAt: twoDaysAgo },
  { id: 'i10', name: 'Phone Back Cover (Assorted)', category: 'accessory', brand: 'Generic', quantity: 0, minStock: 20, purchasePrice: 60, sellingPrice: 149, supplier: 'Local Supplier', createdAt: yesterday },
];

export const SEED_PURCHASES: Purchase[] = [
  { id: 'p1', purchaseId: 'PUR-001', invoiceNo: 'INV-TPI-2024-001', supplier: 'TechParts India', supplierMobile: '9900001111', itemName: 'iPhone 14 Screen (OLED) x5', quantity: 5, purchasePrice: 4500, total: 22500, paymentStatus: 'paid', paymentMethod: 'Bank Transfer', date: threeDaysAgo, createdAt: threeDaysAgo },
  { id: 'p2', purchaseId: 'PUR-002', invoiceNo: 'INV-MSH-2024-045', supplier: 'Mobile Spares Hub', supplierMobile: '9900002222', itemName: 'Samsung S23 Battery x10', quantity: 10, purchasePrice: 800, total: 8000, paymentStatus: 'paid', paymentMethod: 'UPI', date: twoDaysAgo, createdAt: twoDaysAgo },
  { id: 'p3', purchaseId: 'PUR-003', invoiceNo: 'INV-GW-2024-112', supplier: 'GadgetWala', supplierMobile: '9900003333', itemName: 'Cables & Accessories Assorted', quantity: 50, purchasePrice: 200, total: 10000, paymentStatus: 'partial', paymentMethod: 'Cash', date: yesterday, createdAt: yesterday },
  { id: 'p4', purchaseId: 'PUR-004', invoiceNo: 'INV-LPS-2024-008', supplier: 'Laptop Parts Store', supplierMobile: '9900004444', itemName: 'Dell Laptop Keyboard x2', quantity: 2, purchasePrice: 1200, total: 2400, paymentStatus: 'unpaid', paymentMethod: 'Credit', date: today, createdAt: today },
];

export const SEED_FINANCE: FinanceEntry[] = [
  { id: 'f1', type: 'income', category: 'Repair Service', amount: 3500, description: 'Repair VMC-001 advance payment', paymentMethod: 'Cash', date: threeDaysAgo, createdAt: threeDaysAgo },
  { id: 'f2', type: 'expense', category: 'Inventory Purchase', amount: 22500, description: 'iPhone screens from TechParts India', paymentMethod: 'Bank Transfer', date: threeDaysAgo, createdAt: threeDaysAgo },
  { id: 'f3', type: 'income', category: 'Repair Service', amount: 1500, description: 'Repair VMC-002 advance payment', paymentMethod: 'UPI', date: twoDaysAgo, createdAt: twoDaysAgo },
  { id: 'f4', type: 'expense', category: 'Inventory Purchase', amount: 8000, description: 'Samsung batteries from Mobile Spares Hub', paymentMethod: 'UPI', date: twoDaysAgo, createdAt: twoDaysAgo },
  { id: 'f5', type: 'income', category: 'Repair Service', amount: 3200, description: 'Repair VMC-007 full payment on delivery', paymentMethod: 'Cash', date: yesterday, createdAt: yesterday },
  { id: 'f6', type: 'expense', category: 'Utilities', amount: 2500, description: 'Electricity bill monthly', paymentMethod: 'Bank Transfer', date: yesterday, createdAt: yesterday },
  { id: 'f7', type: 'income', category: 'Product Sale', amount: 999, description: 'Sold wireless charger to walk-in customer', paymentMethod: 'UPI', date: today, createdAt: today },
  { id: 'f8', type: 'expense', category: 'Miscellaneous', amount: 500, description: 'Office supplies', paymentMethod: 'Cash', date: today, createdAt: today },
];

export async function seedIfNeeded(): Promise<void> {
  const seeded = await storage.get<boolean>(KEYS.SEEDED);
  if (seeded) return;
  await Promise.all([
    storage.set(KEYS.USERS, SEED_USERS),
    storage.set(KEYS.CUSTOMERS, SEED_CUSTOMERS),
    storage.set(KEYS.REPAIRS, SEED_REPAIRS),
    storage.set(KEYS.INVENTORY, SEED_INVENTORY),
    storage.set(KEYS.PURCHASES, SEED_PURCHASES),
    storage.set(KEYS.FINANCE, SEED_FINANCE),
    storage.set(KEYS.SETTINGS, {
      companyName: 'VMC Electronic',
      shopAddress: '123 Electronics Market, Main Road, City - 400001',
      phone: '9876543210',
      email: 'info@vmcelectronic.com',
      gstNumber: '27AABCU9603R1ZX',
      invoicePrefix: 'VMC-INV',
      repairPrefix: 'VMC',
      currency: 'INR',
      currencySymbol: '₹',
      language: 'English',
      theme: 'dark',
    }),
    storage.set(KEYS.SEEDED, true),
  ]);
}
