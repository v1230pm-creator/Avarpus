import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const publicRequestsTable = pgTable(
  "public_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    requesterName: text("requester_name").notNull(),
    mobile: text("mobile").notNull(),
    email: text("email"),
    subject: text("subject"),
    message: text("message").notNull(),
    status: text("status").notNull().default("received"),
    reviewerUserId: uuid("reviewer_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    ipHash: text("ip_hash").notNull(),
    confirmationAcceptedAt: timestamp("confirmation_accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    index("public_requests_ip_created_idx").on(table.ipHash, table.createdAt),
    index("public_requests_kind_status_idx").on(table.kind, table.status, table.createdAt),
    index("public_requests_mobile_created_idx").on(table.mobile, table.createdAt),
  ],
);

export const publicRequestIdentityVerificationsTable = pgTable(
  "public_request_identity_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicRequestId: uuid("public_request_id")
      .notNull()
      .unique()
      .references(() => publicRequestsTable.id, { onDelete: "restrict" }),
    reviewerUserId: uuid("reviewer_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    method: text("method").notNull(),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("public_request_identity_verifications_reviewer_created_idx").on(
      table.reviewerUserId,
      table.createdAt,
    ),
  ],
);

export const publicRequestTransitionsTable = pgTable(
  "public_request_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicRequestId: uuid("public_request_id")
      .notNull()
      .references(() => publicRequestsTable.id, { onDelete: "restrict" }),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    note: text("note"),
    reviewerUserId: uuid("reviewer_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("public_request_transitions_request_created_idx").on(
      table.publicRequestId,
      table.createdAt,
    ),
    index("public_request_transitions_reviewer_created_idx").on(
      table.reviewerUserId,
      table.createdAt,
    ),
  ],
);

export type PublicRequestRecord = typeof publicRequestsTable.$inferSelect;
export type PublicRequestTransitionRecord =
  typeof publicRequestTransitionsTable.$inferSelect;
export type PublicRequestIdentityVerificationRecord =
  typeof publicRequestIdentityVerificationsTable.$inferSelect;