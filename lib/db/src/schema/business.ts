import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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
  problem: text("problem").notNull(),
  technicianId: uuid("technician_id"),
  technicianName: text("technician_name"),
  status: text("status").notNull().default("received"),
  priority: text("priority").notNull().default("normal"),
  repairCharge: doublePrecision("repair_charge").notNull().default(0),
  partsCharge: doublePrecision("parts_charge").notNull().default(0),
  advance: doublePrecision("advance").notNull().default(0),
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
  isSample: boolean("is_sample").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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

export type DbApprovalRequest = typeof approvalRequestsTable.$inferSelect;

export type DbCustomer = typeof customersTable.$inferSelect;
export type DbRepair = typeof repairsTable.$inferSelect;
export type DbInventoryItem = typeof inventoryItemsTable.$inferSelect;
export type DbPurchase = typeof purchasesTable.$inferSelect;
export type DbFinanceEntry = typeof financeEntriesTable.$inferSelect;
export type DbRepairPhoto = typeof repairPhotosTable.$inferSelect;
export type DbRepairEvent = typeof repairEventsTable.$inferSelect;
