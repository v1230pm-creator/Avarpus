import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shopsTable } from "./auth";

// ── Shop-scoped business data ───────────────────────────────────────────────
// Every table carries a required shopId; the API layer always filters by the
// authenticated user's shop so dealers only ever see their own data.

export const customersTable = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mobile: text("mobile").notNull(),
  alternateMobile: text("alternate_mobile"),
  email: text("email"),
  address: text("address"),
  dueAmount: doublePrecision("due_amount").notNull().default(0),
  totalRepairs: integer("total_repairs").notNull().default(0),
  isSample: boolean("is_sample").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const repairsTable = pgTable("repairs", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  repairId: text("repair_id").notNull(), // human-readable ticket no, e.g. VMC-001
  customerId: uuid("customer_id").references(() => customersTable.id, {
    onDelete: "set null",
  }),
  customerName: text("customer_name").notNull(),
  mobile: text("mobile").notNull(),
  deviceType: text("device_type").notNull(),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  imei: text("imei"),
  imei2: text("imei2"),
  serialNumber: text("serial_number"),
  color: text("color"),
  storage: text("storage"),
  ram: text("ram"),
  devicePassword: text("device_password"), // optional; shown only to shop users
  simPresent: boolean("sim_present").notNull().default(false),
  memoryCardPresent: boolean("memory_card_present").notNull().default(false),
  alternateMobile: text("alternate_mobile"),
  accessories: text("accessories"), // free-text accessories (legacy)
  accessoriesList: jsonb("accessories_list"), // string[] of checked accessories
  physicalCondition: jsonb("physical_condition"), // { [item: string]: boolean } damage checklist
  problem: text("problem").notNull(),
  deviceCondition: text("device_condition"), // physical condition noted at intake
  diagnosis: text("diagnosis"), // technician's diagnosis during repair
  workPerformed: text("work_performed"), // summary of the actual repair work
  technicianId: uuid("technician_id"),
  technicianName: text("technician_name"),
  assignedById: uuid("assigned_by_id"),
  assignedByName: text("assigned_by_name"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  status: text("status").notNull().default("received"),
  priority: text("priority").notNull().default("normal"),
  // Charges breakdown: repairCharge = labour; final =
  // labour + parts + service + other − discount + tax
  repairCharge: doublePrecision("repair_charge").notNull().default(0),
  partsCharge: doublePrecision("parts_charge").notNull().default(0),
  serviceCharge: doublePrecision("service_charge").notNull().default(0),
  otherCharge: doublePrecision("other_charge").notNull().default(0),
  discount: doublePrecision("discount").notNull().default(0),
  taxPercent: doublePrecision("tax_percent").notNull().default(0),
  // Cached sum of repair_payments rows — the ledger is the source of truth.
  advance: doublePrecision("advance").notNull().default(0),
  // Final testing gate before repair can be marked ready/completed
  testingChecklist: jsonb("testing_checklist"), // { [item: string]: boolean }
  testingConfirmedById: uuid("testing_confirmed_by_id"),
  testingConfirmedByName: text("testing_confirmed_by_name"),
  testingConfirmedAt: timestamp("testing_confirmed_at", { withTimezone: true }),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  customerNotifiedAt: timestamp("customer_notified_at", { withTimezone: true }),
  // Idempotency key for offline-queued intake sync (client-generated)
  clientRequestId: text("client_request_id"),
  receiveDate: text("receive_date").notNull(), // ISO date (yyyy-mm-dd)
  expectedDate: text("expected_date").notNull(),
  deliveryDate: text("delivery_date"),
  notes: text("notes"),
  // Device intake additions
  checklist: jsonb("checklist"), // { [item: string]: boolean } captured at receiving
  receivingSignaturePath: text("receiving_signature_path"), // /objects/... in App Storage
  deliverySignaturePath: text("delivery_signature_path"),
  warrantyDays: integer("warranty_days").notNull().default(0), // 0 = no warranty
  warrantyExpiry: text("warranty_expiry"), // ISO date, computed on delivery
  // Workflow accountability (who received / handed over the device)
  receivedById: uuid("received_by_id"),
  receivedByName: text("received_by_name"),
  deliveredById: uuid("delivered_by_id"),
  deliveredByName: text("delivered_by_name"),
  paymentMethod: text("payment_method"), // recorded at handover (Cash/UPI/…)
  // Stamped server-side on status transitions (start of work / completion)
  repairStartedAt: timestamp("repair_started_at", { withTimezone: true }),
  repairCompletedAt: timestamp("repair_completed_at", { withTimezone: true }),
  isSample: boolean("is_sample").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  // Offline sync dedupe: a client-generated id may only create one repair.
  uniqueIndex("repairs_shop_client_request_id_unique")
    .on(t.shopId, t.clientRequestId)
    .where(sql`${t.clientRequestId} IS NOT NULL`),
]);

export const inventoryItemsTable = pgTable("inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(), // 'product' | 'accessory' | 'spare_part'
  brand: text("brand").notNull(),
  quantity: integer("quantity").notNull().default(0),
  minStock: integer("min_stock").notNull().default(0),
  purchasePrice: doublePrecision("purchase_price").notNull().default(0),
  sellingPrice: doublePrecision("selling_price").notNull().default(0),
  sku: text("sku"),
  supplier: text("supplier"),
  isSample: boolean("is_sample").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const purchasesTable = pgTable("purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  purchaseId: text("purchase_id").notNull(), // human-readable, e.g. PUR-001
  invoiceNo: text("invoice_no").notNull(),
  supplier: text("supplier").notNull(),
  supplierMobile: text("supplier_mobile"),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity").notNull().default(0),
  purchasePrice: doublePrecision("purchase_price").notNull().default(0),
  total: doublePrecision("total").notNull().default(0),
  paymentStatus: text("payment_status").notNull().default("unpaid"), // paid | unpaid | partial
  paymentMethod: text("payment_method").notNull(),
  date: text("date").notNull(), // ISO date (yyyy-mm-dd)
  isSample: boolean("is_sample").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const financeEntriesTable = pgTable("finance_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'income' | 'expense'
  category: text("category").notNull(),
  amount: doublePrecision("amount").notNull(),
  description: text("description").notNull(),
  isSample: boolean("is_sample").notNull().default(false),
  paymentMethod: text("payment_method").notNull(),
  date: text("date").notNull(), // ISO date (yyyy-mm-dd)
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Photos & documents attached to a repair (device photos, damage, bill, customer ID)
export const repairPhotosTable = pgTable("repair_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  repairId: uuid("repair_id")
    .notNull()
    .references(() => repairsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // front|back|left|right|top|bottom|damage|bill|customer_id|other
  objectPath: text("object_path").notNull(), // /objects/... in App Storage
  uploadedById: uuid("uploaded_by_id"),
  uploadedByName: text("uploaded_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Immutable activity timeline for a repair (also serves as audit log).
// Rows are append-only: no update/delete endpoints exist by design.
export const repairEventsTable = pgTable("repair_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  repairId: uuid("repair_id")
    .notNull()
    .references(() => repairsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id"),
  userName: text("user_name").notNull(),
  userRole: text("user_role").notNull(),
  action: text("action").notNull(), // created|status_changed|photo_added|signature_captured|checklist_updated|assigned|...
  details: jsonb("details"), // free-form structured payload (old/new status, photo kind, etc.)
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Backdated-entry approval workflow. Staff (non-dealer) creating/editing a
// dated record with a past date must go through a pending request that the
// dealer approves or rejects. Rows are kept permanently as the audit trail.
export const approvalRequestsTable = pgTable("approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  requesterId: uuid("requester_id").notNull(),
  requesterName: text("requester_name").notNull(),
  requesterRole: text("requester_role").notNull(),
  recordType: text("record_type").notNull(), // repair | purchase | finance
  mode: text("mode").notNull().default("create"), // create | update
  recordId: uuid("record_id"), // for updates
  payload: jsonb("payload").notNull(), // the record body to save on approval
  requestedDate: text("requested_date").notNull(), // the backdated date (yyyy-mm-dd)
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  decidedById: uuid("decided_by_id"),
  decidedByName: text("decided_by_name"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Return / Rework / Refund workflow ──────────────────────────────────────
// A delivered repair can come back. The original repair row is never edited
// or deleted — a return case links to it and carries its own lifecycle.
export const repairReturnsTable = pgTable("repair_returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  returnId: text("return_id").notNull(), // e.g. RET-VMC-005-01
  repairId: uuid("repair_id")
    .notNull()
    .references(() => repairsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customersTable.id, {
    onDelete: "set null",
  }),
  // Lifecycle: return_received → inspection → rework_approved → in_repair →
  // ready → delivered → closed (dealer can close from any state)
  status: text("status").notNull().default("returned"),
  returnDate: text("return_date").notNull(), // ISO date (yyyy-mm-dd)
  daysAfterDelivery: integer("days_after_delivery"),
  reason: text("reason").notNull(), // same_problem|stopped_working|repair_failed|new_problem|complaint|warranty_rework|refund_requested|other
  complaint: text("complaint").notNull(),
  deviceCondition: text("device_condition"),
  underWarranty: boolean("under_warranty").notNull().default(false),
  receivedById: uuid("received_by_id"),
  receivedByName: text("received_by_name"),
  // Inspection / resolution
  resolution: text("resolution"), // rework|parts_replacement|no_fault_found|cannot_repair|refund|partial_refund|customer_declined|other
  technicianId: uuid("technician_id"),
  technicianName: text("technician_name"),
  diagnosis: text("diagnosis"),
  workPerformed: text("work_performed"),
  partsCost: doublePrecision("parts_cost").notNull().default(0),
  labourCost: doublePrecision("labour_cost").notNull().default(0),
  customerPayable: doublePrecision("customer_payable").notNull().default(0),
  notes: text("notes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  // Backstop against duplicate RET-…-NN ids under concurrent creation.
  uniqueIndex("repair_returns_shop_return_id_unique").on(t.shopId, t.returnId),
]);

// Parts consumed during a rework — inventory is deducted when a row is added.
// Append-only: refunds do NOT restock parts automatically.
export const returnPartsTable = pgTable("return_parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  returnId: uuid("return_id")
    .notNull()
    .references(() => repairReturnsTable.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id"),
  partName: text("part_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitCost: doublePrecision("unit_cost").notNull().default(0),
  addedById: uuid("added_by_id"),
  addedByName: text("added_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Parts consumed on the original repair — append-only, inventory is deducted
// when a row is added, linked to the same repair ticket.
export const repairPartsTable = pgTable("repair_parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  repairId: uuid("repair_id")
    .notNull()
    .references(() => repairsTable.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id"),
  partName: text("part_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitCost: doublePrecision("unit_cost").notNull().default(0),
  addedById: uuid("added_by_id"),
  addedByName: text("added_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Refunds are separate financial transactions — the original payment/repair
// charges are never edited. Staff can only request (pending_approval);
// dealer/owner approves, rejects and marks paid.
export const refundsTable = pgTable("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  repairId: uuid("repair_id")
    .notNull()
    .references(() => repairsTable.id, { onDelete: "cascade" }),
  returnId: uuid("return_id")
    .notNull()
    .references(() => repairReturnsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customersTable.id, {
    onDelete: "set null",
  }),
  amount: doublePrecision("amount").notNull(),
  originalPaid: doublePrecision("original_paid").notNull().default(0),
  method: text("method").notNull().default("Cash"), // Cash|UPI|Bank Transfer|Card|Other
  status: text("status").notNull().default("pending_approval"), // pending_approval|approved|paid|rejected
  reason: text("reason").notNull(),
  referenceNo: text("reference_no"),
  requestedById: uuid("requested_by_id"),
  requestedByName: text("requested_by_name"),
  approvedById: uuid("approved_by_id"),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidById: uuid("paid_by_id"),
  paidByName: text("paid_by_name"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Payments ledger ─────────────────────────────────────────────────────────
// Every customer payment (advance / partial / final) is its own append-only
// row; repairs.advance is only a cached SUM of these rows, updated in the
// same transaction. Rows are never edited or deleted — corrections happen
// via refunds.
export const repairPaymentsTable = pgTable("repair_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  repairId: uuid("repair_id")
    .notNull()
    .references(() => repairsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customersTable.id, {
    onDelete: "set null",
  }),
  amount: doublePrecision("amount").notNull(),
  method: text("method").notNull().default("Cash"), // Cash|UPI|Card|Bank Transfer|Other
  kind: text("kind").notNull().default("advance"), // advance | partial | final
  note: text("note"),
  referenceNo: text("reference_no"),
  receivedById: uuid("received_by_id"),
  receivedByName: text("received_by_name"),
  isSample: boolean("is_sample").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Append-only inventory movement ledger. Written in the same transaction as
// the stock change (repair part used, rework part used, purchase received,
// manual adjustment).
export const stockMovementsTable = pgTable("stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id"),
  itemName: text("item_name").notNull(),
  quantityChange: integer("quantity_change").notNull(), // negative = consumed
  reason: text("reason").notNull(), // repair_part|return_part|purchase|adjustment
  repairId: uuid("repair_id"),
  returnId: uuid("return_id"),
  byId: uuid("by_id"),
  byName: text("by_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Customer approval for estimate changes ("Waiting for Customer Approval").
// Confirmation can be email OTP, captured signature, or manual dealer
// confirmation; the decision is stored permanently.
export const estimateApprovalsTable = pgTable("estimate_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  repairId: uuid("repair_id")
    .notNull()
    .references(() => repairsTable.id, { onDelete: "cascade" }),
  oldAmount: doublePrecision("old_amount").notNull(),
  newAmount: doublePrecision("new_amount").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  // Repair status at the moment the job was parked in 'customer_approval';
  // the decision endpoint restores this exact stage (never a rewind).
  previousStatus: text("previous_status"),
  method: text("method"), // otp | signature | dealer
  signaturePath: text("signature_path"),
  requestedById: uuid("requested_by_id"),
  requestedByName: text("requested_by_name"),
  decidedById: uuid("decided_by_id"),
  decidedByName: text("decided_by_name"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Short-lived email OTP codes for customer confirmations (estimate approval,
// delivery handover). Only the bcrypt hash is stored.
export const customerOtpCodesTable = pgTable("customer_otp_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), // estimate_approval | delivery_confirmation | intake_confirmation
  targetId: uuid("target_id").notNull(), // repair or estimate-approval row id
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  // Marks a verified OTP as spent so it cannot confirm an action twice.
  // Set in the same transaction that acts on the verification.
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DbRepairPayment = typeof repairPaymentsTable.$inferSelect;
export type DbStockMovement = typeof stockMovementsTable.$inferSelect;
export type DbEstimateApproval = typeof estimateApprovalsTable.$inferSelect;
export type DbCustomerOtpCode = typeof customerOtpCodesTable.$inferSelect;

export type DbRepairReturn = typeof repairReturnsTable.$inferSelect;
export type DbReturnPart = typeof returnPartsTable.$inferSelect;
export type DbRepairPart = typeof repairPartsTable.$inferSelect;
export type DbRefund = typeof refundsTable.$inferSelect;

export type DbApprovalRequest = typeof approvalRequestsTable.$inferSelect;

export type DbCustomer = typeof customersTable.$inferSelect;
export type DbRepair = typeof repairsTable.$inferSelect;
export type DbInventoryItem = typeof inventoryItemsTable.$inferSelect;
export type DbPurchase = typeof purchasesTable.$inferSelect;
export type DbFinanceEntry = typeof financeEntriesTable.$inferSelect;
export type DbRepairPhoto = typeof repairPhotosTable.$inferSelect;
export type DbRepairEvent = typeof repairEventsTable.$inferSelect;
