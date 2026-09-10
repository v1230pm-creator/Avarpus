import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

// ── Global operator settings (not shop-scoped) ──────────────────────────────
// A small key/value store for platform-level configuration a super_admin can
// change from the admin console without a deploy. Values are plain strings;
// never store secrets or credentials here — those belong in workspace secrets.

export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: uuid("updated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Destination inbox for "a new public request arrived" alert emails.
// An absent row (or an empty value) means alerts are turned off.
export const SUPPORT_NOTIFICATION_EMAIL_KEY = "support_notification_email";
