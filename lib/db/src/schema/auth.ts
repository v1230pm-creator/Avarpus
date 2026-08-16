import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  mobile: text("mobile").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("reception"),
  // Shop the user belongs to. Dealers own their shop; staff accounts created
  // by a dealer inherit the dealer's shop. (No FK to avoid a circular
  // users<->shops reference; integrity is maintained by the API layer.)
  shopId: uuid("shop_id"),
  // For dealer-portal accounts (role dealer_owner / dealer_staff): the B2B
  // dealer this login belongs to. (No FK — dealers table lives in business
  // schema; integrity is maintained by the API layer, like shopId.)
  dealerId: uuid("dealer_id"),
  isActive: boolean("is_active").notNull().default(false),
  designation: text("designation"),
  joinDate: text("join_date"),
  businessName: text("business_name"),
  gstNumber: text("gst_number"),
  shopAddress: text("shop_address"),
  profilePhoto: text("profile_photo"),
  companyLogo: text("company_logo"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A dealer's shop/workspace. Created automatically when a dealer registers.
// `settings` holds the shop's default workspace settings (currency, hours, …).
export const shopsTable = pgTable("shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealerId: uuid("dealer_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  gstNumber: text("gst_number"),
  address: text("address"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessionsTable = pgTable("sessions", {
  token: text("token").primaryKey(),
  // Public identifier safe to expose to clients (never expose `token`).
  id: uuid("id").notNull().unique().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  deviceInfo: text("device_info"), // e.g. "ios · iPhone 15" or a user-agent snippet
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Record of each successful sign-in (for the "Login history" screen).
export const loginEventsTable = pgTable("login_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  method: text("method").notNull(), // 'password' | 'otp'
  rememberMe: boolean("remember_me").notNull().default(false),
  deviceInfo: text("device_info"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One-time codes for login OTP, registration verification and password reset.
// `codeHash` stores a sha256 of the code/token — never the raw value.
export const otpCodesTable = pgTable("otp_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(), // email or mobile the code is bound to
  purpose: text("purpose").notNull(), // 'login' | 'register' | 'reset' | 'reset_token'
  codeHash: text("code_hash").notNull(),
  payload: jsonb("payload"), // pending registration details, etc.
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type DbUser = typeof usersTable.$inferSelect;
export type DbShop = typeof shopsTable.$inferSelect;
export type DbSession = typeof sessionsTable.$inferSelect;
export type DbOtpCode = typeof otpCodesTable.$inferSelect;
export type DbLoginEvent = typeof loginEventsTable.$inferSelect;
