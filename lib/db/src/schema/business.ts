import {
  doublePrecision,
  integer,
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
  paymentMethod: text("payment_method").notNull(),
  date: text("date").notNull(), // ISO date (yyyy-mm-dd)
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DbCustomer = typeof customersTable.$inferSelect;
export type DbRepair = typeof repairsTable.$inferSelect;
export type DbInventoryItem = typeof inventoryItemsTable.$inferSelect;
export type DbPurchase = typeof purchasesTable.$inferSelect;
export type DbFinanceEntry = typeof financeEntriesTable.$inferSelect;
