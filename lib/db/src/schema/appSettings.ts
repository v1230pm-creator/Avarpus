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

// Chat media relay policy. The server keeps chat message text and media
// metadata forever; the media BYTES are only relayed until every recipient
// device has stored its own copy (plus a grace period) or a hard expiry cap
// passes. Values are decimal strings / "true"|"false"; an absent row means the
// documented default (switch OFF, 7 grace days, 30 expiry days).
export const CHAT_RELAY_CLEANUP_ENABLED_KEY = "chat_relay_cleanup_enabled";
export const CHAT_RELAY_GRACE_DAYS_KEY = "chat_relay_grace_days";
export const CHAT_RELAY_EXPIRY_DAYS_KEY = "chat_relay_expiry_days";
// JSON summary of the most recent relay purge run (bytes reclaimed etc.),
// written by the cleanup job so operators can see it in the console.
export const CHAT_RELAY_LAST_RUN_KEY = "chat_relay_last_run";
// JSON summary of the most recent chat receipt prune run (rows removed by
// reason), written by the retention job so an operator can confirm it runs.
// The retention window itself is a code constant
// (api-server `chatReceiptRetention.ts`), not a setting.
export const CHAT_RECEIPT_PRUNE_LAST_RUN_KEY = "chat_receipt_prune_last_run";
// Highest build number ever published as a *critical* release. Raised by the
// publish route and never lowered, so the relay purge's rollout guard keeps
// its answer after a later optional/recommended release archives the
// critical one. (A rollback to a lower published build still caps it.)
export const APP_MIN_SUPPORTED_BUILD_KEY = "app_min_supported_build";
