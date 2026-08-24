import {
  boolean,
  integer,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shopsTable, usersTable } from "./auth";

// One-time SIM verification requests. Raw challenges and status tokens are
// never stored; only SHA-256 hashes are persisted.
export const phoneVerificationChallengesTable = pgTable(
  "phone_verification_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    phoneNumber: text("phone_number").notNull(),
    challengeHash: text("challenge_hash").notNull().unique(),
    statusTokenHash: text("status_token_hash").notNull().unique(),
    deviceId: text("device_id"),
    devicePublicKey: text("device_public_key"),
    status: text("status").notNull().default("pending"),
    failureCode: text("failure_code"),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    sessionIssuedAt: timestamp("session_issued_at", { withTimezone: true }),
  },
  (t) => [
    index("phone_verification_challenges_status_idx").on(t.status, t.expiresAt),
    index("phone_verification_challenges_phone_idx").on(t.phoneNumber, t.createdAt),
  ],
);

// A gateway message id is accepted once only. This prevents a replayed,
// correctly signed gateway delivery from being processed twice.
export const smsVerificationEventsTable = pgTable(
  "sms_verification_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gatewayMessageId: text("gateway_message_id").notNull(),
    senderNumber: text("sender_number").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sms_verification_events_gateway_id_idx").on(t.gatewayMessageId)],
);

// Public keys registered after a successful SIM verification. Private keys
// remain in the Android Keystore and are never sent to the API.
export const userDevicesTable = pgTable(
  "user_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    publicKey: text("public_key").notNull(),
    algorithm: text("algorithm").notNull().default("RSA-SHA256"),
    isRevoked: boolean("is_revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("user_devices_user_device_idx").on(t.userId, t.deviceId),
    index("user_devices_device_lookup_idx").on(t.deviceId, t.isRevoked),
  ],
);

export const deviceAuthChallengesTable = pgTable(
  "device_auth_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    challengeHash: text("challenge_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [index("device_auth_challenges_expiry_idx").on(t.expiresAt)],
);