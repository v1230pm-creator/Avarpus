import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  mobile: text("mobile").notNull().unique(),
  // Nullable for OTP-only accounts. Legacy password login remains available
  // only for users that already have a stored hash.
  passwordHash: text("password_hash"),
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
  // Set only for sessions issued through a trusted Android device. It lets an
  // explicit logout revoke the matching trust without retaining its raw ID.
  trustedDeviceId: uuid("trusted_device_id").references(() => trustedDeviceTrustsTable.id, {
    onDelete: "set null",
  }),
  deviceInfo: text("device_info"), // e.g. "ios · iPhone 15" or a user-agent snippet
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Android device recovery material. The identifier is SHA-256 hashed before
// reaching this table; no hardware identifiers or raw Android ID are retained.
// A hash is deliberately not globally unique: a recovery lookup fails closed
// when it maps to anything other than one eligible user/device trust.
export const trustedDeviceTrustsTable = pgTable(
  "trusted_device_trusts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    androidIdHash: text("android_id_hash").notNull(),
    deviceInfo: text("device_info"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    recoveryDeadline: timestamp("recovery_deadline", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    // A rotation revokes its immutable generation then inserts a new one.
    // Exactly one unrevoked generation may exist for a user/device pair.
    uniqueIndex("trusted_device_trusts_active_user_android_hash_idx")
      .on(table.userId, table.androidIdHash)
      .where(sql`${table.revokedAt} is null`),
    index("trusted_device_trusts_hash_active_idx").on(table.androidIdHash, table.expiresAt),
  ],
);

// Durable, privacy-preserving recovery throttles. keyHash is a SHA-256 hash
// of a namespaced IP or device-hash key, never either raw input.
export const trustedDeviceRecoveryRateLimitsTable = pgTable(
  "trusted_device_recovery_rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    attemptCount: integer("attempt_count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("trusted_device_recovery_rate_limits_expires_idx").on(table.expiresAt)],
);

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

// Short-lived, hashed state for login OTP verification throttling. This
// intentionally contains no OTP value or provider credential.
export const otpVerificationRateLimitsTable = pgTable(
  "otp_verification_rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    failureCount: integer("failure_count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    inFlightToken: text("in_flight_token"),
    inFlightUntil: timestamp("in_flight_until", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("otp_verification_rate_limits_expires_idx").on(table.expiresAt),
  ],
);

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
export type DbTrustedDeviceTrust = typeof trustedDeviceTrustsTable.$inferSelect;
