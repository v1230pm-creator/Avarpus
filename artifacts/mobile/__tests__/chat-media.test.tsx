/**
 * Device-owned chat media: the media index, the download state machine, the
 * auto-download policy and the `stored` acknowledgement flow.
 *
 * Runs against the in-memory store and an in-memory file-ops double so the
 * whole flow can be exercised without a device or a network.
 */
import { ApiError } from '@workspace/api-client-react';
import type { ChatMessage } from '@workspace/api-client-react';
import { MemoryChatStore } from '@/utils/chatStore';
import type { ChatStore, MediaIndexRow } from '@/utils/chatStore';
import { ChatSyncEngine, type ChatSyncApi } from '@/utils/chatSync';
import {
  ChatMediaDownloadManager,
  DEFAULT_AUTO_DOWNLOAD,
  MediaVerificationError,
  clearRoomMedia,
  discardOutboxMedia,
  finalizeSentMedia,
  keepSentMedia,
  mediaClearedAtKey,
  normaliseAutoDownloadSettings,
  outboxMediaKey,
  relayAvailable,
  shouldAutoDownload,
  type AutoDownloadSettings,
  type DownloadParams,
  type ImportParams,
  type MediaFileHandle,
  type MediaFileOps,
  type NetworkClass,
} from '@/utils/chatMedia';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// The download manager's idle/settle helpers rely on real macrotasks; the
// project enables fake timers globally.
jest.useRealTimers();

const ME = 'user-me';
const PEER = 'user-peer';

let seq = 0;
function media(
  kind: ChatMessage['kind'],
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  seq += 1;
  return {
    id: extra.id ?? `m-${seq}`,
    roomId: 'room-a',
    shopId: null,
    senderId: PEER,
    senderName: 'Peer',
    kind,
    body: kind === 'file' ? 'report.pdf' : 'attachment',
    objectPath: `/objects/uploads/${seq}`,
    mimeType: kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mp4' : 'application/pdf',
    sizeBytes: 1000 + seq,
    createdAt: `2026-09-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    ...extra,
  } as ChatMessage;
}

/**
 * In-memory file system double. Each "download" resolves through a
 * controllable gate so tests can hold a transfer in flight, fail it, or
 * return bytes of the wrong size.
 */
class FakeFileOps implements MediaFileOps {
  files = new Map<string, number>();
  pending: Array<{ params: DownloadParams; resolve: (bytes: number) => void; reject: (err: Error) => void }> = [];
  autoResolve: ((params: DownloadParams) => number | Error) | null = null;
  imports: ImportParams[] = [];
  deleted: string[] = [];

  private pathFor(roomId: string, messageId: string, ext: string): string {
    return `file:///docs/chat-media/${ME}/${roomId}/${messageId}.${ext}`;
  }

  download(params: DownloadParams): Promise<MediaFileHandle> {
    const path = this.pathFor(params.roomId, params.messageId, params.ext);
    const finish = (bytes: number): MediaFileHandle => {
      if (params.expectedSize !== undefined && bytes !== params.expectedSize) {
        // Mirrors the native implementation: the partial file is discarded.
        throw new MediaVerificationError(`Expected ${params.expectedSize} bytes, got ${bytes}.`);
      }
      this.files.set(path, bytes);
      return { path, sizeBytes: bytes };
    };
    if (this.autoResolve) {
      const outcome = this.autoResolve(params);
      if (outcome instanceof Error) return Promise.reject(outcome);
      try {
        return Promise.resolve(finish(outcome));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return new Promise<MediaFileHandle>((resolve, reject) => {
      this.pending.push({
        params,
        resolve: (bytes) => {
          try {
            resolve(finish(bytes));
          } catch (err) {
            reject(err);
          }
        },
        reject,
      });
    });
  }

  async importFile(params: ImportParams): Promise<MediaFileHandle> {
    this.imports.push(params);
    if (params.sourceUri.includes('unreadable')) throw new Error('source missing');
    const path = this.pathFor(params.roomId, params.messageId, params.ext);
    this.files.set(path, 4321);
    if (params.move) this.deleted.push(params.sourceUri);
    return { path, sizeBytes: 4321 };
  }

  async size(path: string): Promise<number | null> {
    return this.files.get(path) ?? null;
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
    this.deleted.push(path);
  }

  async deleteRoom(roomId: string): Promise<void> {
    for (const path of [...this.files.keys()]) {
      if (path.includes(`/${roomId}/`)) this.files.delete(path);
    }
  }

  async deleteAccount(): Promise<void> {
    this.files.clear();
  }

  /** Completes the oldest in-flight download with `bytes`. */
  complete(bytes?: number): void {
    const next = this.pending.shift();
    if (!next) throw new Error('no download in flight');
    next.resolve(bytes ?? next.params.expectedSize ?? 1);
  }

  fail(message = 'network down'): void {
    const next = this.pending.shift();
    if (!next) throw new Error('no download in flight');
    next.reject(new Error(message));
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await tick();
}

function manager(
  store: ChatStore,
  files: FakeFileOps,
  overrides: {
    settings?: AutoDownloadSettings;
    network?: NetworkClass;
    concurrency?: number;
    onStored?: (message: ChatMessage) => void;
    onLost?: (message: ChatMessage) => void;
    verifyIntervalMs?: number;
    auditIntervalMs?: number;
  } = {},
) {
  const state = { settings: overrides.settings ?? DEFAULT_AUTO_DOWNLOAD, network: overrides.network ?? 'wifi' };
  const dm = new ChatMediaDownloadManager(store, {
    files,
    authToken: () => 'tok',
    mediaUrl: (roomId, messageId) => `https://api.test/chat/rooms/${roomId}/messages/${messageId}/media`,
    settings: () => state.settings,
    network: () => state.network,
    concurrency: overrides.concurrency,
    onStored: overrides.onStored,
    onLost: overrides.onLost,
    verifyIntervalMs: overrides.verifyIntervalMs,
    auditIntervalMs: overrides.auditIntervalMs,
    now: () => '2026-09-02T00:00:00.000Z',
  });
  return { dm, state };
}

function row(messageId: string, roomId: string, sizeBytes: number, extra: Partial<MediaIndexRow> = {}): MediaIndexRow {
  return {
    messageId,
    roomId,
    localPath: `file:///docs/chat-media/${ME}/${roomId}/${messageId}.bin`,
    sizeBytes,
    mimeType: 'application/octet-stream',
    origin: 'received',
    storedAcked: false,
    createdAt: '2026-09-02T00:00:00.000Z',
    ...extra,
  };
}

beforeEach(() => {
  seq = 0;
});

// ── Media index ─────────────────────────────────────────────────────────────

describe('media index', () => {
  test('put/get/many/list/remove and per-room usage', async () => {
    const store = new MemoryChatStore(ME);
    await store.putMedia(row('m-1', 'room-a', 100));
    await store.putMedia(row('m-2', 'room-a', 250));
    await store.putMedia(row('m-3', 'room-b', 1000));

    expect((await store.getMedia('m-1'))?.sizeBytes).toBe(100);
    expect(await store.getMedia('missing')).toBeNull();
    const many = await store.getMediaMany(['m-1', 'm-3', 'nope']);
    expect([...many.keys()].sort()).toEqual(['m-1', 'm-3']);
    expect((await store.listMedia('room-a')).map((r) => r.messageId).sort()).toEqual(['m-1', 'm-2']);
    expect((await store.listMedia()).length).toBe(3);

    const usage = await store.mediaUsageByRoom();
    expect(usage.find((u) => u.roomId === 'room-a')).toEqual({ roomId: 'room-a', bytes: 350, files: 2 });
    expect(usage.find((u) => u.roomId === 'room-b')).toEqual({ roomId: 'room-b', bytes: 1000, files: 1 });

    await store.removeMedia(['m-1', 'm-3']);
    expect(await store.getMedia('m-1')).toBeNull();
    expect((await store.listMedia()).map((r) => r.messageId)).toEqual(['m-2']);
  });

  test('putMedia replaces an existing row for the same message', async () => {
    const store = new MemoryChatStore(ME);
    await store.putMedia(row('m-1', 'room-a', 100));
    await store.putMedia(row('m-1', 'room-a', 200, { storedAcked: true }));
    expect(await store.listMedia('room-a')).toHaveLength(1);
    expect((await store.getMedia('m-1'))?.sizeBytes).toBe(200);
  });

  test('rekeyMedia moves the row to the server id and drops the outbox key', async () => {
    const store = new MemoryChatStore(ME);
    const key = outboxMediaKey('req-1');
    await store.putMedia(row(key, 'room-a', 100, { origin: 'sent', storedAcked: true }));
    await store.rekeyMedia(key, 'srv-1');
    expect(await store.getMedia(key)).toBeNull();
    const moved = await store.getMedia('srv-1');
    expect(moved?.origin).toBe('sent');
    expect(moved?.localPath).toContain(key);
  });

  test('messages read from the store carry the local media path', async () => {
    const store = new MemoryChatStore(ME);
    const msg = media('image', { id: 'm-1' });
    await store.upsertMessages([msg]);
    let listed = await store.listMessages('room-a', { limit: 10 });
    expect(listed[0]?.localMediaPath).toBeUndefined();
    await store.putMedia(row('m-1', 'room-a', msg.sizeBytes!));
    listed = await store.listMessages('room-a', { limit: 10 });
    expect(listed[0]?.localMediaPath).toContain('/room-a/m-1');
  });

  test('stored acks: received rows are pending until acknowledged; sent rows never are', async () => {
    const store = new MemoryChatStore(ME);
    await store.putMedia(row('m-1', 'room-a', 100));
    await store.putMedia(row('m-2', 'room-a', 100, { origin: 'sent', storedAcked: true }));
    await store.putMedia(row('m-3', 'room-a', 100));
    expect((await store.pendingStoredAcks(10)).sort()).toEqual(['m-1', 'm-3']);
    expect(await store.pendingStoredAcks(1)).toHaveLength(1);
    await store.markStoredAcknowledged(['m-1']);
    expect(await store.pendingStoredAcks(10)).toEqual(['m-3']);
    expect((await store.getMedia('m-1'))?.storedAcked).toBe(true);
  });

  test('clearRoomMedia removes files and index rows for that room only; messages stay', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const a = media('image', { id: 'm-a' });
    const b = media('image', { id: 'm-b', roomId: 'room-b' });
    await store.upsertMessages([a, b]);
    files.files.set(row('m-a', 'room-a', 1).localPath, 1);
    files.files.set(row('m-b', 'room-b', 1).localPath, 1);
    await store.putMedia(row('m-a', 'room-a', 1));
    await store.putMedia(row('m-b', 'room-b', 1));

    await clearRoomMedia(store, files, 'room-a');

    expect(await store.getMedia('m-a')).toBeNull();
    expect(await store.getMedia('m-b')).not.toBeNull();
    expect([...files.files.keys()]).toEqual([row('m-b', 'room-b', 1).localPath]);
    expect(await store.listMessages('room-a', { limit: 10 })).toHaveLength(1);
  });
});

// ── Sender-side originals ───────────────────────────────────────────────────

describe('sender-side originals', () => {
  test('keepSentMedia indexes the copy under the outbox key; finalize re-keys it', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const kept = await keepSentMedia(store, files, {
      clientRequestId: 'req-1',
      roomId: 'room-a',
      sourceUri: 'file:///cache/voice.m4a',
      mimeType: 'audio/mp4',
      ext: 'm4a',
      move: true,
    });
    expect(kept?.messageId).toBe('out-req-1');
    expect(kept?.origin).toBe('sent');
    expect(kept?.storedAcked).toBe(true);
    expect(files.imports[0]).toMatchObject({ move: true, messageId: 'out-req-1' });
    // Moving disposes of the staging copy.
    expect(files.deleted).toContain('file:///cache/voice.m4a');

    await finalizeSentMedia(store, 'req-1', 'srv-9');
    expect(await store.getMedia('out-req-1')).toBeNull();
    expect((await store.getMedia('srv-9'))?.localPath).toBe(kept?.localPath);
    // Own media is never a pending stored ack.
    expect(await store.pendingStoredAcks(10)).toEqual([]);
  });

  test('keepSentMedia returns null when the copy fails and indexes nothing', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const kept = await keepSentMedia(store, files, {
      clientRequestId: 'req-2',
      roomId: 'room-a',
      sourceUri: 'content://unreadable',
      mimeType: 'image/jpeg',
      ext: 'jpg',
    });
    expect(kept).toBeNull();
    expect(await store.listMedia()).toEqual([]);
  });

  test('discardOutboxMedia deletes the kept copy of an abandoned send', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const kept = await keepSentMedia(store, files, {
      clientRequestId: 'req-3',
      roomId: 'room-a',
      sourceUri: 'file:///pick/photo.jpg',
      mimeType: 'image/jpeg',
      ext: 'jpg',
    });
    await discardOutboxMedia(store, files, 'req-3');
    expect(await store.getMedia('out-req-3')).toBeNull();
    expect(files.files.has(kept!.localPath)).toBe(false);
    // Idempotent.
    await expect(discardOutboxMedia(store, files, 'req-3')).resolves.toBeUndefined();
  });
});

// ── Policy ──────────────────────────────────────────────────────────────────

describe('auto-download policy', () => {
  test('defaults: images/audio/documents everywhere, videos on Wi-Fi only', () => {
    expect(shouldAutoDownload('image', DEFAULT_AUTO_DOWNLOAD, 'cellular')).toBe(true);
    expect(shouldAutoDownload('audio', DEFAULT_AUTO_DOWNLOAD, 'cellular')).toBe(true);
    expect(shouldAutoDownload('file', DEFAULT_AUTO_DOWNLOAD, 'cellular')).toBe(true);
    expect(shouldAutoDownload('video', DEFAULT_AUTO_DOWNLOAD, 'cellular')).toBe(false);
    expect(shouldAutoDownload('video', DEFAULT_AUTO_DOWNLOAD, 'wifi')).toBe(true);
    // Unknown network is treated as metered; offline never auto-downloads.
    expect(shouldAutoDownload('video', DEFAULT_AUTO_DOWNLOAD, 'unknown')).toBe(false);
    expect(shouldAutoDownload('image', DEFAULT_AUTO_DOWNLOAD, 'offline')).toBe(false);
    expect(shouldAutoDownload('text', DEFAULT_AUTO_DOWNLOAD, 'wifi')).toBe(false);
  });

  test('"never" disables auto download for that kind', () => {
    const settings: AutoDownloadSettings = { ...DEFAULT_AUTO_DOWNLOAD, images: 'never' };
    expect(shouldAutoDownload('image', settings, 'wifi')).toBe(false);
  });

  test('normalise tolerates garbage and partial settings', () => {
    expect(normaliseAutoDownloadSettings(null)).toEqual(DEFAULT_AUTO_DOWNLOAD);
    expect(normaliseAutoDownloadSettings({ videos: 'always', images: 'bogus', extra: 1 })).toEqual({
      ...DEFAULT_AUTO_DOWNLOAD,
      videos: 'always',
    });
  });

  test('relayAvailable follows the server media state', () => {
    expect(relayAvailable(media('image'))).toBe(true);
    expect(relayAvailable(media('image', { mediaState: 'available' }))).toBe(true);
    expect(relayAvailable(media('image', { mediaState: 'pinned' }))).toBe(true);
    expect(relayAvailable(media('image', { mediaState: 'purged' }))).toBe(false);
    expect(relayAvailable(media('image', { mediaState: 'expired' }))).toBe(false);
    expect(relayAvailable(media('image', { deletedAt: '2026-09-02T00:00:00.000Z' }))).toBe(false);
    // No state at all (older rows) still renders from the relay.
    expect(relayAvailable(media('image', { objectPath: undefined }))).toBe(true);
  });
});

// ── Download state machine ──────────────────────────────────────────────────

describe('download manager', () => {
  test('auto-downloads permitted kinds, indexes on verified completion and reports stored', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const stored: string[] = [];
    const { dm } = manager(store, files, { network: 'cellular', onStored: (m) => stored.push(m.id) });
    const img = media('image', { id: 'img' });
    const vid = media('video', { id: 'vid' });
    const text = media('text', { id: 'txt', objectPath: undefined });
    const gone = media('image', { id: 'gone', mediaState: 'purged' });

    await dm.consider([img, vid, text, gone]);
    expect(dm.status('img')?.state).toBe('downloading');
    expect(dm.status('vid')).toBeUndefined(); // video on cellular waits for a tap
    expect(dm.status('txt')).toBeUndefined();
    expect(dm.status('gone')).toBeUndefined();
    expect(files.pending).toHaveLength(1);
    expect(files.pending[0].params).toMatchObject({
      messageId: 'img',
      roomId: 'room-a',
      ext: 'jpg',
      expectedSize: img.sizeBytes,
      headers: { Authorization: 'Bearer tok' },
    });

    files.complete();
    await dm.idle();
    await settle();
    expect(dm.status('img')).toBeUndefined();
    const indexed = await store.getMedia('img');
    expect(indexed).toMatchObject({ origin: 'received', storedAcked: false, sizeBytes: img.sizeBytes, mimeType: 'image/jpeg' });
    expect(stored).toEqual(['img']);
    expect(await store.pendingStoredAcks(10)).toEqual(['img']);
  });

  test('size mismatch fails the download and indexes nothing', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm } = manager(store, files);
    const img = media('image', { id: 'img' });
    await dm.consider([img]);
    files.complete(img.sizeBytes! - 1);
    await dm.idle();
    await settle();
    expect(dm.status('img')).toMatchObject({ state: 'failed', manual: false });
    expect(dm.status('img')?.error).toMatch(/bytes/);
    expect(await store.getMedia('img')).toBeNull();
    expect(files.files.size).toBe(0);
  });

  test('failed auto downloads are not retried by consider(); a tap retries and clears the failure', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm } = manager(store, files);
    const img = media('image', { id: 'img' });
    await dm.consider([img]);
    files.fail('relay 503');
    await dm.idle();
    await settle();
    expect(dm.status('img')).toEqual({ state: 'failed', manual: false, error: 'relay 503' });

    await dm.consider([img]);
    expect(files.pending).toHaveLength(0);
    expect(dm.status('img')?.state).toBe('failed');

    dm.download(img);
    expect(dm.status('img')).toEqual({ state: 'queued', manual: true });
    await settle();
    expect(dm.status('img')).toEqual({ state: 'downloading', manual: true });
    files.complete();
    await dm.idle();
    await settle();
    expect(dm.status('img')).toBeUndefined();
    expect(await store.getMedia('img')).not.toBeNull();
  });

  test('clearFailure forgets a failed attempt only', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm } = manager(store, files);
    const img = media('image', { id: 'img' });
    await dm.consider([img]);
    dm.clearFailure('img');
    expect(dm.status('img')?.state).toBe('downloading');
    files.fail();
    await dm.idle();
    await settle();
    expect(dm.status('img')?.state).toBe('failed');
    dm.clearFailure('img');
    expect(dm.status('img')).toBeUndefined();
  });

  test('respects the concurrency limit and promotes manual downloads to the front', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm } = manager(store, files, { concurrency: 1 });
    const a = media('image', { id: 'a' });
    const b = media('image', { id: 'b' });
    const c = media('image', { id: 'c' });
    await dm.consider([a, b, c]);
    expect(dm.status('a')?.state).toBe('downloading');
    expect(dm.status('b')?.state).toBe('queued');
    expect(dm.status('c')?.state).toBe('queued');
    expect(files.pending).toHaveLength(1);

    dm.download(c);
    expect(dm.status('c')).toEqual({ state: 'queued', manual: true });
    files.complete();
    await settle();
    // c jumped ahead of b.
    expect(files.pending[0]?.params.messageId).toBe('c');
    expect(dm.status('c')?.state).toBe('downloading');
    expect(dm.status('b')?.state).toBe('queued');
    files.complete();
    await settle();
    expect(files.pending[0]?.params.messageId).toBe('b');
    files.complete();
    await dm.idle();
    await settle();
    expect((await store.listMedia('room-a')).map((r) => r.messageId).sort()).toEqual(['a', 'b', 'c']);
  });

  test('already-indexed and already-queued messages are skipped; duplicates never download twice', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm } = manager(store, files);
    const a = media('image', { id: 'a' });
    const b = media('image', { id: 'b' });
    await store.putMedia(row('a', 'room-a', a.sizeBytes!));
    await dm.consider([a, b]);
    await dm.consider([b]);
    dm.download(b);
    expect(dm.status('a')).toBeUndefined();
    expect(files.pending).toHaveLength(1);
    files.complete();
    await dm.idle();
    await settle();
    expect(await store.listMedia('room-a')).toHaveLength(2);
  });

  test('network change drops auto downloads the policy no longer allows; manual ones stay', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm, state } = manager(store, files, { concurrency: 1 });
    const holder = media('image', { id: 'holder' });
    const v1 = media('video', { id: 'v1' });
    const v2 = media('video', { id: 'v2' });
    await dm.consider([holder, v1, v2]);
    dm.download(v2);
    expect(dm.status('v1')?.state).toBe('queued');
    expect(dm.status('v2')).toEqual({ state: 'queued', manual: true });

    state.network = 'cellular';
    dm.networkChanged();
    expect(dm.status('v1')).toBeUndefined();
    expect(dm.status('v2')?.state).toBe('queued');

    files.complete(); // holder
    await settle();
    expect(files.pending[0]?.params.messageId).toBe('v2');
    files.complete();
    await dm.idle();
    await settle();
    expect(await store.getMedia('v1')).toBeNull();
    expect(await store.getMedia('v2')).not.toBeNull();
  });

  test('offline: nothing starts until the network is back', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm, state } = manager(store, files, { network: 'offline' });
    const img = media('image', { id: 'img' });
    await dm.consider([img]);
    expect(dm.status('img')).toBeUndefined(); // policy: offline never auto-queues
    dm.download(img);
    expect(dm.status('img')).toEqual({ state: 'queued', manual: true });
    expect(files.pending).toHaveLength(0);
    state.network = 'wifi';
    dm.networkChanged();
    await settle();
    expect(dm.status('img')?.state).toBe('downloading');
    files.complete();
    await dm.idle();
    await settle();
    expect(await store.getMedia('img')).not.toBeNull();
  });

  test('stop() clears statuses and discards a file that lands afterwards', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm } = manager(store, files);
    const img = media('image', { id: 'img' });
    await dm.consider([img]);
    const seen: string[][] = [];
    dm.subscribe((ids) => seen.push([...ids]));
    dm.stop();
    expect(dm.status('img')).toBeUndefined();
    expect(seen).toEqual([['img']]);
    files.complete();
    await settle();
    expect(await store.getMedia('img')).toBeNull();
    expect(files.files.size).toBe(0);
    await dm.consider([img]);
    dm.download(img);
    expect(dm.status('img')).toBeUndefined();
  });

  test('subscribers are told about every transition', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm } = manager(store, files);
    const img = media('image', { id: 'img' });
    const states: Array<string | undefined> = [];
    dm.subscribe((ids) => {
      if (ids.has('img')) states.push(dm.status('img')?.state);
    });
    await dm.consider([img]);
    files.complete();
    await dm.idle();
    await settle();
    expect(states).toEqual(['queued', 'downloading', undefined]);
  });

  test("the viewer's own historical attachments are fetched back and indexed as sent, never stored-acked", async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const stored: string[] = [];
    const { dm } = manager(store, files, { onStored: (m) => stored.push(m.id) });
    const own = media('image', { id: 'own', senderId: ME });
    // Auto policy applies to own history too (e.g. sent from another device).
    await dm.consider([own]);
    expect(dm.status('own')?.state).toBe('downloading');
    files.complete();
    await dm.idle();
    await settle();
    expect(await store.getMedia('own')).toMatchObject({ origin: 'sent', storedAcked: true });
    expect(stored).toEqual([]);
    expect(await store.pendingStoredAcks(10)).toEqual([]);

    // A manual tap works for own media as well (e.g. after "Clear media").
    await store.removeMedia(['own']);
    const ownVideo = media('video', { id: 'own-video', senderId: ME });
    dm.download(ownVideo);
    expect(dm.status('own-video')).toEqual({ state: 'queued', manual: true });
    await settle();
    files.complete();
    await dm.idle();
    await settle();
    expect((await store.getMedia('own-video'))?.origin).toBe('sent');
  });

  test('clearRoom drops queued, discards in-flight, forgets failures and suppresses auto refill of old messages', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm } = manager(store, files, { concurrency: 1 });
    const inflight = media('image', { id: 'inflight', createdAt: '2026-09-01T00:00:01.000Z' });
    const queued = media('image', { id: 'queued', createdAt: '2026-09-01T00:00:02.000Z' });
    const other = media('image', { id: 'other', roomId: 'room-b' });
    const failed = media('image', { id: 'failed', createdAt: '2026-09-01T00:00:00.000Z' });
    await store.upsertMessages([failed, inflight, queued]);

    // Produce a failed row first.
    await dm.consider([failed]);
    files.fail();
    await dm.idle();
    await settle();
    expect(dm.status('failed')?.state).toBe('failed');

    await dm.consider([inflight, queued, other]);
    expect(dm.status('inflight')?.state).toBe('downloading');
    expect(dm.status('queued')?.state).toBe('queued');
    expect(dm.status('other')?.state).toBe('queued');

    await clearRoomMedia(store, files, 'room-a', dm);

    expect(dm.status('queued')).toBeUndefined();
    expect(dm.status('failed')).toBeUndefined();
    expect(dm.status('other')?.state).toBe('queued'); // other rooms untouched
    // The in-flight transfer lands after the clear: file removed, nothing indexed.
    files.complete();
    await settle();
    expect(dm.status('inflight')).toBeUndefined();
    expect(await store.getMedia('inflight')).toBeNull();
    expect([...files.files.keys()].some((p) => p.includes('/room-a/'))).toBe(false);
    // Watermark persisted at the newest message in the room.
    expect(await store.getMeta(mediaClearedAtKey('room-a'))).toBe('2026-09-01T00:00:02.000Z');

    // room-b download proceeds normally.
    expect(files.pending[0]?.params.messageId).toBe('other');
    files.complete();
    await dm.idle();
    await settle();

    // Re-considering the cleared messages (bubbles re-rendering, a fresh sync
    // page) does not refill the room …
    await dm.consider([failed, inflight, queued]);
    expect(dm.status('inflight')).toBeUndefined();
    expect(dm.status('queued')).toBeUndefined();
    expect(files.pending).toHaveLength(0);
    // … but a newer message still auto-downloads and a tap still works.
    const fresh = media('image', { id: 'fresh', createdAt: '2026-09-01T00:00:03.000Z' });
    await dm.consider([fresh]);
    expect(dm.status('fresh')?.state).toBe('downloading');
    files.complete();
    await dm.idle();
    await settle();
    dm.download(queued);
    await settle();
    expect(dm.status('queued')?.state).toBe('downloading');
    files.complete();
    await dm.idle();
    await settle();
    expect((await store.listMedia('room-a')).map((r) => r.messageId).sort()).toEqual(['fresh', 'queued']);
    // Messages themselves were never touched by the clear.
    expect(await store.listMessages('room-a', { limit: 10 })).toHaveLength(3);
  });

  test('the clear watermark survives a new manager instance (app restart)', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const old = media('image', { id: 'old', createdAt: '2026-09-01T00:00:01.000Z' });
    await store.upsertMessages([old]);
    const first = manager(store, files).dm;
    await clearRoomMedia(store, files, 'room-a', first);
    first.stop();

    const second = manager(store, files).dm;
    await second.consider([old]);
    expect(second.status('old')).toBeUndefined();
    expect(files.pending).toHaveLength(0);
  });
});

// ── Stored acks through the sync engine ─────────────────────────────────────

describe('stored acks', () => {
  function engineWith(store: ChatStore, acknowledge: jest.Mock) {
    const api: ChatSyncApi = {
      sync: jest.fn().mockResolvedValue({ messages: [], hidden: [], readStates: [], rooms: [], cursor: null, hasMore: false }),
      listRooms: jest.fn().mockResolvedValue({ rooms: [] }),
      listArchivedRooms: jest.fn().mockResolvedValue({ rooms: [] }),
      getRoom: jest.fn(),
      listMessages: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
      acknowledge,
    } as unknown as ChatSyncApi;
    return new ChatSyncEngine(store, api);
  }

  test('batches pending stored acks and marks them acknowledged', async () => {
    const store = new MemoryChatStore(ME);
    await store.putMedia(row('m-1', 'room-a', 10));
    await store.putMedia(row('m-2', 'room-a', 10));
    await store.putMedia(row('m-3', 'room-a', 10, { origin: 'sent', storedAcked: true }));
    const acknowledge = jest.fn().mockResolvedValue({ acknowledged: 2 });
    const engine = engineWith(store, acknowledge);
    await engine.sendStoredAcks();
    expect(acknowledge).toHaveBeenCalledTimes(1);
    const acks = acknowledge.mock.calls[0][0].acks;
    expect(acks.map((a: { messageId: string }) => a.messageId).sort()).toEqual(['m-1', 'm-2']);
    expect(acks.every((a: { state: string }) => a.state === 'stored')).toBe(true);
    expect(await store.pendingStoredAcks(10)).toEqual([]);
  });

  test('a transport failure leaves the acks pending for the next sync', async () => {
    const store = new MemoryChatStore(ME);
    await store.putMedia(row('m-1', 'room-a', 10));
    const acknowledge = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    const engine = engineWith(store, acknowledge);
    await engine.sendStoredAcks();
    expect(await store.pendingStoredAcks(10)).toEqual(['m-1']);
  });

  test('a 404 batch is retried one by one so a stale row cannot block the rest', async () => {
    const store = new MemoryChatStore(ME);
    await store.putMedia(row('m-1', 'room-a', 10));
    await store.putMedia(row('m-2', 'room-a', 10));
    const notFound = Object.assign(Object.create(ApiError.prototype) as ApiError, {
      status: 404,
      data: null,
      message: 'HTTP 404',
      name: 'ApiError',
    });
    const acknowledge = jest
      .fn()
      .mockImplementation(async ({ acks }: { acks: Array<{ messageId: string }> }) => {
        if (acks.length > 1 || acks[0].messageId === 'm-1') throw notFound;
        return { acknowledged: 1 };
      });
    const engine = engineWith(store, acknowledge);
    await engine.sendStoredAcks();
    // Both are settled locally: m-2 acknowledged, m-1 dropped as unknown to the server.
    expect(await store.pendingStoredAcks(10)).toEqual([]);
  });
});

// ── Integrity: the phone must really hold what it told the server it holds ──

describe('media integrity', () => {
  /** Indexes `msg` as a complete, stored-acked received copy with bytes on "disk". */
  async function kept(store: ChatStore, files: FakeFileOps, msg: ChatMessage, extra: Partial<MediaIndexRow> = {}) {
    const r = row(msg.id, msg.roomId, msg.sizeBytes ?? 1, { storedAcked: true, ...extra });
    files.files.set(r.localPath, r.sizeBytes);
    await store.upsertMessages([msg]);
    await store.putMedia(r);
    return r;
  }

  test('an intact file passes, is cached, and nothing is reported', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const onLost = jest.fn();
    const { dm } = manager(store, files, { onLost });
    const msg = media('image');
    const r = await kept(store, files, msg);
    expect(await dm.verify(msg)).toBe(true);
    // Cached: the file may vanish without another disk read inside the window.
    files.files.delete(r.localPath);
    expect(await dm.verify(msg)).toBe(true);
    expect(await store.getMedia(msg.id)).not.toBeNull();
    expect(await store.pendingLostAcks(10)).toEqual([]);
    expect(onLost).not.toHaveBeenCalled();
  });

  test('a missing stored-acked copy drops the row, queues a lost ack, reports and refetches when the policy allows', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const onLost = jest.fn();
    const onStored = jest.fn();
    const { dm } = manager(store, files, { onLost, onStored, verifyIntervalMs: 0 });
    const events: string[] = [];
    dm.subscribe(() => events.push(dm.status('m-1')?.state ?? 'none'));
    const msg = media('image', { id: 'm-1' });
    const r = await kept(store, files, msg);
    files.files.delete(r.localPath);

    expect(await dm.verify(msg)).toBe(false);
    expect(await store.pendingLostAcks(10)).toEqual(['m-1']);
    expect(onLost).toHaveBeenCalledTimes(1);
    // Went through `lost` before the auto policy queued it again.
    expect(events[0]).toBe('lost');
    expect(files.pending).toHaveLength(1);
    files.complete();
    await dm.idle();
    await settle();
    const fresh = await store.getMedia('m-1');
    expect(fresh).toMatchObject({ origin: 'received', storedAcked: false });
    expect(fresh!.localPath).not.toBe(r.localPath);
    expect(files.files.get(fresh!.localPath)).toBe(msg.sizeBytes);
    // The fresh copy supersedes the lost report and is pending a new stored ack.
    expect(await store.pendingLostAcks(10)).toEqual([]);
    expect(await store.pendingStoredAcks(10)).toEqual(['m-1']);
    expect(onStored).toHaveBeenCalledTimes(1);
    expect(dm.status('m-1')).toBeUndefined();
  });

  test('a file of the wrong size counts as lost and the leftover is deleted', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm } = manager(store, files, { settings: { ...DEFAULT_AUTO_DOWNLOAD, images: 'never' } });
    const msg = media('image', { id: 'm-1' });
    const r = await kept(store, files, msg);
    files.files.set(r.localPath, r.sizeBytes - 1);
    expect(await dm.verify(msg)).toBe(false);
    expect(files.deleted).toContain(r.localPath);
    expect(await store.getMedia('m-1')).toBeNull();
    // Policy says never: the bubble offers "save again" instead of refetching.
    expect(dm.status('m-1')).toEqual({ state: 'lost', manual: false });
    expect(files.pending).toHaveLength(0);
    // A tap saves it again from the server.
    dm.download(msg);
    expect(dm.status('m-1')).toEqual({ state: 'queued', manual: true });
    await settle();
    files.complete();
    await dm.idle();
    expect(await store.getMedia('m-1')).not.toBeNull();
    expect(dm.status('m-1')).toBeUndefined();
  });

  test('copies never reported as stored (own sends, pending acks) are refetched without a lost ack', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const onLost = jest.fn();
    const { dm } = manager(store, files, { onLost, settings: { ...DEFAULT_AUTO_DOWNLOAD, images: 'never', documents: 'never' } });
    const mine = media('image', { id: 'mine', senderId: ME });
    const unacked = media('file', { id: 'unacked' });
    const a = await kept(store, files, mine, { origin: 'sent' });
    const b = await kept(store, files, unacked, { storedAcked: false });
    files.files.delete(a.localPath);
    files.files.delete(b.localPath);
    expect(await dm.verify(mine)).toBe(false);
    expect(await dm.verify(unacked)).toBe(false);
    expect(await store.pendingLostAcks(10)).toEqual([]);
    expect(onLost).not.toHaveBeenCalled();
    expect(dm.status('mine')?.state).toBe('lost');
    expect(dm.status('unacked')?.state).toBe('lost');
  });

  test('when the relay copy is already gone the stale row is dropped and nothing is offered', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const onLost = jest.fn();
    const { dm } = manager(store, files, { onLost });
    const msg = media('image', { id: 'm-1', mediaState: 'purged' });
    const r = await kept(store, files, msg);
    files.files.delete(r.localPath);
    expect(await dm.verify(msg)).toBe(false);
    expect(await store.getMedia('m-1')).toBeNull();
    expect(await store.pendingLostAcks(10)).toEqual([]);
    expect(dm.status('m-1')).toBeUndefined();
    expect(files.pending).toHaveLength(0);
    expect(onLost).not.toHaveBeenCalled();
  });

  test('concurrent verify calls share one check; a stale check never discards a newer copy', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm } = manager(store, files, { verifyIntervalMs: 0 });
    const msg = media('image', { id: 'm-1' });
    const r = await kept(store, files, msg);
    files.files.delete(r.localPath);
    // Slow down the size probe so a re-download can land in between.
    const realSize = files.size.bind(files);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    files.size = async (path) => {
      await gate;
      return realSize(path);
    };
    const first = dm.verify(msg);
    const second = dm.verify(msg);
    expect(second).toBe(first);
    // A newer copy appears under a different path while the check is parked.
    const fresh = { ...r, localPath: r.localPath.replace('.bin', '.jpg'), createdAt: '2026-09-03T00:00:00.000Z' };
    files.files.set(fresh.localPath, fresh.sizeBytes);
    await store.putMedia(fresh);
    release();
    expect(await first).toBe(true);
    expect(await store.getMedia('m-1')).toMatchObject({ localPath: fresh.localPath });
    expect(await store.pendingLostAcks(10)).toEqual([]);
  });

  test('audit sweeps only rows whose relay copy still exists, throttles repeats and can be forced', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const onLost = jest.fn();
    const { dm } = manager(store, files, {
      onLost,
      verifyIntervalMs: 0,
      settings: { ...DEFAULT_AUTO_DOWNLOAD, images: 'never', documents: 'never', audio: 'never' },
    });
    const ok = media('image', { id: 'ok' });
    const gone = media('file', { id: 'gone' });
    const purged = media('audio', { id: 'purged', mediaState: 'purged' });
    const deleted = media('image', { id: 'deleted', deletedAt: '2026-09-02T00:00:00.000Z' });
    await kept(store, files, ok);
    const g = await kept(store, files, gone);
    const p = await kept(store, files, purged);
    const d = await kept(store, files, deleted);
    files.files.delete(g.localPath);
    files.files.delete(p.localPath);
    files.files.delete(d.localPath);

    expect(await dm.audit()).toEqual({ checked: 2, lost: 1 });
    expect(await store.pendingLostAcks(10)).toEqual(['gone']);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(dm.status('gone')?.state).toBe('lost');
    // Purged/deleted rows are left alone: nothing can restore them, and the
    // stale row still tells the user what this phone once held.
    expect(await store.getMedia('purged')).not.toBeNull();
    expect(await store.getMedia('deleted')).not.toBeNull();
    // Throttled within the interval; forced runs again.
    expect(await dm.audit()).toEqual({ checked: 0, lost: 0 });
    expect(await dm.audit(true)).toEqual({ checked: 1, lost: 0 });
  });

  test('clearRoom forgets lost offers for that room but keeps the pending lost ack', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const { dm } = manager(store, files, { settings: { ...DEFAULT_AUTO_DOWNLOAD, images: 'never' } });
    const msg = media('image', { id: 'm-1' });
    const r = await kept(store, files, msg);
    files.files.delete(r.localPath);
    expect(await dm.verify(msg)).toBe(false);
    expect(dm.status('m-1')?.state).toBe('lost');
    await dm.clearRoom('room-a', msg.createdAt);
    expect(dm.status('m-1')).toBeUndefined();
    expect(await store.pendingLostAcks(10)).toEqual(['m-1']);
  });

  test('mediaSummary counts files whose relay copy is gone as only-on-this-phone', async () => {
    const store = new MemoryChatStore(ME);
    const files = new FakeFileOps();
    const live = media('image', { id: 'live', sizeBytes: 100 });
    const purged = media('image', { id: 'purged', sizeBytes: 200, mediaState: 'purged' });
    const expired = media('video', { id: 'expired', sizeBytes: 300, mediaState: 'expired' });
    const deleted = media('file', { id: 'deleted', sizeBytes: 400, deletedAt: '2026-09-02T00:00:00.000Z' });
    for (const m of [live, purged, expired, deleted]) await kept(store, files, m);
    // A queued send has no message row yet: counted as held, never as only-here.
    await store.putMedia(row(outboxMediaKey('req-1'), 'room-a', 50, { origin: 'sent', storedAcked: true }));
    expect(await store.mediaSummary()).toEqual({
      files: 5,
      bytes: 1050,
      onlyOnDeviceFiles: 3,
      onlyOnDeviceBytes: 900,
    });
    expect((await store.listRecoverableMedia()).map((r) => r.media.messageId)).toEqual(['live']);
  });
});

describe('lost acks', () => {
  function engineWith(store: ChatStore, acknowledge: jest.Mock) {
    const api: ChatSyncApi = {
      sync: jest.fn().mockResolvedValue({
        messages: [],
        hidden: [],
        readStates: [],
        receipts: [],
        preferences: [],
        rooms: [],
        nextCursor: null,
        hasMore: false,
      }),
      roomsList: jest.fn().mockResolvedValue({ rooms: [] }),
      archivedRoomsList: jest.fn().mockResolvedValue({ rooms: [] }),
      roomGet: jest.fn(),
      messagesList: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
      acknowledge,
    };
    return new ChatSyncEngine(store, api);
  }

  test('queued lost reports are sent as `lost` acks and settled; duplicates collapse', async () => {
    const store = new MemoryChatStore(ME);
    await store.queueLostAcks([{ messageId: 'm-1', roomId: 'room-a' }]);
    await store.queueLostAcks([{ messageId: 'm-1', roomId: 'room-a' }, { messageId: 'm-2', roomId: 'room-a' }]);
    const acknowledge = jest.fn().mockResolvedValue({ acknowledged: 2 });
    const engine = engineWith(store, acknowledge);
    await engine.sendLostAcks();
    expect(acknowledge).toHaveBeenCalledTimes(1);
    const acks = acknowledge.mock.calls[0][0].acks;
    expect(acks.map((a: { messageId: string }) => a.messageId).sort()).toEqual(['m-1', 'm-2']);
    expect(acks.every((a: { state: string }) => a.state === 'lost')).toBe(true);
    expect(await store.pendingLostAcks(10)).toEqual([]);
  });

  test('a transport failure leaves the lost report pending for the next sync', async () => {
    const store = new MemoryChatStore(ME);
    await store.queueLostAcks([{ messageId: 'm-1', roomId: 'room-a' }]);
    const acknowledge = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    const engine = engineWith(store, acknowledge);
    await engine.sendLostAcks();
    expect(await store.pendingLostAcks(10)).toEqual(['m-1']);
  });

  test('a fresh download supersedes a pending lost report', async () => {
    const store = new MemoryChatStore(ME);
    await store.queueLostAcks([{ messageId: 'm-1', roomId: 'room-a' }]);
    await store.putMedia(row('m-1', 'room-a', 10));
    expect(await store.pendingLostAcks(10)).toEqual([]);
    expect(await store.pendingStoredAcks(10)).toEqual(['m-1']);
  });

  test('a sync pass sends lost reports before stored acks', async () => {
    const store = new MemoryChatStore(ME);
    await store.queueLostAcks([{ messageId: 'lost-1', roomId: 'room-a' }]);
    await store.putMedia(row('stored-1', 'room-a', 10));
    const acknowledge = jest.fn().mockResolvedValue({ acknowledged: 1 });
    const engine = engineWith(store, acknowledge);
    await engine.prime();
    let status: { error: string | null } | null = null;
    engine.subscribe((next) => {
      status = next;
    });
    await engine.requestSync('manual');
    expect(status).toMatchObject({ error: null });
    const states = acknowledge.mock.calls.map((c) => c[0].acks[0].state);
    expect(states).toEqual(['lost', 'stored']);
  });
});
