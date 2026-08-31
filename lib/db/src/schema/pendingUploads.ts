import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * Short-lived ownership records for private objects that have been signed for
 * upload but are not attached to durable application data yet.
 */
export const pendingUploadsTable = pgTable(
  "pending_uploads",
  {
    objectPath: text("object_path").primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    claimToken: uuid("claim_token"),
    claimUntil: timestamp("claim_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("pending_uploads_owner_purpose_idx").on(table.ownerUserId, table.purpose),
    index("pending_uploads_cleanup_idx").on(table.createdAt, table.claimUntil),
  ],
);

export type DbPendingUpload = typeof pendingUploadsTable.$inferSelect;