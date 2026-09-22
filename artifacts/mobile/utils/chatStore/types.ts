import type {
  ChatMessage,
  ChatMessageSendInput,
  ChatRoom,
  ChatSyncHidden,
  ChatSyncPreference,
  ChatSyncReadState,
  ChatSyncReceipt,
} from '@workspace/api-client-react';

/**
 * Local-first chat storage contract.
 *
 * The device store is the rendering source for chat; the server is the sync
 * source (see .local/tasks/chat-local-first/00-architecture.md). Every row is
 * keyed on Avarpus ids — never Matrix ids — so the transport can be swapped
 * without touching device storage. Media bytes are NOT stored here; only the
 * message metadata (objectPath, mimeType, size, relay state) is.
 *
 * Two implementations exist behind this interface: SQLite on native devices
 * (durable, survives restarts) and an in-memory store on web / when SQLite is
 * unavailable. Both must honour the same merge rules, which live in
 * `merge.ts` so they cannot drift.
 */

export const CHAT_STORE_SCHEMA_VERSION = 3;

export type ChatDeliveryStatus = 'queued' | 'sending' | 'failed' | 'sent' | 'delivered' | 'read';

/** A message as rendered from local data: the server payload plus local state. */
export interface LocalChatMessage extends ChatMessage {
  /**
   * Effective delivery status for the viewer's OWN messages, combining the
   * server-reported status with locally synced receipts/read states. Absent on
   * incoming messages.
   */
  localStatus?: ChatDeliveryStatus;
  /**
   * App-private file holding this message's attachment bytes (device-owned
   * media). Present once the sender kept its original or the recipient
   * finished a verified download; rendering must prefer it over the relay.
   */
  localMediaPath?: string;
}

/**
 * One device-owned attachment: the permanent home of media bytes. The file
 * lives in app-private storage (document directory, never the cache) and is
 * indexed here by message id so timelines can render from disk. Rows are only
 * written for complete, size-verified files — never for partial downloads.
 */
export interface MediaIndexRow {
  /** Server message id, or `out-<clientRequestId>` while the send is queued. */
  messageId: string;
  roomId: string;
  /** file:// URI inside the account's chat-media directory. */
  localPath: string;
  sizeBytes: number;
  mimeType: string;
  /** `sent` = our own original; `received` = downloaded from the relay. */
  origin: 'sent' | 'received';
  /** True once the server has been told the bytes are stored on this device. */
  storedAcked: boolean;
  createdAt: string;
}

export interface RoomMediaUsage {
  roomId: string;
  bytes: number;
  files: number;
}

/**
 * What this device holds versus what the server can still give back. "Only on
 * this phone" counts indexed files whose message says the relay copy is gone
 * (`purged`/`expired`, or deleted for everyone): nothing else can restore
 * them, so a lost or reset phone loses them for good.
 */
export interface MediaSummary {
  files: number;
  bytes: number;
  onlyOnDeviceFiles: number;
  onlyOnDeviceBytes: number;
}

/** A `lost` ack waiting to be sent: this device's stored copy went missing. */
export interface MediaLostAck {
  messageId: string;
  roomId: string;
}

/** An indexed file together with the (live, relay-backed) message it belongs to. */
export interface RecoverableMedia {
  media: MediaIndexRow;
  message: ChatMessage;
}

/** A room as rendered from local data with derived inbox fields. */
export interface LocalChatRoom extends ChatRoom {
  /** Preference-level soft delete ("delete for me"); hidden from the inbox. */
  deletedAt?: string | null;
  /** Timestamp used for inbox ordering: last visible message or room creation. */
  lastActivityAt: string;
}

export type OutboxState = 'pending_upload' | 'queued' | 'sending' | 'failed';

/**
 * One durable send. Text sends are `queued` immediately; media sends start as
 * `pending_upload` (bytes still on device at `localUri`) and become `queued`
 * once the upload finished and `objectPath` is known.
 */
export interface OutboxItem {
  /** Idempotency key sent to the server; also the local primary key. */
  clientRequestId: string;
  roomId: string;
  kind: ChatMessageSendInput['kind'];
  body: string;
  replyToMessageId?: string;
  objectPath?: string;
  contentType?: string;
  sizeBytes?: number;
  durationMs?: number;
  /** Device file the media is uploaded from (media sends only). */
  localUri?: string;
  /** The app created the file itself (voice note) and must delete it when done. */
  ownedTempFile?: boolean;
  state: OutboxState;
  attempts: number;
  lastError?: string | null;
  /** Earliest time the flusher may try again (ISO). */
  nextAttemptAt: string;
  /** Local enqueue time (ISO); sends are flushed in this order. */
  createdAt: string;
  /** Snapshot of the quoted message for optimistic rendering. */
  replyTo?: ChatMessage['replyTo'];
}

export interface ReadStateRow {
  roomId: string;
  userId: string;
  lastReadMessageId: string | null;
  lastReadAt: string;
}

export interface ReceiptRow {
  messageId: string;
  roomId: string;
  userId: string;
  deliveredAt: string;
  storedAt: string | null;
  updatedAt: string;
}

export interface StoreChange {
  /** Room list ordering / previews / unread counts may have changed. */
  rooms: boolean;
  /** Rooms whose message timeline changed. */
  roomIds: Set<string>;
  /** Outbox rows changed. */
  outbox: boolean;
}

export type StoreListener = (change: StoreChange) => void;

export interface ListMessagesOptions {
  /** Return only messages created strictly before this ISO timestamp. */
  before?: string;
  limit: number;
}

export interface ChatStore {
  readonly kind: 'sqlite' | 'memory';
  /** Account this store belongs to (users.id). */
  readonly accountId: string;

  // ── Rooms ────────────────────────────────────────────────────────────────
  /** Insert or replace room payloads. Preferences carried by the payload win. */
  upsertRooms(rooms: ChatRoom[]): Promise<void>;
  applyPreferences(entries: ChatSyncPreference[]): Promise<void>;
  /** Locally mirror a preference change made by this device. */
  setRoomPreference(
    roomId: string,
    patch: Partial<Pick<ChatRoom, 'isPinned' | 'isMuted' | 'isArchived'>> & { deletedAt?: string | null },
  ): Promise<void>;
  listRooms(): Promise<LocalChatRoom[]>;
  getRoom(roomId: string): Promise<LocalChatRoom | null>;
  hasRoom(roomId: string): Promise<boolean>;

  // ── Messages ─────────────────────────────────────────────────────────────
  upsertMessages(messages: ChatMessage[]): Promise<void>;
  applyHidden(entries: ChatSyncHidden[]): Promise<void>;
  /** Local echo of "delete for me": the rows vanish from every local view. */
  hideMessages(messageIds: string[]): Promise<void>;
  /** Local echo of "delete for everyone": rows become tombstones. */
  tombstoneMessages(messageIds: string[], deletedAt: string): Promise<void>;
  listMessages(roomId: string, options: ListMessagesOptions): Promise<LocalChatMessage[]>;
  getMessage(messageId: string): Promise<LocalChatMessage | null>;
  countMessages(roomId: string): Promise<number>;
  oldestMessageAt(roomId: string): Promise<string | null>;

  // ── Read / delivery state ────────────────────────────────────────────────
  applyReadStates(entries: ChatSyncReadState[]): Promise<void>;
  applyReceipts(entries: ChatSyncReceipt[]): Promise<void>;
  getReadState(roomId: string, userId: string): Promise<ReadStateRow | null>;

  // ── Delivered acknowledgements ───────────────────────────────────────────
  /** Incoming message ids the device has stored but not yet acknowledged. */
  pendingDeliveredAcks(limit: number): Promise<string[]>;
  markAcknowledged(messageIds: string[]): Promise<void>;

  // ── Media index (device-owned attachment files) ──────────────────────────
  /** Insert or replace the index row for a complete, verified local file. */
  putMedia(row: MediaIndexRow): Promise<void>;
  getMedia(messageId: string): Promise<MediaIndexRow | null>;
  getMediaMany(messageIds: string[]): Promise<Map<string, MediaIndexRow>>;
  /** Move an index row from an outbox key to the server message id after send. */
  rekeyMedia(fromMessageId: string, toMessageId: string): Promise<void>;
  /** Index rows for a room (or every room), for storage management and cleanup. */
  listMedia(roomId?: string): Promise<MediaIndexRow[]>;
  /** Drop index rows only; the caller deletes the files. */
  removeMedia(messageIds: string[]): Promise<void>;
  mediaUsageByRoom(): Promise<RoomMediaUsage[]>;
  /** Received media whose bytes are on disk but not yet reported as stored. */
  pendingStoredAcks(limit: number): Promise<string[]>;
  markStoredAcknowledged(messageIds: string[]): Promise<void>;
  /**
   * Indexed files whose message still has a relay copy (`mediaState` not
   * purged/expired, not deleted): the only rows an integrity check can act
   * on, because a loss found here can still be repaired from the server.
   */
  listRecoverableMedia(): Promise<RecoverableMedia[]>;
  mediaSummary(): Promise<MediaSummary>;
  /**
   * Remember that a `stored` copy went missing while the relay still had the
   * bytes, so the server can be told to wait for a fresh `stored`. Re-indexing
   * the same message (`putMedia`) drops the pending entry: the new `stored`
   * ack supersedes it.
   */
  queueLostAcks(entries: MediaLostAck[]): Promise<void>;
  pendingLostAcks(limit: number): Promise<string[]>;
  markLostAcknowledged(messageIds: string[]): Promise<void>;

  // ── Outbox ───────────────────────────────────────────────────────────────
  enqueueOutbox(item: OutboxItem): Promise<void>;
  updateOutbox(clientRequestId: string, patch: Partial<OutboxItem>): Promise<void>;
  removeOutbox(clientRequestId: string): Promise<void>;
  getOutbox(clientRequestId: string): Promise<OutboxItem | null>;
  /** All outbox rows in flush order (createdAt ascending), optionally per room. */
  listOutbox(roomId?: string): Promise<OutboxItem[]>;

  // ── Sync metadata ────────────────────────────────────────────────────────
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string | null): Promise<void>;

  // ── Lifecycle ────────────────────────────────────────────────────────────
  /** Coalesce notifications for a batch of writes into one change event. */
  batch<T>(fn: () => Promise<T>): Promise<T>;
  subscribe(listener: StoreListener): () => void;
  /** Remove every row (all tables) but keep the store usable. */
  wipe(): Promise<void>;
  close(): Promise<void>;
}

export const META_KEYS = {
  SCHEMA_VERSION: 'schema_version',
  SHOP_ID: 'shop_id',
  SYNC_CURSOR: 'sync_cursor',
  BOOTSTRAPPED: 'bootstrapped',
  LAST_SYNCED_AT: 'last_synced_at',
  /** Start of the delta feed's initial window; older rows need backfill. */
  HISTORY_FLOOR: 'history_floor',
  backfillDone: (roomId: string) => `backfill_done:${roomId}`,
  /** Oldest createdAt fetched by backfill for the room (contiguous below it). */
  backfillFloor: (roomId: string) => `backfill_floor:${roomId}`,
} as const;
