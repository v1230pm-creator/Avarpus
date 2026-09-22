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
  isLiveMessage,
  mergeRoom,
  pickLastMessage,
  resolveUnread,
  shouldReplaceMessage,
  toLocalRoom,
  unreadCreatedAts,
  type StoredRoom,
} from './merge';
import { ChangeNotifier } from './notifier';
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
} from './types';

type StoredMessage = { payload: ChatMessage; hidden: boolean; acked: boolean };

/**
 * In-memory ChatStore: the web implementation (no SQLite there) and the Jest
 * backend. Nothing survives a reload, which is acceptable on web where the
 * server remains reachable; on native this is only the fail-closed fallback.
 */
export class MemoryChatStore implements ChatStore {
  readonly kind = 'memory' as const;
  private rooms = new Map<string, StoredRoom>();
  private messages = new Map<string, StoredMessage>();
  private readStates = new Map<string, ReadStateRow>();
  private receipts = new Map<string, ReceiptRow>();
  private outbox = new Map<string, OutboxItem>();
  private media = new Map<string, MediaIndexRow>();
  /** Pending `lost` acks, in the order they were queued. */
  private mediaLost = new Map<string, MediaLostAck>();
  private meta = new Map<string, string>();
  private notifier = new ChangeNotifier();

  constructor(readonly accountId: string) {}

  // ── Rooms ────────────────────────────────────────────────────────────────
  async upsertRooms(rooms: ChatRoom[]): Promise<void> {
    for (const room of rooms) {
      const merged = mergeRoom(this.rooms.get(room.id), room);
      this.rooms.set(room.id, merged);
      // Room summaries carry their newest visible message; keep the preview
      // renderable before the timeline itself has synced.
      if (room.lastMessage) this.putMessage(room.lastMessage);
    }
    this.notifier.touchRooms();
  }

  async applyPreferences(entries: ChatSyncPreference[]): Promise<void> {
    for (const pref of entries) {
      const room = this.rooms.get(pref.roomId);
      if (!room) continue;
      this.rooms.set(pref.roomId, applyPreferenceToRoom(room, pref));
    }
    if (entries.length) this.notifier.touchRooms();
  }

  async setRoomPreference(
    roomId: string,
    patch: Partial<Pick<ChatRoom, 'isPinned' | 'isMuted' | 'isArchived'>> & { deletedAt?: string | null },
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.rooms.set(roomId, { ...room, ...patch, prefUpdatedAt: new Date().toISOString() });
    this.notifier.touchRooms();
  }

  async listRooms(): Promise<LocalChatRoom[]> {
    const byRoom = new Map<string, Array<ChatMessage & { hidden: boolean }>>();
    for (const row of this.messages.values()) {
      const list = byRoom.get(row.payload.roomId) ?? [];
      list.push({ ...row.payload, hidden: row.hidden });
      byRoom.set(row.payload.roomId, list);
    }
    const rooms: LocalChatRoom[] = [];
    for (const room of this.rooms.values()) {
      rooms.push(this.buildLocalRoom(room, byRoom.get(room.id) ?? []));
    }
    return rooms.sort(compareRooms);
  }

  async getRoom(roomId: string): Promise<LocalChatRoom | null> {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const messages = [...this.messages.values()]
      .filter((row) => row.payload.roomId === roomId)
      .map((row) => ({ ...row.payload, hidden: row.hidden }));
    return this.buildLocalRoom(room, messages);
  }

  async hasRoom(roomId: string): Promise<boolean> {
    return this.rooms.has(roomId);
  }

  private buildLocalRoom(room: StoredRoom, messages: Array<ChatMessage & { hidden: boolean }>): LocalChatRoom {
    const last = pickLastMessage(messages);
    const myRead = this.readStates.get(`${room.id}:${this.accountId}`) ?? null;
    const unread = resolveUnread(room, myRead, unreadCreatedAts(messages, this.accountId, myRead));
    return toLocalRoom(room, this.accountId, last, unread, this.receiptsFor(last ? [last.id] : []), this.peerReadStates(room.id));
  }

  // ── Messages ─────────────────────────────────────────────────────────────
  private putMessage(message: ChatMessage): boolean {
    const existing = this.messages.get(message.id);
    if (!shouldReplaceMessage(existing?.payload, message)) return false;
    this.messages.set(message.id, {
      payload: message,
      hidden: existing?.hidden ?? false,
      // Own messages never need a delivered ack; incoming ones do, once.
      acked: existing?.acked ?? message.senderId === this.accountId,
    });
    return true;
  }

  async upsertMessages(messages: ChatMessage[]): Promise<void> {
    const touched = new Set<string>();
    for (const message of messages) {
      if (this.putMessage(message)) touched.add(message.roomId);
    }
    if (touched.size) this.notifier.touchMessages(touched);
  }

  async applyHidden(entries: ChatSyncHidden[]): Promise<void> {
    await this.hideMessages(entries.map((e) => e.messageId));
  }

  async hideMessages(messageIds: string[]): Promise<void> {
    const touched = new Set<string>();
    for (const id of messageIds) {
      const row = this.messages.get(id);
      if (!row || row.hidden) continue;
      row.hidden = true;
      touched.add(row.payload.roomId);
    }
    if (touched.size) this.notifier.touchMessages(touched);
  }

  async tombstoneMessages(messageIds: string[], deletedAt: string): Promise<void> {
    const touched = new Set<string>();
    for (const id of messageIds) {
      const row = this.messages.get(id);
      if (!row || row.payload.deletedAt) continue;
      row.payload = {
        ...row.payload,
        deletedAt,
        updatedAt: deletedAt,
        body: '',
        objectPath: undefined,
        mimeType: undefined,
        sizeBytes: undefined,
        durationMs: undefined,
        replyTo: undefined,
      };
      touched.add(row.payload.roomId);
    }
    if (touched.size) this.notifier.touchMessages(touched);
  }

  async listMessages(roomId: string, options: ListMessagesOptions): Promise<LocalChatMessage[]> {
    const rows = [...this.messages.values()]
      .filter(
        (row) =>
          row.payload.roomId === roomId &&
          !row.hidden &&
          (!options.before || row.payload.createdAt < options.before),
      )
      .map((row) => row.payload)
      .sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)))
      .slice(0, options.limit);
    const peerReads = this.peerReadStates(roomId);
    const receipts = this.receiptsFor(rows.map((r) => r.id));
    return rows.map((row) => this.withLocalMedia(decorateMessage(row, this.accountId, receipts, peerReads)));
  }

  async getMessage(messageId: string): Promise<LocalChatMessage | null> {
    const row = this.messages.get(messageId);
    if (!row || row.hidden) return null;
    return this.withLocalMedia(
      decorateMessage(row.payload, this.accountId, this.receiptsFor([messageId]), this.peerReadStates(row.payload.roomId)),
    );
  }

  private withLocalMedia(message: LocalChatMessage): LocalChatMessage {
    const media = this.media.get(message.id);
    return media ? { ...message, localMediaPath: media.localPath } : message;
  }

  async countMessages(roomId: string): Promise<number> {
    let n = 0;
    for (const row of this.messages.values()) if (row.payload.roomId === roomId && !row.hidden) n += 1;
    return n;
  }

  async oldestMessageAt(roomId: string): Promise<string | null> {
    let oldest: string | null = null;
    for (const row of this.messages.values()) {
      if (row.payload.roomId !== roomId) continue;
      if (oldest === null || row.payload.createdAt < oldest) oldest = row.payload.createdAt;
    }
    return oldest;
  }

  // ── Read / delivery state ────────────────────────────────────────────────
  async applyReadStates(entries: ChatSyncReadState[]): Promise<void> {
    const touched = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.roomId}:${entry.userId}`;
      const existing = this.readStates.get(key);
      if (existing && existing.lastReadAt >= entry.lastReadAt) continue;
      this.readStates.set(key, {
        roomId: entry.roomId,
        userId: entry.userId,
        lastReadMessageId: entry.lastReadMessageId,
        lastReadAt: entry.lastReadAt,
      });
      touched.add(entry.roomId);
    }
    if (touched.size) this.notifier.touchMessages(touched);
  }

  async applyReceipts(entries: ChatSyncReceipt[]): Promise<void> {
    const touched = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.messageId}:${entry.userId}`;
      const existing = this.receipts.get(key);
      if (existing && existing.updatedAt >= entry.updatedAt) continue;
      this.receipts.set(key, { ...entry });
      touched.add(entry.roomId);
    }
    if (touched.size) this.notifier.touchMessages(touched);
  }

  async getReadState(roomId: string, userId: string): Promise<ReadStateRow | null> {
    return this.readStates.get(`${roomId}:${userId}`) ?? null;
  }

  private peerReadStates(roomId: string): ReadStateRow[] {
    return [...this.readStates.values()].filter((s) => s.roomId === roomId && s.userId !== this.accountId);
  }

  private receiptsFor(messageIds: string[]): ReceiptRow[] {
    if (messageIds.length === 0) return [];
    const wanted = new Set(messageIds);
    return [...this.receipts.values()].filter((r) => wanted.has(r.messageId));
  }

  // ── Delivered acknowledgements ───────────────────────────────────────────
  async pendingDeliveredAcks(limit: number): Promise<string[]> {
    const ids: string[] = [];
    for (const row of this.messages.values()) {
      if (row.acked || row.payload.senderId === this.accountId) continue;
      ids.push(row.payload.id);
      if (ids.length >= limit) break;
    }
    return ids;
  }

  async markAcknowledged(messageIds: string[]): Promise<void> {
    for (const id of messageIds) {
      const row = this.messages.get(id);
      if (row) row.acked = true;
    }
  }

  // ── Media index ──────────────────────────────────────────────────────────
  async putMedia(row: MediaIndexRow): Promise<void> {
    this.media.set(row.messageId, { ...row });
    // A fresh copy supersedes any pending "lost" report for the message.
    this.mediaLost.delete(row.messageId);
    this.notifier.touchMessages([row.roomId]);
  }

  async getMedia(messageId: string): Promise<MediaIndexRow | null> {
    const row = this.media.get(messageId);
    return row ? { ...row } : null;
  }

  async getMediaMany(messageIds: string[]): Promise<Map<string, MediaIndexRow>> {
    const out = new Map<string, MediaIndexRow>();
    for (const id of messageIds) {
      const row = this.media.get(id);
      if (row) out.set(id, { ...row });
    }
    return out;
  }

  async rekeyMedia(fromMessageId: string, toMessageId: string): Promise<void> {
    const row = this.media.get(fromMessageId);
    if (!row) return;
    this.media.delete(fromMessageId);
    this.media.set(toMessageId, { ...row, messageId: toMessageId });
    this.notifier.touchMessages([row.roomId]);
  }

  async listMedia(roomId?: string): Promise<MediaIndexRow[]> {
    return [...this.media.values()]
      .filter((row) => !roomId || row.roomId === roomId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((row) => ({ ...row }));
  }

  async removeMedia(messageIds: string[]): Promise<void> {
    const rooms = new Set<string>();
    for (const id of messageIds) {
      const row = this.media.get(id);
      if (!row) continue;
      rooms.add(row.roomId);
      this.media.delete(id);
    }
    if (rooms.size) this.notifier.touchMessages(rooms);
  }

  async mediaUsageByRoom(): Promise<RoomMediaUsage[]> {
    const usage = new Map<string, RoomMediaUsage>();
    for (const row of this.media.values()) {
      const entry = usage.get(row.roomId) ?? { roomId: row.roomId, bytes: 0, files: 0 };
      entry.bytes += row.sizeBytes;
      entry.files += 1;
      usage.set(row.roomId, entry);
    }
    return [...usage.values()].sort((a, b) => b.bytes - a.bytes);
  }

  async pendingStoredAcks(limit: number): Promise<string[]> {
    return [...this.media.values()]
      .filter((row) => row.origin === 'received' && !row.storedAcked)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map((row) => row.messageId);
  }

  async markStoredAcknowledged(messageIds: string[]): Promise<void> {
    for (const id of messageIds) {
      const row = this.media.get(id);
      if (row) row.storedAcked = true;
    }
  }

  /** Mirrors RELAY_AVAILABLE_SQL in the SQLite store. */
  private relayAvailableFor(messageId: string): boolean | null {
    const stored = this.messages.get(messageId);
    if (!stored) return null;
    const { deletedAt, mediaState } = stored.payload;
    if (deletedAt) return false;
    return mediaState !== 'purged' && mediaState !== 'expired';
  }

  async listRecoverableMedia(): Promise<RecoverableMedia[]> {
    return [...this.media.values()]
      .filter((row) => this.relayAvailableFor(row.messageId) === true)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((row) => ({ media: { ...row }, message: { ...this.messages.get(row.messageId)!.payload } }));
  }

  async mediaSummary(): Promise<MediaSummary> {
    const summary: MediaSummary = { files: 0, bytes: 0, onlyOnDeviceFiles: 0, onlyOnDeviceBytes: 0 };
    for (const row of this.media.values()) {
      summary.files += 1;
      summary.bytes += row.sizeBytes;
      if (this.relayAvailableFor(row.messageId) === false) {
        summary.onlyOnDeviceFiles += 1;
        summary.onlyOnDeviceBytes += row.sizeBytes;
      }
    }
    return summary;
  }

  async queueLostAcks(entries: MediaLostAck[]): Promise<void> {
    for (const entry of entries) {
      if (!this.mediaLost.has(entry.messageId)) this.mediaLost.set(entry.messageId, { ...entry });
    }
  }

  async pendingLostAcks(limit: number): Promise<string[]> {
    return [...this.mediaLost.keys()].slice(0, limit);
  }

  async markLostAcknowledged(messageIds: string[]): Promise<void> {
    for (const id of messageIds) this.mediaLost.delete(id);
  }

  // ── Outbox ───────────────────────────────────────────────────────────────
  async enqueueOutbox(item: OutboxItem): Promise<void> {
    this.outbox.set(item.clientRequestId, { ...item });
    this.notifier.touchOutbox(item.roomId);
  }

  async updateOutbox(clientRequestId: string, patch: Partial<OutboxItem>): Promise<void> {
    const existing = this.outbox.get(clientRequestId);
    if (!existing) return;
    const next = { ...existing, ...patch, clientRequestId };
    this.outbox.set(clientRequestId, next);
    this.notifier.touchOutbox(next.roomId);
  }

  async removeOutbox(clientRequestId: string): Promise<void> {
    const existing = this.outbox.get(clientRequestId);
    if (!existing) return;
    this.outbox.delete(clientRequestId);
    this.notifier.touchOutbox(existing.roomId);
  }

  async getOutbox(clientRequestId: string): Promise<OutboxItem | null> {
    const item = this.outbox.get(clientRequestId);
    return item ? { ...item } : null;
  }

  async listOutbox(roomId?: string): Promise<OutboxItem[]> {
    return [...this.outbox.values()]
      .filter((item) => !roomId || item.roomId === roomId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.clientRequestId.localeCompare(b.clientRequestId))
      .map((item) => ({ ...item }));
  }

  // ── Meta ─────────────────────────────────────────────────────────────────
  async getMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    if (value === null) this.meta.delete(key);
    else this.meta.set(key, value);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  batch<T>(fn: () => Promise<T>): Promise<T> {
    return this.notifier.batch(fn);
  }

  subscribe(listener: Parameters<ChangeNotifier['subscribe']>[0]): () => void {
    return this.notifier.subscribe(listener);
  }

  async wipe(): Promise<void> {
    this.rooms.clear();
    this.messages.clear();
    this.readStates.clear();
    this.receipts.clear();
    this.outbox.clear();
    this.media.clear();
    this.mediaLost.clear();
    this.meta.clear();
    this.notifier.touchRooms();
    this.notifier.touchOutbox();
  }

  async close(): Promise<void> {
    await this.wipe();
  }

  /** Test helper: visible message payloads for a room, newest first. */
  debugMessages(roomId: string): ChatMessage[] {
    return [...this.messages.values()]
      .filter((row) => row.payload.roomId === roomId && isLiveMessage({ ...row.payload, hidden: row.hidden }))
      .map((row) => row.payload)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
