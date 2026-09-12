import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sessionsTable, usersTable } from "./auth";

// ── Device push tokens ───────────────────────────────────────────────────────
// One row per device that asked to receive push for a signed-in account.
//
// A token is bound to the session that registered it, not just to the user, so
// that every existing way of ending a session — explicit sign-out, revoking one
// device from Active Sessions, "sign out everywhere", and a password reset —
// stops push on that device without any extra bookkeeping. Deleting the session
// row cascades the token away.
//
// The token itself is the primary key: a device that is handed to another
// person and signed in again must move to the new account rather than keep
// delivering the previous account's alerts.
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
    deviceInfo: text("device_info"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("push_tokens_user_idx").on(t.userId),
    index("push_tokens_session_idx").on(t.sessionId),
  ],
);
