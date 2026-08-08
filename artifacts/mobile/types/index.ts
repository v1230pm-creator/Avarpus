export type UserRole =
  | 'super_admin'
  | 'dealer'
  | 'reception'
  | 'technician'
  | 'store_manager'
  | 'accountant';

export interface User {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: UserRole;
  isActive: boolean;
  joinDate: string;
  designation?: string;
  password?: string;
  businessName?: string;
  gstNumber?: string;
  shopAddress?: string;
  profilePhoto?: string;
  companyLogo?: string;
}

export type RepairStatus =
  | 'received'
  | 'diagnosing'
  | 'waiting_parts'
  | 'repairing'
  | 'testing'
  | 'customer_approval'
  | 'cannot_repair'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export type RepairPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Repair {
  id: string;
  repairId: string;
  customerId: string;
  customerName: string;
  mobile: string;
  alternateMobile?: string;
  deviceType: string;
  brand: string;
  model: string;
  imei?: string;
  imei2?: string;
  serialNumber?: string;
  color?: string;
  storage?: string;
  ram?: string;
  devicePassword?: string;
  simPresent?: boolean;
  memoryCardPresent?: boolean;
  accessories?: string;
  accessoriesList?: string[];
  physicalCondition?: Record<string, boolean>;
  deviceCondition?: string;
  problem: string;
  diagnosis?: string;
  workPerformed?: string;
  technicianId?: string;
  technicianName?: string;
  assignedById?: string;
  assignedByName?: string;
  assignedAt?: string;
  status: RepairStatus;
  priority: RepairPriority;
  repairCharge: number;
  partsCharge: number;
  serviceCharge?: number;
  otherCharge?: number;
  discount?: number;
  taxPercent?: number;
  advance: number;
  totalAmount?: number;
  paidAmount?: number;
  balance?: number;
  testingChecklist?: Record<string, boolean>;
  testingConfirmedById?: string;
  testingConfirmedByName?: string;
  testingConfirmedAt?: string;
  customerNotifiedAt?: string;
  readyAt?: string;
  receiveDate: string;
  expectedDate: string;
  deliveryDate?: string;
  repairStartedAt?: string;
  repairCompletedAt?: string;
  notes?: string;
  checklist?: Record<string, boolean>;
  warrantyDays?: number;
  warrantyExpiry?: string;
  receivingSignaturePath?: string;
  deliverySignaturePath?: string;
  receivedById?: string;
  receivedByName?: string;
  deliveredById?: string;
  deliveredByName?: string;
  paymentMethod?: string;
  otpVerified?: boolean;
  isSample?: boolean;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  address?: string;
  dueAmount: number;
  totalRepairs: number;
  isSample?: boolean;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: 'product' | 'accessory' | 'spare_part';
  brand: string;
  quantity: number;
  minStock: number;
  purchasePrice: number;
  sellingPrice: number;
  supplier?: string;
  canSeeCosts?: boolean;
  isSample?: boolean;
  createdAt: string;
}

export interface Purchase {
  id: string;
  purchaseId: string;
  invoiceNo: string;
  supplier: string;
  supplierMobile?: string;
  itemName: string;
  quantity: number;
  purchasePrice: number;
  total: number;
  paymentStatus: 'paid' | 'unpaid' | 'partial';
  paymentMethod: string;
  date: string;
  isSample?: boolean;
  createdAt: string;
}

export interface FinanceEntry {
  id: string;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  description: string;
  paymentMethod: string;
  date: string;
  isSample?: boolean;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  checkIn?: string;
  checkOut?: string;
  date: string;
  status: 'present' | 'absent' | 'late' | 'half_day';
}
