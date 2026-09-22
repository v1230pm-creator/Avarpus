import {
  ApiError,
  chatAcknowledge,
  chatMessagesList,
  chatRoomsArchivedList,
  chatRoomsGet,
  chatRoomsList,
  chatSync,
  type ChatAckInput,
  type ChatAckResult,
  type ChatMessage,
  type ChatMessagesList200,
  type ChatMessagesListParams,
  type ChatRoom,
  type ChatSyncParams,
  type ChatSyncResult,
} from '@workspace/api-client-react';
import { META_KEYS, type ChatStore } from '@/utils/chatStore';

/**
 * Network side of the sync engine, injectable so the merge/ordering rules can
 * be tested against scripted responses without a server.
 */
export interface ChatSyncApi {
  roomsList(): Promise<{ rooms: ChatRoom[] }>;
  archivedRoomsList(): Promise<{ rooms: ChatRoom[] }>;
  roomGet(roomId: string): Promise<{ room: ChatRoom }>;
  sync(params: ChatSyncParams): Promise<ChatSyncResult>;
  acknowledge(input: ChatAckInput): Promise<ChatAckResult>;
  messagesList(roomId: string, params: ChatMessagesListParams): Promise<ChatMessagesList200>;
}

export const liveChatSyncApi: ChatSyncApi = {
  roomsList: () => chatRoomsList(),
  archivedRoomsList: () => chatRoomsArchivedList(),
  roomGet: (roomId) => chatRoomsGet(roomId),
  sync: (params) => chatSync(params),
  acknowledge: (input) => chatAcknowledge(input),
  messagesList: (roomId, params) => chatMessagesList(roomId, params),
};

export type SyncReason =
  | 'start'
  | 'foreground'
  | 'push'
  | 'inbox'
  | 'conversation'
  | 'after-send'
  | 'poll'
  | 'manual'
  | 'reconnect'
  /** A received attachment finished downloading; report the stored copy. */
  | 'media';

export interface ChatSyncStatus {
  /** Device believes it has connectivity (from the network listener). */
  online: boolean;
  /** A sync pass is in flight. */
  syncing: boolean;
  /** The last sync pass failed; the value is a short user-facing reason. */
  error: string | null;
  lastSyncedAt: string | null;
  /** Room list has been loaded at least once (locally or from the server). */
  bootstrapped: boolean;
}

const SYNC_PAGE_LIMIT = 200;
const MAX_PAGES_PER_PASS = 25;
const ACK_BATCH = 200;
export const HISTORY_PAGE = 50;

function isNetworkFailure(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 408 || err.status === 429 || err.status >= 500;
  return true; // TypeError: Network request failed, aborts, DNS, etc.
}

function errorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const data = err.data as { code?: unknown; error?: unknown } | null;
  const code = data?.code ?? data?.error;
  return typeof code === 'string' ? code : null;
}

export function describeSyncError(err: unknown): string {
  if (err instanceof ApiError) {
    const data = err.data as { message?: unknown } | null;
    if (typeof data?.message === 'string' && data.message) return data.message;
    return `Sync failed (${err.status}).`;
  }
  return 'Waiting for connection…';
}

/**
 * Single coordinator that keeps the device store in step with the server.
 *
 * - A first pass bootstraps the room list (active + archived) from the list
 *   endpoints, because the delta feed's initial window only covers recent
 *   membership changes and carries no inbox previews.
 * - Every pass then drains the delta feed from the stored cursor, upserts the
 *   rows, sends `delivered` acks for the incoming messages it stored, and
 *   records the new cursor.
 * - Older history is backfilled per room on demand through the existing
 *   `before` pagination, once, and served from local rows afterwards.
 *
 * Passes are coalesced: a request that arrives while one is running schedules
 * exactly one more pass, so bursts of pushes/foreground events do not stack.
 */
export class ChatSyncEngine {
  private status: ChatSyncStatus = {
    online: true,
    syncing: false,
    error: null,
    lastSyncedAt: null,
    bootstrapped: false,
  };
  private listeners = new Set<(status: ChatSyncStatus) => void>();
  private running: Promise<void> | null = null;
  private rerun = false;
  private stopped = false;
  private backfills = new Map<string, Promise<{ fetched: number; done: boolean }>>();
  private roomFetches = new Map<string, Promise<boolean>>();

  private messageListeners = new Set<(messages: ChatMessage[]) => void>();

  constructor(
    private readonly store: ChatStore,
    private readonly api: ChatSyncApi = liveChatSyncApi,
  ) {}

  /**
   * Fires after a page of server messages was written to the store (delta
   * sync or history backfill). The media downloader hangs off this to apply
   * the auto-download policy to newly arrived attachments.
   */
  onMessagesApplied(listener: (messages: ChatMessage[]) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  private emitMessages(messages: ChatMessage[]): void {
    if (messages.length === 0) return;
    for (const listener of this.messageListeners) listener(messages);
  }

  getStatus(): ChatSyncStatus {
    return this.status;
  }

  subscribe(listener: (status: ChatSyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setStatus(patch: Partial<ChatSyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of [...this.listeners]) listener(this.status);
  }

  setOnline(online: boolean): void {
    if (this.status.online === online) return;
    this.setStatus({ online, error: online ? this.status.error : null });
  }

  stop(): void {
    this.stopped = true;
  }

  /** Reads the stored bootstrap flag so the UI knows local data exists. */
  async prime(): Promise<void> {
    const bootstrapped = (await this.store.getMeta(META_KEYS.BOOTSTRAPPED)) === '1';
    const lastSyncedAt = await this.store.getMeta(META_KEYS.LAST_SYNCED_AT);
    this.setStatus({ bootstrapped, lastSyncedAt });
  }

  /** Runs (or schedules) one sync pass; resolves when the requested pass ends. */
  requestSync(_reason: SyncReason): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.runPass()
      .catch(() => {})
      .finally(() => {
        this.running = null;
        if (this.rerun && !this.stopped) {
          this.rerun = false;
          void this.requestSync('manual');
        }
      });
    return this.running;
  }

  private async runPass(): Promise<void> {
    this.setStatus({ syncing: true });
    try {
      if ((await this.store.getMeta(META_KEYS.BOOTSTRAPPED)) !== '1') {
        await this.bootstrapRooms();
      }
      await this.drainDeltas();
      await this.sendDeliveredAcks();
      // Lost before stored: a copy found missing and then fetched again in the
      // same pass must end the pass as `stored`, never the other way round.
      await this.sendLostAcks();
      await this.sendStoredAcks();
      const now = new Date().toISOString();
      await this.store.setMeta(META_KEYS.LAST_SYNCED_AT, now);
      this.setStatus({ syncing: false, error: null, lastSyncedAt: now, online: true });
    } catch (err) {
      this.setStatus({
        syncing: false,
        error: describeSyncError(err),
        online: isNetworkFailure(err) && !(err instanceof ApiError) ? false : this.status.online,
      });
      throw err;
    }
  }

  private async bootstrapRooms(): Promise<void> {
    const [active, archived] = await Promise.all([this.api.roomsList(), this.api.archivedRoomsList()]);
    await this.store.batch(async () => {
      await this.store.upsertRooms([...active.rooms, ...archived.rooms]);
      await this.store.setMeta(META_KEYS.BOOTSTRAPPED, '1');
    });
    this.setStatus({ bootstrapped: true });
  }

  /** Re-pulls the room list (metadata such as names, photos and block state). */
  async refreshRooms(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.bootstrapRooms();
    } catch {
      // Room metadata refresh is opportunistic; deltas still flow.
    }
  }

  private async drainDeltas(): Promise<void> {
    let cursor = await this.store.getMeta(META_KEYS.SYNC_CURSOR);
    for (let page = 0; page < MAX_PAGES_PER_PASS; page += 1) {
      let result: ChatSyncResult;
      try {
        result = await this.api.sync({ ...(cursor ? { cursor } : {}), limit: SYNC_PAGE_LIMIT });
      } catch (err) {
        const code = errorCode(err);
        if (err instanceof ApiError && err.status === 400 && cursor && code && /CURSOR/i.test(code)) {
          // The server no longer understands our cursor: restart from the
          // initial window. Rows already stored stay; upserts are idempotent.
          await this.store.setMeta(META_KEYS.SYNC_CURSOR, null);
          cursor = null;
          continue;
        }
        throw err;
      }
      await this.applyPage(result);
      cursor = result.nextCursor;
      await this.store.setMeta(META_KEYS.SYNC_CURSOR, cursor);
      if (!result.hasMore) return;
    }
    // More than MAX_PAGES pending: let the next pass continue from the cursor.
    this.rerun = true;
  }

  private async applyPage(result: ChatSyncResult): Promise<void> {
    // Messages for rooms the store has never seen (joined after bootstrap and
    // the membership entry has not arrived, or arrived in a later page) need
    // their room row before they can render.
    const unknownRooms = new Set<string>();
    for (const message of result.messages) {
      if (!(await this.store.hasRoom(message.roomId)) && !result.rooms.some((r) => r.id === message.roomId)) {
        unknownRooms.add(message.roomId);
      }
    }
    await Promise.all([...unknownRooms].map((roomId) => this.ensureRoom(roomId)));
    await this.store.batch(async () => {
      if (result.backfillBefore) {
        // Everything created after this instant arrives through the delta
        // feed; older history is fetched per room with `before` pagination.
        const floor = await this.store.getMeta(META_KEYS.HISTORY_FLOOR);
        if (!floor || result.backfillBefore < floor) {
          await this.store.setMeta(META_KEYS.HISTORY_FLOOR, result.backfillBefore);
        }
      }
      await this.store.upsertRooms(result.rooms);
      await this.store.upsertMessages(result.messages);
      await this.store.applyHidden(result.hidden);
      await this.store.applyReadStates(result.readStates);
      await this.store.applyReceipts(result.receipts);
      await this.store.applyPreferences(result.preferences);
    });
    this.emitMessages(result.messages);
  }

  /** Fetches and stores a room the local store does not have yet. */
  ensureRoom(roomId: string): Promise<boolean> {
    const inFlight = this.roomFetches.get(roomId);
    if (inFlight) return inFlight;
    const task = (async () => {
      if (await this.store.hasRoom(roomId)) return true;
      try {
        const { room } = await this.api.roomGet(roomId);
        await this.store.upsertRooms([room]);
        return true;
      } catch {
        return false;
      } finally {
        this.roomFetches.delete(roomId);
      }
    })();
    this.roomFetches.set(roomId, task);
    return task;
  }

  /** Stores a freshly fetched room payload (e.g. from the conversation header poll). */
  async recordRoom(room: ChatRoom): Promise<void> {
    await this.store.upsertRooms([room]);
  }

  private async sendDeliveredAcks(): Promise<void> {
    for (let round = 0; round < 20; round += 1) {
      const ids = await this.store.pendingDeliveredAcks(ACK_BATCH);
      if (ids.length === 0) return;
      try {
        await this.api.acknowledge({ acks: ids.map((messageId) => ({ messageId, state: 'delivered' })) });
        await this.store.markAcknowledged(ids);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // One unknown id fails the whole batch; settle the rest one by one
          // so a single stale row cannot block every later acknowledgement.
          await this.acknowledgeIndividually(ids);
          continue;
        }
        if (err instanceof ApiError && err.status === 401) throw err;
        // Network trouble: retry on the next pass.
        return;
      }
      if (ids.length < ACK_BATCH) return;
    }
  }

  private async acknowledgeIndividually(ids: string[]): Promise<void> {
    for (const messageId of ids) {
      try {
        await this.api.acknowledge({ acks: [{ messageId, state: 'delivered' }] });
        await this.store.markAcknowledged([messageId]);
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          await this.store.markAcknowledged([messageId]);
          continue;
        }
        return;
      }
    }
  }

  /**
   * Tells the server which received attachments now live on this device
   * (`stored` acks). Same batching and settle rules as delivered acks; the
   * server may drop its relay copy once every recipient has reported this.
   */
  async sendStoredAcks(): Promise<void> {
    for (let round = 0; round < 20; round += 1) {
      const ids = await this.store.pendingStoredAcks(ACK_BATCH);
      if (ids.length === 0) return;
      try {
        await this.api.acknowledge({ acks: ids.map((messageId) => ({ messageId, state: 'stored' })) });
        await this.store.markStoredAcknowledged(ids);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          await this.acknowledgeStoredIndividually(ids);
          continue;
        }
        if (err instanceof ApiError && err.status === 401) throw err;
        return;
      }
      if (ids.length < ACK_BATCH) return;
    }
  }

  private async acknowledgeStoredIndividually(ids: string[]): Promise<void> {
    for (const messageId of ids) {
      try {
        await this.api.acknowledge({ acks: [{ messageId, state: 'stored' }] });
        await this.store.markStoredAcknowledged([messageId]);
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          await this.store.markStoredAcknowledged([messageId]);
          continue;
        }
        return;
      }
    }
  }

  /**
   * Tells the server which attachments this device had reported as stored but
   * has since found missing (`lost` acks), so the relay keeps its copy until a
   * fresh `stored` arrives. The server ignores (never rejects) acks for media
   * it has already dropped, so a batch either lands whole or is retried; a 404
   * (a stale row the caller can no longer see) falls back to one-by-one.
   */
  async sendLostAcks(): Promise<void> {
    for (let round = 0; round < 20; round += 1) {
      const ids = await this.store.pendingLostAcks(ACK_BATCH);
      if (ids.length === 0) return;
      try {
        await this.api.acknowledge({ acks: ids.map((messageId) => ({ messageId, state: 'lost' })) });
        await this.store.markLostAcknowledged(ids);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          await this.acknowledgeLostIndividually(ids);
          continue;
        }
        if (err instanceof ApiError && err.status === 401) throw err;
        return;
      }
      if (ids.length < ACK_BATCH) return;
    }
  }

  private async acknowledgeLostIndividually(ids: string[]): Promise<void> {
    for (const messageId of ids) {
      try {
        await this.api.acknowledge({ acks: [{ messageId, state: 'lost' }] });
        await this.store.markLostAcknowledged([messageId]);
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          await this.store.markLostAcknowledged([messageId]);
          continue;
        }
        return;
      }
    }
  }

  /**
   * Loads one older page for a room from the server when local history is
   * exhausted and the room has not been fully backfilled yet. Serves as the
   * initial page too when a room has no local rows.
   */
  loadOlder(roomId: string): Promise<{ fetched: number; done: boolean }> {
    const inFlight = this.backfills.get(roomId);
    if (inFlight) return inFlight;
    const task = (async () => {
      const doneKey = META_KEYS.backfillDone(roomId);
      if ((await this.store.getMeta(doneKey)) === '1') return { fetched: 0, done: true };
      // Local rows are contiguous from "now" down to the room's floor: the
      // oldest page fetched so far, else the delta feed's initial window
      // start. Stray older rows (tombstones re-served by the feed) must not
      // move the floor or the gap between them would never be filled.
      const floorKey = META_KEYS.backfillFloor(roomId);
      const before =
        (await this.store.getMeta(floorKey)) ??
        (await this.store.getMeta(META_KEYS.HISTORY_FLOOR)) ??
        (await this.store.oldestMessageAt(roomId));
      const page = await this.api.messagesList(roomId, {
        ...(before ? { before } : {}),
        limit: HISTORY_PAGE,
      });
      await this.store.batch(async () => {
        await this.store.upsertMessages(page.messages);
        const oldest = page.messages.reduce<string | null>(
          (min, m) => (min === null || m.createdAt < min ? m.createdAt : min),
          null,
        );
        if (oldest) await this.store.setMeta(floorKey, oldest);
        if (!page.hasMore) await this.store.setMeta(doneKey, '1');
      });
      this.emitMessages(page.messages);
      return { fetched: page.messages.length, done: !page.hasMore };
    })().finally(() => this.backfills.delete(roomId));
    this.backfills.set(roomId, task);
    return task;
  }

  async isBackfillDone(roomId: string): Promise<boolean> {
    return (await this.store.getMeta(META_KEYS.backfillDone(roomId))) === '1';
  }
}
