import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

// Personal status updates are intentionally independent from Shops. A status
// may be visible to eligible global-direct contacts, but never to a shop-wide
// audience. Media bytes live in private object storage; only its canonical
// object path and verified metadata are stored here.
export const statusUpdatesTable = pgTable(
  "status_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // text | image | video
    body: text("body"),
    objectPath: text("object_path"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    audience: text("audience").notNull().default("contacts"), // contacts | nobody
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("status_updates_author_created_idx").on(table.authorId, table.createdAt),
    index("status_updates_active_expiry_idx").on(table.expiresAt, table.deletedAt),
  ],
);

// One viewer row per (status, user). Repeated opens update viewedAt rather than
// inflating the viewer count.
export const statusViewersTable = pgTable(
  "status_viewers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statusId: uuid("status_id")
      .notNull()
      .references(() => statusUpdatesTable.id, { onDelete: "cascade" }),
    viewerUserId: uuid("viewer_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("status_viewers_status_user_unique").on(
      table.statusId,
      table.viewerUserId,
    ),
    index("status_viewers_status_viewed_idx").on(table.statusId, table.viewedAt),
  ],
);

export type DbStatusUpdate = typeof statusUpdatesTable.$inferSelect;
export type DbStatusViewer = typeof statusViewersTable.$inferSelect;