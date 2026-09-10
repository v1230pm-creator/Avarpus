export type UserRole =
  | 'super_admin'
  | 'dealer'
  | 'reception'
  | 'technician'
  | 'store_manager'
  | 'accountant'
  | 'dealer_owner'
  | 'dealer_staff'
  | 'customer';

/** Dealer-portal login roles — external B2B dealer accounts (read-only). */
export const DEALER_PORTAL_ROLES: UserRole[] = ['dealer_owner', 'dealer_staff'];
export const isDealerPortalRole = (role?: string | null): boolean =>
  role === 'dealer_owner' || role === 'dealer_staff';

/** Customer self-service role. A shop-linked account may also view its own repairs. */
export const isCustomerRole = (role?: string | null): boolean => role === 'customer';

/** A customer portal is enabled only by the server-scoped shop link. */
export const isLinkedCustomerPortalUser = (user?: Pick<User, 'role' | 'shopId'> | null): boolean =>
  isCustomerRole(user?.role) && !!user?.shopId;

export interface User {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: UserRole;
  shopId?: string | null;
  isActive: boolean;
  joinDate: string;
  designation?: string;
  businessName?: string;
  gstNumber?: string;
  shopAddress?: string;
  profilePhoto?: string;
  profileAbout?: string;
  profileUsername?: string;
  profileLinks?: string[];
  companyLogo?: string;
  needsDisplayName: boolean;
  /** For dealer-portal accounts: the dealer (B2B party) this login belongs to. */
  dealerId?: string;
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
  // Legacy repairs may not have a persisted customer link until the repair
  // customer-link migration has matched them safely.
  customerId?: string;
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
  /** B2B dealer link — set at intake, snapshot of the dealer's name. */
  dealerId?: string;
  dealerName?: string;
  dealerDetectedByPhone?: boolean;
  createdById?: string;
  createdByName?: string;
  updatedById?: string;
  updatedByName?: string;
  updatedAt?: string;
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
