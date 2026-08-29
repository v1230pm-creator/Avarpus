import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { shopsTable, usersTable } from "./auth";

// In-app notifications. One row per recipient — created server-side when
// something notable happens in the shop (new repair, status change, payment,
// approval request/decision). The mobile app polls its own rows.
export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Global direct-chat notifications are membership-scoped rather than
    // shop-scoped, so shopId is intentionally nullable for those rows.
    shopId: uuid("shop_id").references(() => shopsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // Stable event identity for notification-producing operations that can be
    // retried. Null keeps legacy/shop notifications unchanged.
    dedupeKey: text("dedupe_key"),
    // Optional navigation payload, e.g. { repairId: "..." }
    data: jsonb("data").notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    uniqueIndex("notifications_dedupe_key_unique")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
  ],
);
