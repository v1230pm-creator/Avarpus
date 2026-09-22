import type {
  ChatMessage,
  ChatRoom,
  ChatSyncHidden,
  ChatSyncPreference,
  ChatSyncReadState,
  ChatSyncReceipt,
} from '@workspace/api-client-react';
import {
  applyPreferenceToRoom,
  compareRooms,
  decorateMessage,
  mergeRoom,
  resolveUnread,
  shouldReplaceMessage,
  toLocalRoom,
  type StoredRoom,
} from './merge';
import { ChangeNotifier } from './notifier';
import { CHAT_STORE_SCHEMA_VERSION, META_KEYS } from './types';
import type {
  ChatStore,
  ListMessagesOptions,
  LocalChatMessage,
  LocalChatRoom,
  MediaIndexRow,
  MediaLostAck,
  MediaSummary,
  OutboxItem,
  ReadStateRow,
  ReceiptRow,
  RecoverableMedia,
  RoomMediaUsage,
  StoreListener,
} from './types';

/**
 * The subset of expo-sqlite's SQLiteDatabase this store uses. Declared locally
 * so the store can be typed without importing the native module at load time
 * (see backend.ts for the lazy require).
 */
export interface SqlDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params?: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(source: string, params?: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params?: SqlValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export type SqlValue = string | number | null;


interface RoomRow {
  id: string;
  deleted_at: string | null;
  pref_updated_at: string | null;
  payload: string;
}

interface MessageRow {
  id: string;
  room_id: string;
  created_at: string;
  hidden: number;
  acked: number;
  payload: string;
}

interface OutboxRow {
  client_request_id: string;
  payload: string;
}

interface MediaRow {
  message_id: string;
  room_id: string;
  local_path: string;
  size_bytes: number;
  mime_type: string;
  origin: string;
  stored_acked: number;
  created_at: string;
}

/**
 * Versioned schema. Bump CHAT_STORE_SCHEMA_VERSION and add a migration step in
 * `migrate()` whenever a table changes; the store is per account and cheap to
 * rebuild from the server, so a migration may also choose to wipe and resync.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  pref_updated_at TEXT,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  acked INTEGER NOT NULL DEFAULT 0,
  client_request_id TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_room_created ON messages (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_pending_ack ON messages (acked) WHERE acked = 0;
CREATE TABLE IF NOT EXISTS read_states (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_message_id TEXT,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE IF NOT EXISTS receipts (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  delivered_at TEXT NOT NULL,
  stored_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS receipts_room ON receipts (room_id);
CREATE TABLE IF NOT EXISTS outbox (
  client_request_id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  state TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_order ON outbox (created_at);
CREATE TABLE IF NOT EXISTS media (
  message_id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  local_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  origin TEXT NOT NULL,
  stored_acked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_room ON media (room_id);
CREATE INDEX IF NOT EXISTS media_pending_stored ON media (stored_acked) WHERE stored_acked = 0;
CREATE TABLE IF NOT EXISTS media_lost (
  message_id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

const TABLES = ['media_lost', 'media', 'outbox', 'receipts', 'read_states', 'messages', 'rooms', 'meta'];

/**
 * SQL predicate: the message a media row belongs to still has a relay copy on
 * the server (mirrors `relayAvailable` in utils/chatMedia/policy.ts). Rows
 * without a `mediaState` are older history and count as available.
 */
const RELAY_AVAILABLE_SQL = `messages.deleted_at IS NULL
  AND COALESCE(json_extract(messages.payload, '$.mediaState'), 'available') NOT IN ('purged', 'expired')`;

export class SqliteChatStore implements ChatStore {
  readonly kind = 'sqlite' as const;
  private notifier = new ChangeNotifier();
  // expo-sqlite transactions share the connection with every other query, so
  // two writers (sync + outbox) must never open transactions concurrently.
  private writeChain: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly accountId: string,
    private readonly db: SqlDatabase,
  ) {}

  /** Opens (creating or migrating as needed) the store for one account. */
  static async open(accountId: string, db: SqlDatabase): Promise<SqliteChatStore> {
    const store = new SqliteChatStore(accountId, db);
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync(SCHEMA_SQL);
    await store.migrate();
    return store;
  }

  private transaction(task: () => Promise<void>): Promise<void> {
    const run = this.writeChain.then(() => this.db.withTransactionAsync(task));
    this.writeChain = run.catch(() => {});
    return run;
  }

  private async migrate(): Promise<void> {
    const stored = Number((await this.getMeta(META_KEYS.SCHEMA_VERSION)) ?? '0');
    if (stored === CHAT_STORE_SCHEMA_VERSION) return;
    if (stored > CHAT_STORE_SCHEMA_VERSION) {
      // Written by a newer app build: the row shapes are unknown, start over.
      await this.wipe();
    }
    // v0 → v1: fresh install; nothing to transform.
    // v1 → v2: adds the `media` index table. SCHEMA_SQL already created it
    // (CREATE TABLE IF NOT EXISTS), and existing rows need no backfill: media
    // that was never kept on this device is simply not indexed and is fetched
    // from the relay on demand.
    // v2 → v3: adds `media_lost` (pending `lost` acks). Also created by
    // SCHEMA_SQL; nothing to backfill — the integrity sweep discovers missing
    // files on its own. Future versions add their ALTER/backfill steps here
    // in order, each guarded by `stored < N`.
    await this.setMeta(META_KEYS.SCHEMA_VERSION, String(CHAT_STORE_SCHEMA_VERSION));
  }

  // ── Rooms ────────────────────────────────────────────────────────────────
  private async readRoom(roomId: string): Promise<StoredRoom | null> {
    const row = await this.db.getFirstAsync<RoomRow>('SELECT * FROM rooms WHERE id = ?', [roomId]);
    return row ? rowToRoom(row) : null;
  }

  private async writeRoom(room: StoredRoom): Promise<void> {
    const { deletedAt, prefUpdatedAt, ...payload } = room;
    await this.db.runAsync(
      `INSERT OR REPLACE INTO rooms (id, kind, created_at, is_pinned, is_archived, deleted_at, pref_updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        room.id,
        room.kind,
        room.createdAt,
        room.isPinned ? 1 : 0,
        room.isArchived ? 1 : 0,
        deletedAt ?? null,
        prefUpdatedAt ?? null,
        JSON.stringify(payload),
      ],
    );
  }

  async upsertRooms(rooms: ChatRoom[]): Promise<void> {
    if (rooms.length === 0) return;
    await this.transaction(async () => {
      for (const room of rooms) {
        const merged = mergeRoom(await this.readRoom(room.id), room);
        await this.writeRoom(merged);
        if (room.lastMessage) await this.putMessage(room.lastMessage);
      }
    });
    this.notifier.touchRooms();
  }

  async applyPreferences(entries: ChatSyncPreference[]): Promise<void> {
    if (entries.length === 0) return;
    await this.transaction(async () => {
      for (const pref of entries) {
        const room = await this.readRoom(pref.roomId);
        if (!room) continue;
        await this.writeRoom(applyPreferenceToRoom(room, pref));
      }
    });
    this.notifier.touchRooms();
  }

  async setRoomPreference(
    roomId: string,
    patch: Partial<Pick<ChatRoom, 'isPinned' | 'isMuted' | 'isArchived'>> & { deletedAt?: string | null },
  ): Promise<void> {
    const room = await this.readRoom(roomId);
    if (!room) return;
    await this.writeRoom({ ...room, ...patch, prefUpdatedAt: new Date().toISOString() });
    this.notifier.touchRooms();
  }

  async listRooms(): Promise<LocalChatRoom[]> {
    const rows = await this.db.getAllAsync<RoomRow>('SELECT * FROM rooms');
    if (rows.length === 0) return [];
    // Newest visible message per room, unread counts and the viewer's peers'
    // read markers come from three grouped queries instead of one per room.
    const lastRows = await this.db.getAllAsync<MessageRow>(
      `SELECT m.* FROM messages m
       JOIN (
         SELECT room_id, MAX(created_at) AS created_at FROM messages
         WHERE hidden = 0 AND deleted_at IS NULL GROUP BY room_id
       ) latest ON latest.room_id = m.room_id AND latest.created_at = m.created_at
       WHERE m.hidden = 0 AND m.deleted_at IS NULL`,
    );
    const lastByRoom = new Map<string, ChatMessage>();
    for (const row of lastRows) {
      const message = JSON.parse(row.payload) as ChatMessage;
      const current = lastByRoom.get(row.room_id);
      if (!current || message.id > current.id) lastByRoom.set(row.room_id, message);
    }
    // Timestamps (not just counts) of unread incoming rows: the effective
    // unread number also depends on the server baseline anchor per room.
    const unreadRows = await this.db.getAllAsync<{ room_id: string; created_at: string }>(
      `SELECT m.room_id AS room_id, m.created_at AS created_at FROM messages m
       LEFT JOIN read_states rs ON rs.room_id = m.room_id AND rs.user_id = ?
       WHERE m.hidden = 0 AND m.deleted_at IS NULL AND m.sender_id != ?
         AND (rs.last_read_at IS NULL OR m.created_at > rs.last_read_at)`,
      [this.accountId, this.accountId],
    );
    const unreadAtsByRoom = new Map<string, string[]>();
    for (const r of unreadRows) {
      const list = unreadAtsByRoom.get(r.room_id) ?? [];
      list.push(r.created_at);
      unreadAtsByRoom.set(r.room_id, list);
    }
    const readRows = await this.db.getAllAsync<{ room_id: string; user_id: string; last_read_message_id: string | null; last_read_at: string }>(
      'SELECT * FROM read_states',
    );
    const peerReadsByRoom = new Map<string, ReadStateRow[]>();
    const myReadByRoom = new Map<string, ReadStateRow>();
    for (const r of readRows) {
      const state = { roomId: r.room_id, userId: r.user_id, lastReadMessageId: r.last_read_message_id, lastReadAt: r.last_read_at };
      if (r.user_id === this.accountId) {
        myReadByRoom.set(r.room_id, state);
        continue;
      }
      const list = peerReadsByRoom.get(r.room_id) ?? [];
      list.push(state);
      peerReadsByRoom.set(r.room_id, list);
    }
    const lastIds = [...lastByRoom.values()].map((m) => m.id);
    const receipts = await this.receiptsFor(lastIds);
    const rooms = rows.map((row) => {
      const room = rowToRoom(row);
      return toLocalRoom(
        room,
        this.accountId,
        lastByRoom.get(room.id),
        resolveUnread(room, myReadByRoom.get(room.id) ?? null, unreadAtsByRoom.get(room.id) ?? []),
        receipts,
        peerReadsByRoom.get(room.id) ?? [],
      );
    });
    return rooms.sort(compareRooms);
  }

  async getRoom(roomId: string): Promise<LocalChatRoom | null> {
    const room = await this.readRoom(roomId);
    if (!room) return null;
    const [last] = await this.listMessages(roomId, { limit: 1 });
    const unreadRows = await this.db.getAllAsync<{ created_at: string }>(
      `SELECT m.created_at AS created_at FROM messages m
       LEFT JOIN read_states rs ON rs.room_id = m.room_id AND rs.user_id = ?
       WHERE m.room_id = ? AND m.hidden = 0 AND m.deleted_at IS NULL AND m.sender_id != ?
         AND (rs.last_read_at IS NULL OR m.created_at > rs.last_read_at)`,
      [this.accountId, roomId, this.accountId],
    );
    const myRead = await this.db.getFirstAsync<{ room_id: string; user_id: string; last_read_message_id: string | null; last_read_at: string }>(
      'SELECT * FROM read_states WHERE room_id = ? AND user_id = ?',
      [roomId, this.accountId],
    );
    const lastLive = last && !last.deletedAt ? last : (await this.db.getFirstAsync<MessageRow>(
      'SELECT * FROM messages WHERE room_id = ? AND hidden = 0 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1',
      [roomId],
    ).then((r) => (r ? (JSON.parse(r.payload) as ChatMessage) : undefined)));
    return toLocalRoom(
      room,
      this.accountId,
      lastLive ?? undefined,
      resolveUnread(
        room,
        myRead
          ? { roomId: myRead.room_id, userId: myRead.user_id, lastReadMessageId: myRead.last_read_message_id, lastReadAt: myRead.last_read_at }
          : null,
        unreadRows.map((r) => r.created_at),
      ),
      lastLive ? await this.receiptsFor([lastLive.id]) : [],
      await this.peerReadStates(roomId),
    );
  }

  async hasRoom(roomId: string): Promise<boolean> {
    const row = await this.db.getFirstAsync<{ id: string }>('SELECT id FROM rooms WHERE id = ?', [roomId]);
    return !!row;
  }

  // ── Messages ─────────────────────────────────────────────────────────────
  private async putMessage(message: ChatMessage): Promise<boolean> {
    const existing = await this.db.getFirstAsync<MessageRow>('SELECT * FROM messages WHERE id = ?', [message.id]);
    const existingPayload = existing ? (JSON.parse(existing.payload) as ChatMessage) : null;
    if (!shouldReplaceMessage(existingPayload, message)) return false;
    const acked = existing ? existing.acked : message.senderId === this.accountId ? 1 : 0;
    await this.db.runAsync(
      `INSERT OR REPLACE INTO messages
       (id, room_id, sender_id, created_at, updated_at, deleted_at, hidden, acked, client_request_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.roomId,
        message.senderId,
        message.createdAt,
        message.updatedAt ?? message.createdAt,
        message.deletedAt ?? null,
        existing?.hidden ?? 0,
        acked,
        message.clientRequestId ?? null,
        JSON.stringify(message),
      ],
    );
    return true;
  }

  async upsertMessages(messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const touched = new Set<string>();
    await this.transaction(async () => {
      for (const message of messages) {
        if (await this.putMessage(message)) touched.add(message.roomId);
      }
    });
    if (touched.size) this.notifier.touchMessages(touched);
  }

  async applyHidden(entries: ChatSyncHidden[]): Promise<void> {
    await this.hideMessages(entries.map((e) => e.messageId));
  }

  async hideMessages(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    const touched = new Set<string>();
    await this.transaction(async () => {
      for (const id of messageIds) {
        const row = await this.db.getFirstAsync<{ room_id: string; hidden: number }>(
          'SELECT room_id, hidden FROM messages WHERE id = ?',
          [id],
        );
        if (!row || row.hidden) continue;
        await this.db.runAsync('UPDATE messages SET hidden = 1 WHERE id = ?', [id]);
        touched.add(row.room_id);
      }
    });
    if (touched.size) this.notifier.touchMessages(touched);
  }

  async tombstoneMessages(messageIds: string[], deletedAt: string): Promise<void> {
    if (messageIds.length === 0) return;
    const touched = new Set<string>();
    await this.transaction(async () => {
      for (const id of messageIds) {
        const row = await this.db.getFirstAsync<MessageRow>('SELECT * FROM messages WHERE id = ?', [id]);
        if (!row) continue;
        const payload = JSON.parse(row.payload) as ChatMessage;
        if (payload.deletedAt) continue;
        const tomb: ChatMessage = {
          ...payload,
          deletedAt,
          updatedAt: deletedAt,
          body: '',
          objectPath: undefined,
          mimeType: undefined,
          sizeBytes: undefined,
          durationMs: undefined,
          replyTo: undefined,
        };
        await this.db.runAsync('UPDATE messages SET deleted_at = ?, updated_at = ?, payload = ? WHERE id = ?', [
          deletedAt,
          deletedAt,
          JSON.stringify(tomb),
          id,
        ]);
        touched.add(row.room_id);
      }
    });
    if (touched.size) this.notifier.touchMessages(touched);
  }

  async listMessages(roomId: string, options: ListMessagesOptions): Promise<LocalChatMessage[]> {
    const rows = options.before
      ? await this.db.getAllAsync<MessageRow>(
          'SELECT * FROM messages WHERE room_id = ? AND hidden = 0 AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT ?',
          [roomId, options.before, options.limit],
        )
      : await this.db.getAllAsync<MessageRow>(
          'SELECT * FROM messages WHERE room_id = ? AND hidden = 0 ORDER BY created_at DESC, id DESC LIMIT ?',
          [roomId, options.limit],
        );
    const messages = rows.map((row) => JSON.parse(row.payload) as ChatMessage);
    const ownIds = messages.filter((m) => m.senderId === this.accountId).map((m) => m.id);
    const receipts = await this.receiptsFor(ownIds);
    const peerReads = await this.peerReadStates(roomId);
    const media = await this.getMediaMany(messages.map((m) => m.id));
    return messages.map((m) => withLocalMedia(decorateMessage(m, this.accountId, receipts, peerReads), media.get(m.id)));
  }

  async getMessage(messageId: string): Promise<LocalChatMessage | null> {
    const row = await this.db.getFirstAsync<MessageRow>('SELECT * FROM messages WHERE id = ? AND hidden = 0', [messageId]);
    if (!row) return null;
    const message = JSON.parse(row.payload) as ChatMessage;
    return withLocalMedia(
      decorateMessage(message, this.accountId, await this.receiptsFor([messageId]), await this.peerReadStates(row.room_id)),
      await this.getMedia(messageId),
    );
  }

  async countMessages(roomId: string): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM messages WHERE room_id = ? AND hidden = 0',
      [roomId],
    );
    return Number(row?.n ?? 0);
  }

  async oldestMessageAt(roomId: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ oldest: string | null }>(
      'SELECT MIN(created_at) AS oldest FROM messages WHERE room_id = ?',
      [roomId],
    );
    return row?.oldest ?? null;
  }

  // ── Read / delivery state ────────────────────────────────────────────────
  async applyReadStates(entries: ChatSyncReadState[]): Promise<void> {
    if (entries.length === 0) return;
    const touched = new Set<string>();
    await this.transaction(async () => {
      for (const entry of entries) {
        const existing = await this.db.getFirstAsync<{ last_read_at: string }>(
          'SELECT last_read_at FROM read_states WHERE room_id = ? AND user_id = ?',
          [entry.roomId, entry.userId],
        );
        if (existing && existing.last_read_at >= entry.lastReadAt) continue;
        await this.db.runAsync(
          'INSERT OR REPLACE INTO read_states (room_id, user_id, last_read_message_id, last_read_at) VALUES (?, ?, ?, ?)',
          [entry.roomId, entry.userId, entry.lastReadMessageId, entry.lastReadAt],
        );
        touched.add(entry.roomId);
      }
    });
    if (touched.size) this.notifier.touchMessages(touched);
  }

  async applyReceipts(entries: ChatSyncReceipt[]): Promise<void> {
    if (entries.length === 0) return;
    const touched = new Set<string>();
    await this.transaction(async () => {
      for (const entry of entries) {
        const existing = await this.db.getFirstAsync<{ updated_at: string }>(
          'SELECT updated_at FROM receipts WHERE message_id = ? AND user_id = ?',
          [entry.messageId, entry.userId],
        );
        if (existing && existing.updated_at >= entry.updatedAt) continue;
        await this.db.runAsync(
          `INSERT OR REPLACE INTO receipts (message_id, user_id, room_id, delivered_at, stored_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [entry.messageId, entry.userId, entry.roomId, entry.deliveredAt, entry.storedAt, entry.updatedAt],
        );
        touched.add(entry.roomId);
      }
    });
    if (touched.size) this.notifier.touchMessages(touched);
  }

  async getReadState(roomId: string, userId: string): Promise<ReadStateRow | null> {
    const row = await this.db.getFirstAsync<{ room_id: string; user_id: string; last_read_message_id: string | null; last_read_at: string }>(
      'SELECT * FROM read_states WHERE room_id = ? AND user_id = ?',
      [roomId, userId],
    );
    return row
      ? { roomId: row.room_id, userId: row.user_id, lastReadMessageId: row.last_read_message_id, lastReadAt: row.last_read_at }
      : null;
  }

  private async peerReadStates(roomId: string): Promise<ReadStateRow[]> {
    const rows = await this.db.getAllAsync<{ room_id: string; user_id: string; last_read_message_id: string | null; last_read_at: string }>(
      'SELECT * FROM read_states WHERE room_id = ? AND user_id != ?',
      [roomId, this.accountId],
    );
    return rows.map((r) => ({ roomId: r.room_id, userId: r.user_id, lastReadMessageId: r.last_read_message_id, lastReadAt: r.last_read_at }));
  }

  private async receiptsFor(messageIds: string[]): Promise<ReceiptRow[]> {
    if (messageIds.length === 0) return [];
    const out: ReceiptRow[] = [];
    // SQLite caps bound parameters; chunk the IN list.
    for (let i = 0; i < messageIds.length; i += 200) {
      const chunk = messageIds.slice(i, i + 200);
      const rows = await this.db.getAllAsync<{ message_id: string; user_id: string; room_id: string; delivered_at: string; stored_at: string | null; updated_at: string }>(
        `SELECT * FROM receipts WHERE message_id IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      );
      for (const r of rows) {
        out.push({ messageId: r.message_id, userId: r.user_id, roomId: r.room_id, deliveredAt: r.delivered_at, storedAt: r.stored_at, updatedAt: r.updated_at });
      }
    }
    return out;
  }

  // ── Delivered acknowledgements ───────────────────────────────────────────
  async pendingDeliveredAcks(limit: number): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ id: string }>(
      'SELECT id FROM messages WHERE acked = 0 AND sender_id != ? ORDER BY created_at ASC LIMIT ?',
      [this.accountId, limit],
    );
    return rows.map((r) => r.id);
  }

  async markAcknowledged(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.transaction(async () => {
      for (let i = 0; i < messageIds.length; i += 200) {
        const chunk = messageIds.slice(i, i + 200);
        await this.db.runAsync(`UPDATE messages SET acked = 1 WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
      }
    });
  }

  // ── Media index ──────────────────────────────────────────────────────────
  async putMedia(row: MediaIndexRow): Promise<void> {
    await this.transaction(async () => {
      await this.db.runAsync(
        'INSERT OR REPLACE INTO media (message_id, room_id, local_path, size_bytes, mime_type, origin, stored_acked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [row.messageId, row.roomId, row.localPath, row.sizeBytes, row.mimeType, row.origin, row.storedAcked ? 1 : 0, row.createdAt],
      );
      // A fresh copy supersedes any pending "lost" report for the message.
      await this.db.runAsync('DELETE FROM media_lost WHERE message_id = ?', [row.messageId]);
    });
    this.notifier.touchMessages(new Set([row.roomId]));
  }

  async getMedia(messageId: string): Promise<MediaIndexRow | null> {
    const row = await this.db.getFirstAsync<MediaRow>('SELECT * FROM media WHERE message_id = ?', [messageId]);
    return row ? rowToMedia(row) : null;
  }

  async getMediaMany(messageIds: string[]): Promise<Map<string, MediaIndexRow>> {
    const out = new Map<string, MediaIndexRow>();
    for (let i = 0; i < messageIds.length; i += 200) {
      const chunk = messageIds.slice(i, i + 200);
      if (chunk.length === 0) break;
      const rows = await this.db.getAllAsync<MediaRow>(
        `SELECT * FROM media WHERE message_id IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      );
      for (const row of rows) out.set(row.message_id, rowToMedia(row));
    }
    return out;
  }

  async rekeyMedia(fromMessageId: string, toMessageId: string): Promise<void> {
    const existing = await this.getMedia(fromMessageId);
    if (!existing) return;
    await this.transaction(async () => {
      await this.db.runAsync('DELETE FROM media WHERE message_id = ?', [toMessageId]);
      await this.db.runAsync('UPDATE media SET message_id = ? WHERE message_id = ?', [toMessageId, fromMessageId]);
    });
    this.notifier.touchMessages(new Set([existing.roomId]));
  }

  async listMedia(roomId?: string): Promise<MediaIndexRow[]> {
    const rows = roomId
      ? await this.db.getAllAsync<MediaRow>('SELECT * FROM media WHERE room_id = ? ORDER BY created_at ASC', [roomId])
      : await this.db.getAllAsync<MediaRow>('SELECT * FROM media ORDER BY created_at ASC');
    return rows.map(rowToMedia);
  }

  async removeMedia(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    const rooms = new Set<string>();
    for (const row of (await this.getMediaMany(messageIds)).values()) rooms.add(row.roomId);
    await this.transaction(async () => {
      for (let i = 0; i < messageIds.length; i += 200) {
        const chunk = messageIds.slice(i, i + 200);
        await this.db.runAsync(`DELETE FROM media WHERE message_id IN (${chunk.map(() => '?').join(',')})`, chunk);
      }
    });
    if (rooms.size) this.notifier.touchMessages(rooms);
  }

  async mediaUsageByRoom(): Promise<RoomMediaUsage[]> {
    const rows = await this.db.getAllAsync<{ room_id: string; bytes: number | null; files: number }>(
      'SELECT room_id, SUM(size_bytes) AS bytes, COUNT(*) AS files FROM media GROUP BY room_id ORDER BY bytes DESC',
    );
    return rows.map((r) => ({ roomId: r.room_id, bytes: Number(r.bytes ?? 0), files: Number(r.files) }));
  }

  async pendingStoredAcks(limit: number): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ message_id: string }>(
      "SELECT message_id FROM media WHERE stored_acked = 0 AND origin = 'received' ORDER BY created_at ASC LIMIT ?",
      [limit],
    );
    return rows.map((r) => r.message_id);
  }

  async markStoredAcknowledged(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.transaction(async () => {
      for (let i = 0; i < messageIds.length; i += 200) {
        const chunk = messageIds.slice(i, i + 200);
        await this.db.runAsync(
          `UPDATE media SET stored_acked = 1 WHERE message_id IN (${chunk.map(() => '?').join(',')})`,
          chunk,
        );
      }
    });
  }

  async listRecoverableMedia(): Promise<RecoverableMedia[]> {
    const rows = await this.db.getAllAsync<MediaRow & { message_payload: string }>(
      `SELECT media.*, messages.payload AS message_payload FROM media
       JOIN messages ON messages.id = media.message_id
       WHERE ${RELAY_AVAILABLE_SQL}
       ORDER BY media.created_at ASC`,
    );
    return rows.map((row) => ({ media: rowToMedia(row), message: JSON.parse(row.message_payload) as ChatMessage }));
  }

  async mediaSummary(): Promise<MediaSummary> {
    // Only-on-device = the message is known and its relay copy is gone. Rows
    // without a message row (queued sends keyed `out-…`) are neither.
    const gone = `(messages.id IS NOT NULL AND NOT (${RELAY_AVAILABLE_SQL}))`;
    const row = await this.db.getFirstAsync<{
      files: number;
      bytes: number | null;
      only_files: number | null;
      only_bytes: number | null;
    }>(
      `SELECT COUNT(*) AS files,
              SUM(media.size_bytes) AS bytes,
              SUM(CASE WHEN ${gone} THEN 1 ELSE 0 END) AS only_files,
              SUM(CASE WHEN ${gone} THEN media.size_bytes ELSE 0 END) AS only_bytes
       FROM media LEFT JOIN messages ON messages.id = media.message_id`,
    );
    return {
      files: Number(row?.files ?? 0),
      bytes: Number(row?.bytes ?? 0),
      onlyOnDeviceFiles: Number(row?.only_files ?? 0),
      onlyOnDeviceBytes: Number(row?.only_bytes ?? 0),
    };
  }

  async queueLostAcks(entries: MediaLostAck[]): Promise<void> {
    if (entries.length === 0) return;
    const createdAt = new Date().toISOString();
    await this.transaction(async () => {
      for (const entry of entries) {
        await this.db.runAsync(
          'INSERT OR IGNORE INTO media_lost (message_id, room_id, created_at) VALUES (?, ?, ?)',
          [entry.messageId, entry.roomId, createdAt],
        );
      }
    });
  }

  async pendingLostAcks(limit: number): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ message_id: string }>(
      'SELECT message_id FROM media_lost ORDER BY created_at ASC, message_id ASC LIMIT ?',
      [limit],
    );
    return rows.map((r) => r.message_id);
  }

  async markLostAcknowledged(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.transaction(async () => {
      for (let i = 0; i < messageIds.length; i += 200) {
        const chunk = messageIds.slice(i, i + 200);
        await this.db.runAsync(`DELETE FROM media_lost WHERE message_id IN (${chunk.map(() => '?').join(',')})`, chunk);
      }
    });
  }

  // ── Outbox ───────────────────────────────────────────────────────────────
  async enqueueOutbox(item: OutboxItem): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO outbox (client_request_id, room_id, created_at, state, payload) VALUES (?, ?, ?, ?, ?)',
      [item.clientRequestId, item.roomId, item.createdAt, item.state, JSON.stringify(item)],
    );
    this.notifier.touchOutbox(item.roomId);
  }

  async updateOutbox(clientRequestId: string, patch: Partial<OutboxItem>): Promise<void> {
    const existing = await this.getOutbox(clientRequestId);
    if (!existing) return;
    const next: OutboxItem = { ...existing, ...patch, clientRequestId };
    await this.db.runAsync('UPDATE outbox SET state = ?, payload = ? WHERE client_request_id = ?', [
      next.state,
      JSON.stringify(next),
      clientRequestId,
    ]);
    this.notifier.touchOutbox(next.roomId);
  }

  async removeOutbox(clientRequestId: string): Promise<void> {
    const existing = await this.getOutbox(clientRequestId);
    if (!existing) return;
    await this.db.runAsync('DELETE FROM outbox WHERE client_request_id = ?', [clientRequestId]);
    this.notifier.touchOutbox(existing.roomId);
  }

  async getOutbox(clientRequestId: string): Promise<OutboxItem | null> {
    const row = await this.db.getFirstAsync<OutboxRow>('SELECT * FROM outbox WHERE client_request_id = ?', [clientRequestId]);
    return row ? (JSON.parse(row.payload) as OutboxItem) : null;
  }

  async listOutbox(roomId?: string): Promise<OutboxItem[]> {
    const rows = roomId
      ? await this.db.getAllAsync<OutboxRow>(
          'SELECT * FROM outbox WHERE room_id = ? ORDER BY created_at ASC, client_request_id ASC',
          [roomId],
        )
      : await this.db.getAllAsync<OutboxRow>('SELECT * FROM outbox ORDER BY created_at ASC, client_request_id ASC');
    return rows.map((r) => JSON.parse(r.payload) as OutboxItem);
  }

  // ── Meta ─────────────────────────────────────────────────────────────────
  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    if (value === null) await this.db.runAsync('DELETE FROM meta WHERE key = ?', [key]);
    else await this.db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  batch<T>(fn: () => Promise<T>): Promise<T> {
    return this.notifier.batch(fn);
  }

  subscribe(listener: StoreListener): () => void {
    return this.notifier.subscribe(listener);
  }

  async wipe(): Promise<void> {
    await this.transaction(async () => {
      for (const table of TABLES) await this.db.runAsync(`DELETE FROM ${table}`);
    });
    this.notifier.touchRooms();
    this.notifier.touchOutbox();
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }
}

function rowToMedia(row: MediaRow): MediaIndexRow {
  return {
    messageId: row.message_id,
    roomId: row.room_id,
    localPath: row.local_path,
    sizeBytes: Number(row.size_bytes),
    mimeType: row.mime_type,
    origin: row.origin === 'sent' ? 'sent' : 'received',
    storedAcked: row.stored_acked === 1,
    createdAt: row.created_at,
  };
}

function withLocalMedia(message: LocalChatMessage, media: MediaIndexRow | null | undefined): LocalChatMessage {
  return media ? { ...message, localMediaPath: media.localPath } : message;
}

function rowToRoom(row: RoomRow): StoredRoom {
  const payload = JSON.parse(row.payload) as ChatRoom;
  return { ...payload, deletedAt: row.deleted_at, prefUpdatedAt: row.pref_updated_at };
}
