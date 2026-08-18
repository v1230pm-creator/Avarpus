import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { shopsTable, usersTable } from "./auth";

// In-app notifications. One row per recipient — created server-side when
// something notable happens in the shop (new repair, status change, payment,
// approval request/decision). The mobile app polls its own rows.
export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shopsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // Optional navigation payload, e.g. { repairId: "..." }
    data: jsonb("data").notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt)],
);
