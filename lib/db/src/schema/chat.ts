import {
  type AnyPgColumn,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { shopsTable, usersTable } from "./auth";
import { customersTable } from "./business";

// ── Customer user accounts ───────────────────────────────────────────────────
// A customer user is a login account (role = "customer", or a dealer-portal
// account whose mobile is also on file as a walk-in customer) linked to one or
// more customers rows. One customer row can have at most one login account
// (customerId unique), but one login may own several customer rows — the same
// person entered twice by staff, or on file at more than one shop. Links are
// created by the activation invite flow and by OTP verification, never by
// public registration.
export const customerUsersTable = pgTable(
  "customer_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .unique() // one customer → at most one user account
      .references(() => customersTable.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shopsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("customer_users_user_shop_idx").on(t.userId, t.shopId),
  ],
);

// ── Customer activation invites ──────────────────────────────────────────────
// Issued by shop staff to let a specific customer create a login account.
// Only the SHA-256 hash of the raw token is stored — never the token itself.
// Single-use (consumedAt is set when activated) and short-lived (expiresAt).
export const customerInvitesTable = pgTable("customer_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  // SHA-256 of the raw invite token. The raw token is returned ONCE at creation
  // time and is never stored or re-exposed.
  tokenHash: text("token_hash").notNull().unique(),
  issuedById: uuid("issued_by_id").notNull(),
  issuedByName: text("issued_by_name").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Short-lived proof that an authenticated caller found a specific active user
// through exact contact matching. Global-direct grants have a null shopId.
export const chatContactMatchGrantsTable = pgTable(
  "chat_contact_match_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    callerUserId: uuid("caller_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").references(() => shopsTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_contact_match_grants_lookup_idx").on(
      t.tokenHash,
      t.callerUserId,
      t.targetUserId,
      t.shopId,
    ),
    index("chat_contact_match_grants_expires_idx").on(t.expiresAt),
  ],
);

// Durable, cross-instance contact lookup accounting. IP addresses are stored
// only as one-way hashes.
export const chatContactMatchAttemptsTable = pgTable(
  "chat_contact_match_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_contact_match_attempts_user_created_idx").on(t.userId, t.createdAt),
    index("chat_contact_match_attempts_ip_created_idx").on(t.ipHash, t.createdAt),
    index("chat_contact_match_attempts_created_idx").on(t.createdAt),
  ],
);

// ── Chat rooms ────────────────────────────────────────────────────────────────
// Business rooms are scoped to a shop. `global_direct` is deliberately the
// sole non-shop scope and is membership-only. `kind` distinguishes
// customer-facing rooms from internal dealer/staff rooms.
// `providerRoomId` holds the Matrix room ID once the room has been provisioned
// on the Matrix server. It can be null if provisioning is deferred or unavailable.
export const chatRoomsTable = pgTable(
  "chat_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Global direct rooms intentionally have no business workspace.
    shopId: uuid("shop_id").references(() => shopsTable.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("shop"), // shop | global_direct
    // "customer" — one-on-one or group room for a customer
    // "dealer"   — internal dealer/staff room
    // "support"  — general support channel
    kind: text("kind").notNull().default("support"), // customer | dealer | support
    name: text("name").notNull(),
    customerId: uuid("customer_id").references(() => customersTable.id, {
      onDelete: "set null",
    }),
    dealerId: uuid("dealer_id"), // FK to dealers row (no hard ref to avoid circular dep)
    // Matrix room ID. Absent while provider is unavailable.
    providerRoomId: text("provider_room_id"),
    // Client-generated idempotency key to prevent duplicate rooms.
    clientRequestId: text("client_request_id"),
    // Deterministic one-to-one identity key: the two participant app user IDs
    // sorted ascending and joined by ":". Guarantees at most one room per pair
    // per shop, independent of any UI-supplied request id.
    peerKey: text("peer_key"),
    // Stable Matrix-side correlation key for a direct-room reservation. It
    // produces an app-owned room alias, allowing a later process to resolve a
    // room whose create response was lost instead of creating a second room.
    provisionKey: text("provision_key"),
    // A fresh fence token is written whenever a worker claims provisioning.
    // Finalization compares this token so an older worker cannot overwrite a
    // newer recovery attempt after its lease has expired.
    provisionAttemptId: uuid("provision_attempt_id"),
    // A bounded local claim lease. Its expiry is safe because provisionKey is
    // also enforced by the Matrix room alias.
    provisionLeaseUntil: timestamp("provision_lease_until", { withTimezone: true }),
    createdById: uuid("created_by_id"),
    createdByName: text("created_by_name"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One room per (shop, clientRequestId) — idempotency for offline creation.
    uniqueIndex("chat_rooms_shop_client_request_id_unique")
      .on(t.shopId, t.clientRequestId)
      .where(sql`${t.clientRequestId} IS NOT NULL`),
    // One room per (shop, peerKey) — deterministic dedupe of one-to-one rooms.
    uniqueIndex("chat_rooms_shop_peer_key_unique")
      .on(t.shopId, t.peerKey)
      .where(sql`${t.scope} = 'shop' AND ${t.peerKey} IS NOT NULL`),
    uniqueIndex("chat_rooms_global_direct_peer_key_unique")
      .on(t.peerKey)
      .where(sql`${t.scope} = 'global_direct' AND ${t.peerKey} IS NOT NULL`),
    uniqueIndex("chat_rooms_provision_key_unique")
      .on(t.provisionKey)
      .where(sql`${t.provisionKey} IS NOT NULL`),
  ],
);

// ── Chat room members ─────────────────────────────────────────────────────────
// Tracks which users are members of each room. Required for authorization checks.
export const chatRoomMembersTable = pgTable(
  "chat_room_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").references(() => shopsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // member | moderator
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    // Updated whenever this member syncs their room list or opens the room.
    // Senders use it as a durable "delivered to recipient app" receipt.
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("chat_room_members_room_user_unique").on(t.roomId, t.userId),
  ],
);

// Caller-specific inbox state. Deleting a chat only hides it for this user; it
// never removes the shared room, membership, or another member's history.
export const chatRoomPreferencesTable = pgTable(
  "chat_room_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    isPinned: boolean("is_pinned").notNull().default(false),
    isMuted: boolean("is_muted").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_room_preferences_room_user_unique").on(t.roomId, t.userId),
    index("chat_room_preferences_user_inbox_idx").on(t.userId, t.isArchived, t.deletedAt),
  ],
);

// ── Global direct-chat blocks ────────────────────────────────────────────────
// Blocks are directional: only the user who created a block may remove it.
// Route logic treats either direction as a blocked pair.
export const chatBlocksTable = pgTable(
  "chat_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerUserId: uuid("blocker_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    blockedUserId: uuid("blocked_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_blocks_blocker_blocked_unique").on(t.blockerUserId, t.blockedUserId),
    index("chat_blocks_blocked_user_idx").on(t.blockedUserId),
  ],
);

// ── Chat messages ─────────────────────────────────────────────────────────────
// Server-side record of messages sent through the system. Messages are never
// stored with provider-side IDs as the source of truth — this table IS the
// message store; Matrix sync is supplemental.
export const chatMessagesTable = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").references(() => shopsTable.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    senderName: text("sender_name").notNull(),
    // text | image | file | audio | system
    kind: text("kind").notNull().default("text"),
    body: text("body").notNull(),
    // For image/file/audio messages: the object storage path
    objectPath: text("object_path"),
    // For audio (voice note) messages: duration in milliseconds. Null otherwise.
    durationMs: integer("duration_ms"),
    // Optional Matrix event ID for cross-reference (never used for auth decisions)
    providerEventId: text("provider_event_id"),
    // Client-supplied idempotency key. Required on send. The (room, sender,
    // clientRequestId) triple is unique so retries never create duplicate rows.
    clientRequestId: text("client_request_id"),
    // Quoted message (same room) when this message was sent as a reply.
    replyToMessageId: uuid("reply_to_message_id").references(
      (): AnyPgColumn => chatMessagesTable.id,
      { onDelete: "set null" },
    ),
    // True when the content was copied from another message via Forward.
    forwarded: boolean("forwarded").notNull().default(false),
    // Soft-delete ("delete for everyone": the row stays as a tombstone, the
    // media stays unreachable, and the original body is retained for
    // moderation only — API responses blank it).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_messages_room_sender_client_req_unique")
      .on(t.roomId, t.senderId, t.clientRequestId)
      .where(sql`${t.clientRequestId} IS NOT NULL`),
  ],
);

// ── Per-user hidden messages ("delete for me") ───────────────────────────────
// Hiding is caller-specific: the row disappears from this user's transcript
// only. The shared message, its media, and the other member's copy are never
// touched.
export const chatMessageHiddenTable = pgTable(
  "chat_message_hidden",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessagesTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_message_hidden_message_user_unique").on(t.messageId, t.userId),
    index("chat_message_hidden_user_idx").on(t.userId),
  ],
);

// ── Abuse reports ────────────────────────────────────────────────────────────
// Reports retain only the references needed for moderation. The reported peer
// is derived server-side from a member-only global direct room.
// `status` is the operator review state: open | reviewed | actioned | dismissed.
// Only platform operators (super_admin) ever read or advance these rows.
export const chatReportsTable = pgTable(
  "chat_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterUserId: uuid("reporter_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    reportedUserId: uuid("reported_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => chatMessagesTable.id, {
      onDelete: "set null",
    }),
    clientRequestId: text("client_request_id").notNull(),
    reason: text("reason").notNull(),
    details: text("details"),
    status: text("status").notNull().default("open"),
    // Operator attribution for the review decision. Null while the report is
    // still open. The reviewer reference survives operator deletion so the
    // moderation record itself is never lost.
    reviewerUserId: uuid("reviewer_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    // The bulk decision this row's current state came from, when it came from
    // one. Anything that moves the row afterwards clears it, so a withdrawal
    // can only ever restore rows still carrying that batch's own decision.
    // Deliberately not a foreign key: the batch table points back at reports,
    // and declaring both directions would make the two modules circular.
    decisionBatchId: uuid("decision_batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_reports_reporter_client_req_unique").on(
      t.reporterUserId,
      t.clientRequestId,
    ),
    index("chat_reports_room_created_idx").on(t.roomId, t.createdAt),
    index("chat_reports_status_created_idx").on(t.status, t.createdAt),
    // Keyset paging for the unfiltered operator queue.
    index("chat_reports_created_idx").on(t.createdAt, t.id),
    // One abusive account can collect reports from many different people. The
    // queue counts the other open reports naming each reported user on the
    // page, which is a grouped lookup keyed by exactly these two columns.
    index("chat_reports_reported_status_idx").on(t.reportedUserId, t.status),
  ],
);

// ── Bulk decision batches ────────────────────────────────────────────────────
// One click can settle every report still open against the same account, which
// is several different people's complaints moving at once. The batch itself is
// therefore a row: who recorded it, when, and what each report looked like
// before it moved, so the operator who recorded it can withdraw it inside a
// short window. Batch rows are never deleted — a withdrawal is recorded on the
// row, not by removing it, or the undo would erase its own audit trail.
export const chatReportDecisionBatchesTable = pgTable(
  "chat_report_decision_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportedUserId: uuid("reported_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // The report the operator was looking at when they recorded the decision.
    // Nulled rather than cascaded if that report is ever removed, so the rest
    // of the batch's trail survives.
    anchorReportId: uuid("anchor_report_id").references(
      (): AnyPgColumn => chatReportsTable.id,
      { onDelete: "set null" },
    ),
    // Who recorded it. The name is copied in so the trail still names a human
    // if the operator account is later deleted.
    operatorUserId: uuid("operator_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    operatorName: text("operator_name").notNull(),
    // The decision the batch applied: reviewed | actioned | dismissed.
    status: text("status").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // A withdrawal is an audited act of its own: who undid it and when.
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnByUserId: uuid("withdrawn_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    withdrawnByName: text("withdrawn_by_name"),
    // How many reports the withdrawal actually put back. Rows another operator
    // had moved on in the meantime are not among them.
    restoredReportCount: integer("restored_report_count"),
  },
  (t) => [
    index("chat_report_decision_batches_operator_idx").on(
      t.operatorUserId,
      t.decidedAt,
    ),
    index("chat_report_decision_batches_reported_idx").on(
      t.reportedUserId,
      t.decidedAt,
    ),
  ],
);

// What one batched report looked like before the batch moved it. This is the
// only record of the state a withdrawal restores — each report in a batch can
// have come from a different place (its own earlier note, its own reviewer),
// so the batch as a whole cannot describe it.
export const chatReportDecisionBatchItemsTable = pgTable(
  "chat_report_decision_batch_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => chatReportDecisionBatchesTable.id, {
        onDelete: "cascade",
      }),
    reportId: uuid("report_id")
      .notNull()
      .references((): AnyPgColumn => chatReportsTable.id, {
        onDelete: "cascade",
      }),
    previousStatus: text("previous_status").notNull(),
    previousReviewerUserId: uuid("previous_reviewer_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    previousReviewedAt: timestamp("previous_reviewed_at", {
      withTimezone: true,
    }),
    previousReviewNote: text("previous_review_note"),
    // Set when a withdrawal put this particular report back.
    restoredAt: timestamp("restored_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("chat_report_decision_batch_items_unique").on(
      t.batchId,
      t.reportId,
    ),
    index("chat_report_decision_batch_items_report_idx").on(t.reportId),
  ],
);

// ── Transcript access trail ──────────────────────────────────────────────────
// Every time a platform operator opens the conversation behind an abuse report
// they read two private people's messages. That read is logged here so the
// access itself can be reviewed later. The operator reference is nulled if the
// operator account is ever deleted, but their name is copied in so the trail
// still names a human. Rows are never updated — one row per opened transcript.
export const chatReportTranscriptViewsTable = pgTable(
  "chat_report_transcript_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => chatReportsTable.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    operatorUserId: uuid("operator_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    operatorName: text("operator_name").notNull(),
    // The message the report pointed at, when it still exists.
    anchorMessageId: uuid("anchor_message_id").references(
      () => chatMessagesTable.id,
      { onDelete: "set null" },
    ),
    // How much of the conversation the operator was shown in this read.
    messageCount: integer("message_count").notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("chat_report_transcript_views_report_idx").on(t.reportId, t.viewedAt),
    index("chat_report_transcript_views_operator_idx").on(
      t.operatorUserId,
      t.viewedAt,
    ),
  ],
);

// ── Chat read state ───────────────────────────────────────────────────────────
// Tracks the last read message for each user in each room. Used to compute
// unread counts client-side and display read receipts.
export const chatReadStateTable = pgTable(
  "chat_read_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").references(() => shopsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    lastReadMessageId: uuid("last_read_message_id").references(
      () => chatMessagesTable.id,
      { onDelete: "set null" },
    ),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_read_state_room_user_unique").on(t.roomId, t.userId),
  ],
);

// ── Chat provider identities ──────────────────────────────────────────────────
// Maps each application user to their Matrix user ID. Created lazily when the
// user first joins a Matrix-backed room.
export const chatProviderIdentitiesTable = pgTable(
  "chat_provider_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").references(() => shopsTable.id, { onDelete: "cascade" }),
    // "matrix" — Matrix/Element Server Suite
    provider: text("provider").notNull().default("matrix"),
    // The provider-side user identifier, e.g. @localpart:server
    providerUserId: text("provider_user_id").notNull(),
    // Additional metadata (e.g. Matrix access token for bot accounts — NEVER exposed to clients)
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_provider_identities_user_provider_unique").on(
      t.userId,
      t.provider,
    ),
  ],
);

// ── Type exports ─────────────────────────────────────────────────────────────
export type DbCustomerUser = typeof customerUsersTable.$inferSelect;
export type DbCustomerInvite = typeof customerInvitesTable.$inferSelect;
export type DbChatContactMatchGrant = typeof chatContactMatchGrantsTable.$inferSelect;
export type DbChatContactMatchAttempt = typeof chatContactMatchAttemptsTable.$inferSelect;
export type DbChatRoom = typeof chatRoomsTable.$inferSelect;
export type DbChatRoomMember = typeof chatRoomMembersTable.$inferSelect;
export type DbChatBlock = typeof chatBlocksTable.$inferSelect;
export type DbChatMessage = typeof chatMessagesTable.$inferSelect;
export type DbChatReport = typeof chatReportsTable.$inferSelect;
export type DbChatReportDecisionBatch =
  typeof chatReportDecisionBatchesTable.$inferSelect;
export type DbChatReportDecisionBatchItem =
  typeof chatReportDecisionBatchItemsTable.$inferSelect;
export type DbChatReportTranscriptView =
  typeof chatReportTranscriptViewsTable.$inferSelect;
export type DbChatReadState = typeof chatReadStateTable.$inferSelect;
export type DbChatProviderIdentity = typeof chatProviderIdentitiesTable.$inferSelect;
