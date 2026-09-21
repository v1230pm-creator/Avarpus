import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sessionsTable, usersTable } from "./auth";

// ── Device push tokens ───────────────────────────────────────────────────────
// One row per device that asked to receive push for a signed-in account. An
// account signed in on a phone, a second phone and a tablet holds three rows.
//
// A token is bound to the session that registered it, not just to the user, so
// that every existing way of ending a session — explicit sign-out, revoking one
// device from Active Sessions, "sign out everywhere", and a password reset —
// stops push on that device without any extra bookkeeping. Deleting the session
// row cascades the token away.
//
// The token itself is the primary key: a device that is handed to another
// person and signed in again must move to the new account rather than keep
// delivering the previous account's alerts. `deviceId` is the stable installation
// identity a device reports about itself; when a device's token rotates, the
// stale row for the same (user, device) is retired so one handset never holds
// two live tokens.
export const pushTokensTable = pgTable(
  "push_tokens",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // 'ios' | 'android'
    deviceId: text("device_id"),
    deviceInfo: text("device_info"),
    appVersion: text("app_version"),
    // A device that has notifications switched off in the OS (or in-app) keeps
    // its row but is skipped by the sender until it re-registers as enabled.
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    // Delivery bookkeeping for the in-app diagnostics screen. Never the payload.
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("push_tokens_user_idx").on(t.userId),
    index("push_tokens_session_idx").on(t.sessionId),
    index("push_tokens_user_device_idx").on(t.userId, t.deviceId),
  ],
);

// ── Notification preferences ─────────────────────────────────────────────────
// Per-account delivery preferences, applied server-side when a push is sent so
// that every device of the account behaves the same. Absence of a row means
// "everything on" — the defaults below are the product defaults, not a fallback.
//
// Category toggles decide whether a push leaves the server at all; the in-app
// inbox row is always written. `showPreview` controls whether a message push
// carries the message text or only a neutral count. `sound`/`vibration` pick the
// Android channel variant (channel settings are immutable once created, so the
// client registers one channel per combination and the server addresses it).
export const notificationPreferencesTable = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  messages: boolean("messages").notNull().default(true),
  calls: boolean("calls").notNull().default(true),
  dealer: boolean("dealer").notNull().default(true),
  repair: boolean("repair").notNull().default(true),
  payments: boolean("payments").notNull().default(true),
  status: boolean("status").notNull().default(true),
  showPreview: boolean("show_preview").notNull().default(true),
  sound: boolean("sound").notNull().default(true),
  vibration: boolean("vibration").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DbPushToken = typeof pushTokensTable.$inferSelect;
export type DbNotificationPreferences = typeof notificationPreferencesTable.$inferSelect;
