/**
 * Local-first chat store: merge rules, sync engine and outbox ordering.
 *
 * Everything runs against the in-memory store implementation (the SQLite one
 * shares the same merge helpers) with the API scripted at the client boundary.
 */
import { ApiError } from '@workspace/api-client-react';
import type { ChatMessage, ChatRoom, ChatSyncResult } from '@workspace/api-client-react';
import { MemoryChatStore, META_KEYS } from '@/utils/chatStore';
import { ChatSyncEngine, HISTORY_PAGE, type ChatSyncApi } from '@/utils/chatSync';
import {
  ChatOutboxFlusher,
  backoffMs,
  makeTextOutboxItem,
  outboxToMessage,
  type ChatOutboxApi,
} from '@/utils/chatOutbox';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

const ME = 'user-me';
const PEER = 'user-peer';

function apiError(status: number, data: unknown = null): ApiError {
  return Object.assign(Object.create(ApiError.prototype) as ApiError, {
    status,
    data,
    message: `HTTP ${status}`,
    name: 'ApiError',
  });
}

function room(id: string, extra: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id,
    shopId: null,
    scope: 'global_direct',
    kind: 'direct',
    name: `Room ${id}`,
    isArchived: false,
    isPinned: false,
    isMuted: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  } as ChatRoom;
}

let seq = 0;
function message(
  roomId: string,
  senderId: string,
  createdAt: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  seq += 1;
  return {
    id: extra.id ?? `m-${seq}`,
    roomId,
    shopId: null,
    senderId,
    senderName: senderId === ME ? 'Me' : 'Peer',
    kind: 'text',
    body: `body ${seq}`,
    createdAt,
    ...extra,
  };
}

function syncPage(partial: Partial<ChatSyncResult> = {}): ChatSyncResult {
  return {
    messages: [],
    hidden: [],
    readStates: [],
    receipts: [],
    preferences: [],
    rooms: [],
    nextCursor: partial.nextCursor ?? 'cursor-1',
    hasMore: false,
    syncedAt: '2026-09-21T00:00:00.000Z',
    ...partial,
  };
}

function scriptedApi(overrides: Partial<ChatSyncApi> = {}): ChatSyncApi & { calls: string[] } {
  const calls: string[] = [];
  const api: ChatSyncApi & { calls: string[] } = {
    calls,
    roomsList: async () => {
      calls.push('roomsList');
      return { rooms: [] };
    },
    archivedRoomsList: async () => {
      calls.push('archivedRoomsList');
      return { rooms: [] };
    },
    roomGet: async (roomId) => {
      calls.push(`roomGet:${roomId}`);
      return { room: room(roomId) };
    },
    sync: async (params) => {
      calls.push(`sync:${params.cursor ?? 'none'}`);
      return syncPage();
    },
    acknowledge: async (input) => {
      calls.push(`ack:${input.acks.map((a) => a.messageId).join(',')}`);
      return { acknowledged: input.acks.map((a) => a.messageId), ignored: [] };
    },
    messagesList: async (roomId, params) => {
      calls.push(`messages:${roomId}:${params.before ?? 'none'}`);
      return { messages: [], hasMore: false };
    },
    ...overrides,
  };
  return api;
}

describe('MemoryChatStore merge rules', () => {
  it('keeps the newest row and never resurrects a tombstone', async () => {
    const store = new MemoryChatStore(ME);
    await store.upsertRooms([room('r1')]);
    const original = message('r1', PEER, '2026-09-10T10:00:00.000Z', {
      id: 'm-a',
      body: 'hello',
      updatedAt: '2026-09-10T10:00:00.000Z',
    });
    await store.upsertMessages([original]);
    await store.upsertMessages([
      { ...original, deletedAt: '2026-09-10T11:00:00.000Z', body: '', updatedAt: '2026-09-10T11:00:00.000Z' },
    ]);
    // A stale page (older updatedAt, still has a body) must not win.
    await store.upsertMessages([original]);
    const [row] = await store.listMessages('r1', { limit: 10 });
    expect(row.deletedAt).toBe('2026-09-10T11:00:00.000Z');
    expect(row.body).toBe('');
  });

  it('derives unread count and preview from local rows for the viewer', async () => {
    const store = new MemoryChatStore(ME);
    await store.upsertRooms([room('r1'), room('r2')]);
    await store.upsertMessages([
      message('r1', PEER, '2026-09-10T10:00:00.000Z'),
      message('r1', PEER, '2026-09-10T10:05:00.000Z', { body: 'latest' }),
      message('r1', ME, '2026-09-10T10:06:00.000Z', { body: 'mine' }),
      message('r2', PEER, '2026-09-09T10:00:00.000Z'),
    ]);
    await store.applyReadStates([
      { roomId: 'r1', userId: ME, lastReadMessageId: null, lastReadAt: '2026-09-10T10:01:00.000Z' },
    ]);
    const rooms = await store.listRooms();
    const r1 = rooms.find((r) => r.id === 'r1')!;
    const r2 = rooms.find((r) => r.id === 'r2')!;
    expect(r1.unreadCount).toBe(1); // only the 10:05 incoming message is after my marker
    expect(r1.lastMessage?.body).toBe('mine');
    expect(r2.unreadCount).toBe(1);
    // Most recent activity first.
    expect(rooms.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('keeps the server unread baseline for history the device never downloaded', async () => {
    const store = new MemoryChatStore(ME);
    // Room-list payloads carry the authoritative count and the newest message
    // at that moment; the sync window only covers recent days.
    const oldPreview = message('dormant', PEER, '2026-06-01T09:00:00.000Z', { body: 'old' });
    const backlogPreview = message('backlog', PEER, '2026-06-02T09:00:00.000Z', { body: 'fifth' });
    await store.upsertRooms([
      room('dormant', { unreadCount: 0, lastMessage: oldPreview }),
      room('backlog', { unreadCount: 5, lastMessage: backlogPreview }),
      room('empty', { unreadCount: 0 }),
    ]);
    await store.upsertMessages([oldPreview, backlogPreview]);
    let rooms = await store.listRooms();
    // A fully-read dormant room stays read even though no read marker was synced.
    expect(rooms.find((r) => r.id === 'dormant')?.unreadCount).toBe(0);
    // Five old unread messages count as five although only the preview row is local.
    expect(rooms.find((r) => r.id === 'backlog')?.unreadCount).toBe(5);
    expect(rooms.find((r) => r.id === 'empty')?.unreadCount).toBe(0);

    // New messages after the anchor add to the baseline...
    await store.upsertMessages([
      message('backlog', PEER, '2026-09-21T10:00:00.000Z'),
      message('empty', PEER, '2026-09-21T10:00:00.000Z'),
    ]);
    rooms = await store.listRooms();
    expect(rooms.find((r) => r.id === 'backlog')?.unreadCount).toBe(6);
    expect(rooms.find((r) => r.id === 'empty')?.unreadCount).toBe(1);

    // ...an old read marker (older than the anchor) changes nothing...
    await store.applyReadStates([
      { roomId: 'backlog', userId: ME, lastReadMessageId: null, lastReadAt: '2026-05-01T00:00:00.000Z' },
    ]);
    expect((await store.getRoom('backlog'))?.unreadCount).toBe(6);

    // ...and once the viewer reads past the anchor, local rows are authoritative.
    await store.applyReadStates([
      { roomId: 'backlog', userId: ME, lastReadMessageId: null, lastReadAt: '2026-09-21T10:00:00.000Z' },
    ]);
    expect((await store.getRoom('backlog'))?.unreadCount).toBe(0);
    await store.upsertMessages([message('backlog', PEER, '2026-09-21T10:01:00.000Z')]);
    expect((await store.getRoom('backlog'))?.unreadCount).toBe(1);

    // A fresh list payload re-anchors the baseline.
    await store.upsertRooms([room('backlog', { unreadCount: 0, lastMessage: message('backlog', PEER, '2026-09-21T10:02:00.000Z') })]);
    expect((await store.getRoom('backlog'))?.unreadCount).toBe(0);
  });

  it('hides "deleted for me" rows and honours preference ordering by updatedAt', async () => {
    const store = new MemoryChatStore(ME);
    await store.upsertRooms([room('r1'), room('r2')]);
    const gone = message('r1', PEER, '2026-09-10T10:00:00.000Z', { id: 'gone' });
    await store.upsertMessages([gone, message('r1', PEER, '2026-09-10T10:01:00.000Z')]);
    await store.applyHidden([{ messageId: 'gone', roomId: 'r1', hiddenAt: '2026-09-10T12:00:00.000Z' }]);
    expect((await store.listMessages('r1', { limit: 10 })).map((m) => m.id)).not.toContain('gone');
    expect(await store.countMessages('r1')).toBe(1);

    await store.applyPreferences([
      { roomId: 'r2', isPinned: true, isMuted: false, isArchived: false, deletedAt: null, updatedAt: '2026-09-11T00:00:00.000Z' },
    ]);
    // An older preference must not undo the newer pin.
    await store.applyPreferences([
      { roomId: 'r2', isPinned: false, isMuted: false, isArchived: false, deletedAt: null, updatedAt: '2026-09-10T00:00:00.000Z' },
    ]);
    const rooms = await store.listRooms();
    expect(rooms[0].id).toBe('r2');
    expect(rooms[0].isPinned).toBe(true);
    await store.setRoomPreference('r2', { deletedAt: '2026-09-12T00:00:00.000Z' });
    expect((await store.listRooms()).find((r) => r.id === 'r2')?.deletedAt).toBe('2026-09-12T00:00:00.000Z');
  });

  it('raises own-message status from receipts and peer read markers', async () => {
    const store = new MemoryChatStore(ME);
    await store.upsertRooms([room('r1')]);
    const mine = message('r1', ME, '2026-09-10T10:00:00.000Z', { id: 'mine' });
    const later = message('r1', ME, '2026-09-10T10:10:00.000Z', { id: 'later' });
    await store.upsertMessages([mine, later]);
    let rows = await store.listMessages('r1', { limit: 10 });
    expect(rows.find((m) => m.id === 'mine')?.localStatus).toBe('sent');

    await store.applyReceipts([
      {
        messageId: 'later',
        roomId: 'r1',
        userId: PEER,
        deliveredAt: '2026-09-10T10:11:00.000Z',
        storedAt: null,
        updatedAt: '2026-09-10T10:11:00.000Z',
      },
    ]);
    await store.applyReadStates([
      { roomId: 'r1', userId: PEER, lastReadMessageId: 'mine', lastReadAt: '2026-09-10T10:05:00.000Z' },
    ]);
    rows = await store.listMessages('r1', { limit: 10 });
    expect(rows.find((m) => m.id === 'mine')?.localStatus).toBe('read');
    expect(rows.find((m) => m.id === 'later')?.localStatus).toBe('delivered');
  });

  it('only queues delivered acks for incoming messages, once', async () => {
    const store = new MemoryChatStore(ME);
    await store.upsertRooms([room('r1')]);
    await store.upsertMessages([
      message('r1', PEER, '2026-09-10T10:00:00.000Z', { id: 'in-1' }),
      message('r1', ME, '2026-09-10T10:01:00.000Z', { id: 'own-1' }),
    ]);
    expect(await store.pendingDeliveredAcks(10)).toEqual(['in-1']);
    await store.markAcknowledged(['in-1']);
    expect(await store.pendingDeliveredAcks(10)).toEqual([]);
    // Re-serving the same row through a later delta must not re-ack it.
    await store.upsertMessages([message('r1', PEER, '2026-09-10T10:00:00.000Z', { id: 'in-1', updatedAt: '2026-09-10T10:30:00.000Z' })]);
    expect(await store.pendingDeliveredAcks(10)).toEqual([]);
  });

  it('wipe removes every table and the store reports changes to subscribers', async () => {
    const store = new MemoryChatStore(ME);
    const seen: string[] = [];
    const off = store.subscribe((change) => {
      seen.push(`${change.rooms ? 'R' : ''}${change.outbox ? 'O' : ''}${[...change.roomIds].join('')}`);
    });
    await store.upsertRooms([room('r1')]);
    await store.upsertMessages([message('r1', PEER, '2026-09-10T10:00:00.000Z')]);
    await store.enqueueOutbox(makeTextOutboxItem({ clientRequestId: 'c1', roomId: 'r1', body: 'x' }));
    off();
    expect(seen.some((s) => s.includes('R'))).toBe(true);
    expect(seen.some((s) => s.includes('r1'))).toBe(true);
    expect(seen.some((s) => s.includes('O'))).toBe(true);
    await store.setMeta(META_KEYS.SYNC_CURSOR, 'abc');
    await store.wipe();
    expect(await store.listRooms()).toEqual([]);
    expect(await store.listOutbox()).toEqual([]);
    expect(await store.getMeta(META_KEYS.SYNC_CURSOR)).toBeNull();
  });
});

describe('ChatSyncEngine', () => {
  it('bootstraps rooms, drains delta pages, stores the cursor and acks delivered messages', async () => {
    const store = new MemoryChatStore(ME);
    const pages: Record<string, ChatSyncResult> = {
      none: syncPage({
        messages: [message('r1', PEER, '2026-09-20T10:00:00.000Z', { id: 'in-1' })],
        nextCursor: 'c1',
        hasMore: true,
        backfillBefore: '2026-09-18T00:00:00.000Z',
      }),
      c1: syncPage({
        messages: [
          message('r1', PEER, '2026-09-20T10:01:00.000Z', { id: 'in-2' }),
          message('r1', ME, '2026-09-20T10:02:00.000Z', { id: 'own-1' }),
        ],
        nextCursor: 'c2',
        hasMore: false,
      }),
    };
    const api = scriptedApi({
      roomsList: async () => ({ rooms: [room('r1')] }),
      sync: async (params) => {
        api.calls.push(`sync:${params.cursor ?? 'none'}`);
        return pages[params.cursor ?? 'none'];
      },
    });
    const engine = new ChatSyncEngine(store, api);
    const statuses: boolean[] = [];
    engine.subscribe((s) => statuses.push(s.syncing));
    await engine.requestSync('start');

    expect(api.calls).toEqual(['archivedRoomsList', 'sync:none', 'sync:c1', 'ack:in-1,in-2']);
    expect(await store.getMeta(META_KEYS.SYNC_CURSOR)).toBe('c2');
    expect(await store.getMeta(META_KEYS.BOOTSTRAPPED)).toBe('1');
    expect(await store.getMeta(META_KEYS.HISTORY_FLOOR)).toBe('2026-09-18T00:00:00.000Z');
    expect((await store.listMessages('r1', { limit: 10 })).map((m) => m.id)).toEqual(['own-1', 'in-2', 'in-1']);
    expect(await store.pendingDeliveredAcks(10)).toEqual([]);
    expect(engine.getStatus()).toMatchObject({ syncing: false, error: null, bootstrapped: true });
    expect(statuses).toContain(true);

    // Second pass resumes from the stored cursor; nothing new → no acks.
    pages.c2 = syncPage({ nextCursor: 'c3' });
    await engine.requestSync('poll');
    expect(api.calls.slice(4)).toEqual(['sync:c2']);
  });

  it('fetches unknown rooms for incoming messages and restarts on an invalid cursor', async () => {
    const store = new MemoryChatStore(ME);
    await store.setMeta(META_KEYS.BOOTSTRAPPED, '1');
    await store.setMeta(META_KEYS.SYNC_CURSOR, 'stale');
    const api = scriptedApi({
      sync: async (params) => {
        api.calls.push(`sync:${params.cursor ?? 'none'}`);
        if (params.cursor === 'stale') throw apiError(400, { code: 'INVALID_CURSOR' });
        return syncPage({
          messages: [message('new-room', PEER, '2026-09-20T10:00:00.000Z', { id: 'in-9' })],
          nextCursor: 'fresh',
        });
      },
    });
    const engine = new ChatSyncEngine(store, api);
    await engine.requestSync('start');
    expect(api.calls).toEqual(['sync:stale', 'sync:none', 'roomGet:new-room', 'ack:in-9']);
    expect(await store.hasRoom('new-room')).toBe(true);
    expect(await store.getMeta(META_KEYS.SYNC_CURSOR)).toBe('fresh');
  });

  it('settles a 404 ack batch item by item so one stale id cannot block the rest', async () => {
    const store = new MemoryChatStore(ME);
    await store.setMeta(META_KEYS.BOOTSTRAPPED, '1');
    await store.upsertRooms([room('r1')]);
    await store.upsertMessages([
      message('r1', PEER, '2026-09-20T10:00:00.000Z', { id: 'ok-1' }),
      message('r1', PEER, '2026-09-20T10:01:00.000Z', { id: 'ghost' }),
    ]);
    const api = scriptedApi({
      acknowledge: async (input) => {
        const ids = input.acks.map((a) => a.messageId);
        api.calls.push(`ack:${ids.join(',')}`);
        if (ids.includes('ghost')) throw apiError(404, { code: 'MESSAGE_NOT_FOUND' });
        return { acknowledged: ids, ignored: [] };
      },
    });
    const engine = new ChatSyncEngine(store, api);
    await engine.requestSync('start');
    expect(api.calls.filter((c) => c.startsWith('ack:'))).toEqual(['ack:ok-1,ghost', 'ack:ok-1', 'ack:ghost']);
    expect(await store.pendingDeliveredAcks(10)).toEqual([]);
  });

  it('reports offline on a network failure and keeps local data intact', async () => {
    const store = new MemoryChatStore(ME);
    await store.setMeta(META_KEYS.BOOTSTRAPPED, '1');
    await store.upsertRooms([room('r1')]);
    await store.upsertMessages([message('r1', PEER, '2026-09-20T10:00:00.000Z', { id: 'kept' })]);
    const api = scriptedApi({
      sync: async () => {
        throw new TypeError('Network request failed');
      },
    });
    const engine = new ChatSyncEngine(store, api);
    await engine.requestSync('start');
    expect(engine.getStatus().online).toBe(false);
    expect(engine.getStatus().error).toBeTruthy();
    expect((await store.listMessages('r1', { limit: 10 })).map((m) => m.id)).toEqual(['kept']);
  });

  it('backfills older history once from the floor and remembers when the server has no more', async () => {
    const store = new MemoryChatStore(ME);
    await store.upsertRooms([room('r1')]);
    await store.setMeta(META_KEYS.HISTORY_FLOOR, '2026-09-18T00:00:00.000Z');
    const older = Array.from({ length: HISTORY_PAGE }, (_, i) =>
      message('r1', PEER, `2026-09-17T10:${String(i).padStart(2, '0')}:00.000Z`),
    );
    const api = scriptedApi({
      messagesList: async (roomId, params) => {
        api.calls.push(`messages:${roomId}:${params.before ?? 'none'}`);
        if (params.before === '2026-09-18T00:00:00.000Z') return { messages: older, hasMore: true };
        return { messages: [message('r1', PEER, '2026-09-16T00:00:00.000Z', { id: 'oldest' })], hasMore: false };
      },
    });
    const engine = new ChatSyncEngine(store, api);
    expect(await engine.loadOlder('r1')).toEqual({ fetched: HISTORY_PAGE, done: false });
    expect(await engine.loadOlder('r1')).toEqual({ fetched: 1, done: true });
    expect(await engine.loadOlder('r1')).toEqual({ fetched: 0, done: true });
    expect(api.calls).toEqual([
      'messages:r1:2026-09-18T00:00:00.000Z',
      'messages:r1:2026-09-17T10:00:00.000Z',
    ]);
    expect(await store.countMessages('r1')).toBe(HISTORY_PAGE + 1);
    expect(await engine.isBackfillDone('r1')).toBe(true);
  });
});

describe('ChatOutboxFlusher', () => {
  function outboxApi(script: (roomId: string, clientRequestId: string) => ChatMessage | Error) {
    const sent: string[] = [];
    const api: ChatOutboxApi = {
      send: async (roomId, input) => {
        sent.push(input.clientRequestId);
        const result = script(roomId, input.clientRequestId);
        if (result instanceof Error) throw result;
        return { message: result };
      },
    };
    return { api, sent };
  }

  it('sends queued rows in enqueue order and replaces them with the server row', async () => {
    const store = new MemoryChatStore(ME);
    await store.upsertRooms([room('r1')]);
    await store.enqueueOutbox(makeTextOutboxItem({ clientRequestId: 'a', roomId: 'r1', body: 'first', now: '2026-09-20T10:00:00.000Z' }));
    await store.enqueueOutbox(makeTextOutboxItem({ clientRequestId: 'b', roomId: 'r1', body: 'second', now: '2026-09-20T10:00:01.000Z' }));
    const { api, sent } = outboxApi((roomId, id) =>
      message(roomId, ME, '2026-09-20T10:00:05.000Z', { id: `srv-${id}`, clientRequestId: id }),
    );
    const onSent = jest.fn();
    const flusher = new ChatOutboxFlusher(store, api, { onSent });
    await flusher.flush();
    expect(sent).toEqual(['a', 'b']);
    expect(await store.listOutbox()).toEqual([]);
    expect((await store.listMessages('r1', { limit: 10 })).map((m) => m.id).sort()).toEqual(['srv-a', 'srv-b']);
    expect(onSent).toHaveBeenCalledTimes(2);
    flusher.stop();
  });

  it('stops at a retryable failure so later messages never overtake it, then resumes', async () => {
    const store = new MemoryChatStore(ME);
    await store.upsertRooms([room('r1')]);
    await store.enqueueOutbox(makeTextOutboxItem({ clientRequestId: 'a', roomId: 'r1', body: 'first', now: '2026-09-20T10:00:00.000Z' }));
    await store.enqueueOutbox(makeTextOutboxItem({ clientRequestId: 'b', roomId: 'r1', body: 'second', now: '2026-09-20T10:00:01.000Z' }));
    let offline = true;
    const { api, sent } = outboxApi((roomId, id) => {
      if (offline) return new TypeError('Network request failed');
      return message(roomId, ME, '2026-09-20T10:00:05.000Z', { id: `srv-${id}`, clientRequestId: id });
    });
    let now = Date.parse('2026-09-20T10:00:02.000Z');
    const flusher = new ChatOutboxFlusher(store, api, { now: () => now });
    await flusher.flush();
    expect(sent).toEqual(['a']);
    const rows = await store.listOutbox();
    expect(rows.map((r) => [r.clientRequestId, r.state])).toEqual([
      ['a', 'queued'],
      ['b', 'queued'],
    ]);
    expect(rows[0].attempts).toBe(1);
    expect(Date.parse(rows[0].nextAttemptAt) - now).toBe(backoffMs(1));

    // Connectivity returns before the backoff elapsed: nothing is sent yet.
    offline = false;
    flusher.setOnline(true);
    await flusher.flush();
    expect(sent).toEqual(['a']);

    now += backoffMs(1);
    await flusher.flush();
    expect(sent).toEqual(['a', 'a', 'b']);
    expect(await store.listOutbox()).toEqual([]);
    flusher.stop();
  });

  it('recovers from a transient fetch failure on its own timer, without a connectivity event', async () => {
    jest.useFakeTimers();
    const store = new MemoryChatStore(ME);
    await store.upsertRooms([room('r1')]);
    await store.enqueueOutbox(makeTextOutboxItem({ clientRequestId: 'a', roomId: 'r1', body: 'first', now: '2026-09-20T10:00:00.000Z' }));
    let failing = true;
    const { api, sent } = outboxApi((roomId, id) => {
      if (failing) return new TypeError('Network request failed'); // e.g. a DNS blip while the OS still reports online
      return message(roomId, ME, '2026-09-20T10:00:05.000Z', { id: `srv-${id}`, clientRequestId: id });
    });
    let now = Date.parse('2026-09-20T10:00:02.000Z');
    const flusher = new ChatOutboxFlusher(store, api, { now: () => now });
    await flusher.flush();
    expect(sent).toEqual(['a']);
    failing = false;
    // No setOnline() call happens: the backoff timer alone must retry.
    now += backoffMs(1);
    await jest.advanceTimersByTimeAsync(backoffMs(1));
    expect(sent).toEqual(['a', 'a']);
    expect(await store.listOutbox()).toEqual([]);
    flusher.stop();
  });

  it('marks a definitive 4xx as failed, continues with the next row, and lets the user retry or discard', async () => {
    const store = new MemoryChatStore(ME);
    await store.upsertRooms([room('r1')]);
    await store.enqueueOutbox(makeTextOutboxItem({ clientRequestId: 'bad', roomId: 'r1', body: 'nope', now: '2026-09-20T10:00:00.000Z' }));
    await store.enqueueOutbox(makeTextOutboxItem({ clientRequestId: 'good', roomId: 'r1', body: 'ok', now: '2026-09-20T10:00:01.000Z' }));
    let rejectBad = true;
    const { api, sent } = outboxApi((roomId, id) => {
      if (id === 'bad' && rejectBad) return apiError(403, { message: 'You are blocked' });
      return message(roomId, ME, '2026-09-20T10:00:05.000Z', { id: `srv-${id}`, clientRequestId: id });
    });
    const onFailed = jest.fn();
    const flusher = new ChatOutboxFlusher(store, api, { onFailed });
    await flusher.flush();
    expect(sent).toEqual(['bad', 'good']);
    expect(onFailed).toHaveBeenCalledTimes(1);
    const failed = await store.getOutbox('bad');
    expect(failed).toMatchObject({ state: 'failed', lastError: 'You are blocked' });
    const bubble = outboxToMessage(failed!, { id: ME, name: 'Me' });
    expect(bubble).toMatchObject({ id: 'out-bad', localStatus: 'failed', senderId: ME, body: 'nope' });

    // Failed rows are skipped by later passes until the user acts.
    await flusher.flush();
    expect(sent).toEqual(['bad', 'good']);

    rejectBad = false;
    await flusher.retry('bad');
    expect(sent).toEqual(['bad', 'good', 'bad']);
    expect(await store.listOutbox()).toEqual([]);

    await store.enqueueOutbox(makeTextOutboxItem({ clientRequestId: 'drop', roomId: 'r1', body: 'x' }));
    await store.updateOutbox('drop', { state: 'failed' });
    await flusher.discard('drop');
    expect(await store.getOutbox('drop')).toBeNull();
    flusher.stop();
  });

  it('leaves rows untouched on 401 and skips pending uploads', async () => {
    const store = new MemoryChatStore(ME);
    await store.upsertRooms([room('r1')]);
    await store.enqueueOutbox({
      clientRequestId: 'upload',
      roomId: 'r1',
      kind: 'image',
      body: 'photo.jpg',
      localUri: 'file:///tmp/photo.jpg',
      state: 'pending_upload',
      attempts: 0,
      lastError: null,
      nextAttemptAt: '2026-09-20T10:00:00.000Z',
      createdAt: '2026-09-20T10:00:00.000Z',
    });
    await store.enqueueOutbox(makeTextOutboxItem({ clientRequestId: 'txt', roomId: 'r1', body: 'hi', now: '2026-09-20T10:00:01.000Z' }));
    const { api, sent } = outboxApi(() => apiError(401));
    const flusher = new ChatOutboxFlusher(store, api);
    await flusher.flush();
    expect(sent).toEqual(['txt']);
    expect((await store.listOutbox()).map((r) => [r.clientRequestId, r.state])).toEqual([
      ['upload', 'pending_upload'],
      ['txt', 'queued'],
    ]);
    flusher.stop();
  });
});
