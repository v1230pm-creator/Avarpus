import {
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
// A customer user is a regular user (role = "customer") linked one-to-one to a
// customers row in the same shop. Created via an activation invite flow only —
// never by public registration. The link is enforced by a uniqueIndex so one
// customer can have at most one login account.
export const customerUsersTable = pgTable(
  "customer_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
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
    uniqueIndex("customer_users_user_shop_idx").on(t.userId, t.shopId),
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
    // Soft-delete (messages are marked deleted, not removed)
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

// ── Abuse reports ────────────────────────────────────────────────────────────
// Reports retain only the references needed for moderation. The reported peer
// is derived server-side from a member-only global direct room.
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_reports_reporter_client_req_unique").on(
      t.reporterUserId,
      t.clientRequestId,
    ),
    index("chat_reports_room_created_idx").on(t.roomId, t.createdAt),
    index("chat_reports_status_created_idx").on(t.status, t.createdAt),
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
export type DbChatReadState = typeof chatReadStateTable.$inferSelect;
export type DbChatProviderIdentity = typeof chatProviderIdentitiesTable.$inferSelect;
