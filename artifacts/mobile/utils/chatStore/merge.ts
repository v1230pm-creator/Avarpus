import type { ChatMessage, ChatRoom, ChatSyncPreference } from '@workspace/api-client-react';
import type { ChatDeliveryStatus, LocalChatMessage, LocalChatRoom, ReadStateRow, ReceiptRow } from './types';

/**
 * Merge rules shared by every ChatStore implementation. Keeping them here (pure
 * functions over plain rows) is what guarantees the SQLite and in-memory stores
 * agree, and lets the rules be unit-tested without a database.
 */

const STATUS_RANK: Record<ChatDeliveryStatus, number> = {
  failed: 0,
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  read: 5,
};

export function higherStatus(a: ChatDeliveryStatus, b: ChatDeliveryStatus): ChatDeliveryStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/**
 * Decide whether an incoming server row should replace the stored one.
 * Delta sync orders by `updatedAt`; a stale page (or a `before` backfill page
 * that predates a tombstone) must never overwrite a newer row. Rows without
 * `updatedAt` (legacy/list responses) only replace rows that also lack it, or
 * whose stored copy is not a tombstone.
 */
export function shouldReplaceMessage(existing: ChatMessage | null | undefined, incoming: ChatMessage): boolean {
  if (!existing) return true;
  if (existing.deletedAt && !incoming.deletedAt) return false;
  const a = existing.updatedAt ?? existing.createdAt;
  const b = incoming.updatedAt ?? incoming.createdAt;
  return b >= a;
}

/**
 * Merge a room payload into the stored one. Payloads from the delta sync
 * membership stream carry no inbox fields (unreadCount/lastMessage), and list
 * payloads may be older than a preference we already synced, so preferences
 * only move forward by `updatedAt`.
 */
export type StoredRoom = ChatRoom & {
  deletedAt?: string | null;
  prefUpdatedAt?: string | null;
  /**
   * Server-authoritative unread count captured from a room-list payload, and
   * the createdAt of the newest message at that moment. The device only holds
   * a recent window of history, so unread is counted locally only for
   * messages newer than this anchor (see resolveUnread).
   */
  unreadBaseline?: number;
  unreadAnchorAt?: string;
};

export function mergeRoom(existing: StoredRoom | null | undefined, incoming: ChatRoom): StoredRoom {
  const baseline: Pick<StoredRoom, 'unreadBaseline' | 'unreadAnchorAt'> =
    incoming.unreadCount !== undefined
      ? { unreadBaseline: incoming.unreadCount, unreadAnchorAt: incoming.lastMessage?.createdAt ?? '' }
      : { unreadBaseline: existing?.unreadBaseline, unreadAnchorAt: existing?.unreadAnchorAt };
  if (!existing) return { ...incoming, deletedAt: null, prefUpdatedAt: null, ...baseline };
  const merged = { ...existing, ...incoming, ...baseline } as StoredRoom;
  // Server room payloads never carry a deletedAt: a room we deleted for
  // ourselves stays hidden until a preference entry clears it, EXCEPT when the
  // server lists it again (list endpoints exclude deleted rooms), which means
  // the deletion was cleared server-side.
  merged.deletedAt = existing.deletedAt ?? null;
  merged.prefUpdatedAt = existing.prefUpdatedAt ?? null;
  // Sync membership payloads omit unread/lastMessage; keep what we had.
  if (incoming.unreadCount === undefined) merged.unreadCount = existing.unreadCount;
  if (incoming.lastMessage === undefined) merged.lastMessage = existing.lastMessage;
  if (incoming.lastMessageStatus === undefined) merged.lastMessageStatus = existing.lastMessageStatus;
  return merged;
}

export function applyPreferenceToRoom<T extends StoredRoom>(
  room: T,
  pref: ChatSyncPreference,
): T {
  if (room.prefUpdatedAt && room.prefUpdatedAt > pref.updatedAt) return room;
  return {
    ...room,
    isPinned: pref.isPinned,
    isMuted: pref.isMuted,
    isArchived: pref.isArchived,
    deletedAt: pref.deletedAt,
    prefUpdatedAt: pref.updatedAt,
  };
}

/** True when the row is visible in the viewer's timeline. */
export function isVisibleMessage(row: { hidden?: boolean }): boolean {
  return !row.hidden;
}

/** True when the row counts as unread activity / a room preview. */
export function isLiveMessage(message: ChatMessage & { hidden?: boolean }): boolean {
  return !message.hidden && !message.deletedAt;
}

/**
 * Effective delivery status of one of the viewer's own messages: the highest
 * of the server-reported status, any synced receipt, and any other member's
 * read marker at/after the message time.
 */
export function deriveOwnStatus(
  message: ChatMessage,
  receipts: ReceiptRow[],
  peerReadStates: ReadStateRow[],
): ChatDeliveryStatus {
  let status: ChatDeliveryStatus = message.delivery?.status ?? 'sent';
  if (receipts.some((r) => r.messageId === message.id)) status = higherStatus(status, 'delivered');
  if (peerReadStates.some((s) => s.lastReadAt >= message.createdAt)) status = higherStatus(status, 'read');
  return status;
}

export function decorateMessage(
  message: ChatMessage,
  viewerId: string,
  receipts: ReceiptRow[],
  peerReadStates: ReadStateRow[],
): LocalChatMessage {
  if (message.senderId !== viewerId) return { ...message };
  return { ...message, localStatus: deriveOwnStatus(message, receipts, peerReadStates) };
}

/** createdAt of every unread incoming message given the viewer's read marker. */
export function unreadCreatedAts(
  messages: Array<ChatMessage & { hidden?: boolean }>,
  viewerId: string,
  myReadState: ReadStateRow | null,
): string[] {
  return messages
    .filter(
      (m) =>
        isLiveMessage(m) &&
        m.senderId !== viewerId &&
        (!myReadState || m.createdAt > myReadState.lastReadAt),
    )
    .map((m) => m.createdAt);
}

/**
 * Effective unread count for a room. Local rows are complete only from the
 * server baseline's anchor onwards (everything newer arrived through delta
 * sync), so until the viewer's own read marker reaches that anchor the
 * baseline stands in for the history the device never downloaded.
 */
export function resolveUnread(
  room: Pick<StoredRoom, 'unreadBaseline' | 'unreadAnchorAt'>,
  myReadState: ReadStateRow | null,
  unreadAts: string[],
): number {
  const anchor = room.unreadAnchorAt;
  if (anchor === undefined || room.unreadBaseline === undefined) return unreadAts.length;
  if (myReadState && myReadState.lastReadAt >= anchor) return unreadAts.length;
  return room.unreadBaseline + unreadAts.filter((at) => at > anchor).length;
}

/** Number of unread incoming messages given the viewer's read marker. */
export function countUnread(
  messages: Array<ChatMessage & { hidden?: boolean }>,
  viewerId: string,
  myReadState: ReadStateRow | null,
): number {
  return unreadCreatedAts(messages, viewerId, myReadState).length;
}

export function pickLastMessage(messages: Array<ChatMessage & { hidden?: boolean }>): ChatMessage | undefined {
  let best: ChatMessage | undefined;
  for (const m of messages) {
    if (!isLiveMessage(m)) continue;
    if (!best || m.createdAt > best.createdAt) best = m;
  }
  return best;
}

export function toLocalRoom(
  room: StoredRoom,
  viewerId: string,
  lastMessage: ChatMessage | undefined,
  unreadCount: number,
  receipts: ReceiptRow[],
  peerReadStates: ReadStateRow[],
): LocalChatRoom {
  const { prefUpdatedAt: _drop, unreadBaseline: _b, unreadAnchorAt: _a, ...payload } = room;
  const decorated = lastMessage ? decorateMessage(lastMessage, viewerId, receipts, peerReadStates) : undefined;
  const status = decorated?.localStatus;
  return {
    ...payload,
    deletedAt: room.deletedAt ?? null,
    unreadCount,
    lastMessage: decorated,
    lastMessageStatus:
      status === 'read' || status === 'delivered' || status === 'sent' ? status : status ? 'sent' : undefined,
    lastActivityAt: lastMessage?.createdAt ?? room.createdAt,
  };
}

/** Inbox order: pinned first, then most recent activity. */
export function compareRooms(a: LocalChatRoom, b: LocalChatRoom): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  return b.lastActivityAt.localeCompare(a.lastActivityAt);
}
