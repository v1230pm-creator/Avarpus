/**
 * The SQLite chat store's media-integrity SQL, run against a real SQLite
 * engine (Node's built-in `node:sqlite`) through the same `SqlDatabase`
 * adapter shape expo-sqlite provides on device. The in-memory store mirrors
 * these rules in JS; this file guards the SQL side (json_extract predicate,
 * JOINs, the `media_lost` table and the v3 migration) that the memory store
 * cannot exercise.
 */
import type { ChatMessage } from '@workspace/api-client-react';
import { CHAT_STORE_SCHEMA_VERSION, META_KEYS, SqliteChatStore, type MediaIndexRow } from '@/utils/chatStore';
import type { SqlDatabase, SqlValue } from '@/utils/chatStore/sqliteStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: SqlValue[]): { changes: number | bigint };
      all(...params: SqlValue[]): unknown[];
      get(...params: SqlValue[]): unknown;
    };
    close(): void;
  };
};

function openDatabase(): SqlDatabase {
  const db = new DatabaseSync(':memory:');
  return {
    async execAsync(source) {
      db.exec(source);
    },
    async runAsync(source, params = []) {
      return { changes: Number(db.prepare(source).run(...params).changes) };
    },
    async getAllAsync<T>(source: string, params: SqlValue[] = []) {
      return db.prepare(source).all(...params) as T[];
    },
    async getFirstAsync<T>(source: string, params: SqlValue[] = []) {
      return (db.prepare(source).get(...params) as T | undefined) ?? null;
    },
    async withTransactionAsync(task) {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async closeAsync() {
      db.close();
    },
  };
}

const ME = 'user-me';

let seq = 0;
function message(extra: Partial<ChatMessage> = {}): ChatMessage {
  seq += 1;
  return {
    id: `m-${seq}`,
    roomId: 'room-a',
    shopId: null,
    senderId: 'user-peer',
    senderName: 'Peer',
    kind: 'image',
    body: 'attachment',
    objectPath: `/objects/uploads/${seq}`,
    mimeType: 'image/jpeg',
    sizeBytes: 100 * seq,
    createdAt: `2026-09-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    ...extra,
  } as ChatMessage;
}

function row(msg: Pick<ChatMessage, 'id' | 'roomId' | 'sizeBytes'>, extra: Partial<MediaIndexRow> = {}): MediaIndexRow {
  return {
    messageId: msg.id,
    roomId: msg.roomId,
    localPath: `file:///docs/chat-media/${ME}/${msg.roomId}/${msg.id}.jpg`,
    sizeBytes: msg.sizeBytes ?? 1,
    mimeType: 'image/jpeg',
    origin: 'received',
    storedAcked: true,
    createdAt: '2026-09-02T00:00:00.000Z',
    ...extra,
  };
}

describe('SQLite media integrity SQL', () => {
  let db: SqlDatabase;
  let store: SqliteChatStore;

  beforeEach(async () => {
    seq = 0;
    db = openDatabase();
    store = await SqliteChatStore.open(ME, db);
  });

  afterEach(async () => {
    await store.close();
  });

  test('a fresh database lands on the current schema version with the media_lost table', async () => {
    expect(await store.getMeta(META_KEYS.SCHEMA_VERSION)).toBe(String(CHAT_STORE_SCHEMA_VERSION));
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('media', 'media_lost') ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(['media', 'media_lost']);
  });

  test('recoverable media = indexed rows whose message still has a relay copy, with the message payload', async () => {
    const live = message({ id: 'live' });
    const legacy = message({ id: 'legacy', mediaState: undefined });
    const purged = message({ id: 'purged', mediaState: 'purged' });
    const expired = message({ id: 'expired', mediaState: 'expired' });
    const deleted = message({ id: 'deleted', deletedAt: '2026-09-02T00:00:00.000Z' });
    await store.upsertMessages([live, legacy, purged, expired, deleted]);
    for (const m of [live, legacy, purged, expired, deleted]) await store.putMedia(row(m));
    // Indexed but no message row (a queued send): not recoverable, not only-here.
    await store.putMedia(row({ id: 'out-req-1', roomId: 'room-a', sizeBytes: 7 }, { origin: 'sent' }));

    const recoverable = await store.listRecoverableMedia();
    expect(recoverable.map((r) => r.media.messageId).sort()).toEqual(['legacy', 'live']);
    expect(recoverable.find((r) => r.media.messageId === 'live')?.message).toMatchObject({
      id: 'live',
      roomId: 'room-a',
      sizeBytes: live.sizeBytes,
    });

    expect(await store.mediaSummary()).toEqual({
      files: 6,
      bytes: [live, legacy, purged, expired, deleted].reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0) + 7,
      onlyOnDeviceFiles: 3,
      onlyOnDeviceBytes: [purged, expired, deleted].reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0),
    });
  });

  test('a purge learnt from sync moves a file from recoverable to only-on-this-phone', async () => {
    const msg = message({ id: 'm' });
    await store.upsertMessages([msg]);
    await store.putMedia(row(msg));
    expect((await store.mediaSummary()).onlyOnDeviceFiles).toBe(0);
    await store.upsertMessages([{ ...msg, mediaState: 'purged', objectPath: undefined }]);
    expect(await store.listRecoverableMedia()).toEqual([]);
    expect((await store.mediaSummary()).onlyOnDeviceFiles).toBe(1);
  });

  test('lost acks queue once per message, page in order, settle, and are superseded by a fresh copy', async () => {
    await store.queueLostAcks([
      { messageId: 'a', roomId: 'room-a' },
      { messageId: 'b', roomId: 'room-a' },
    ]);
    await store.queueLostAcks([{ messageId: 'a', roomId: 'room-a' }]);
    expect(await store.pendingLostAcks(10)).toEqual(['a', 'b']);
    expect(await store.pendingLostAcks(1)).toEqual(['a']);
    await store.markLostAcknowledged(['a']);
    expect(await store.pendingLostAcks(10)).toEqual(['b']);
    await store.putMedia(row({ id: 'b', roomId: 'room-a', sizeBytes: 5 }, { storedAcked: false }));
    expect(await store.pendingLostAcks(10)).toEqual([]);
    expect(await store.pendingStoredAcks(10)).toEqual(['b']);
  });

  test('wipe clears pending lost acks with everything else', async () => {
    await store.queueLostAcks([{ messageId: 'a', roomId: 'room-a' }]);
    await store.wipe();
    expect(await store.pendingLostAcks(10)).toEqual([]);
  });
});
