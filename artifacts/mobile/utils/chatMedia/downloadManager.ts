import type { ChatMessage } from '@workspace/api-client-react';
import type { ChatStore, MediaIndexRow } from '@/utils/chatStore';
import { mediaExtensionFor, type MediaFileOps } from './files';
import {
  isMediaKind,
  relayAvailable,
  shouldAutoDownload,
  type AutoDownloadSettings,
  type NetworkClass,
} from './policy';

/**
 * Per-message download progress as seen by the UI. Absent means the message
 * is either already on disk (check the index) or nothing is happening.
 * `lost`: this device's saved copy was found missing or damaged while the
 * server still holds the bytes, so the bubble offers to save it again.
 */
export interface MediaDownloadStatus {
  state: 'queued' | 'downloading' | 'failed' | 'lost';
  /** The user asked for it; policy and network class are not consulted. */
  manual: boolean;
  error?: string;
}

export interface MediaAuditResult {
  /** Indexed files whose bytes were compared against the index. */
  checked: number;
  /** Files found missing or damaged (index row dropped, `lost` handling applied). */
  lost: number;
}

export interface MediaDownloadOptions {
  files: MediaFileOps;
  /** Bearer token for the authenticated media endpoint (null = signed out). */
  authToken: () => string | null;
  mediaUrl: (roomId: string, messageId: string) => string;
  settings: () => AutoDownloadSettings;
  network: () => NetworkClass;
  /** Parallel downloads; the relay is shared with sends so keep it small. */
  concurrency?: number;
  /** Called after a verified file was indexed (e.g. to flush `stored` acks). */
  onStored?: (message: ChatMessage) => void;
  /**
   * Called after a copy this device had reported as stored was found missing
   * while the relay still has the bytes (e.g. to flush the queued `lost` ack).
   */
  onLost?: (message: ChatMessage) => void;
  /** A file verified this recently is trusted without touching disk again. */
  verifyIntervalMs?: number;
  /** Full sweeps of the index (`audit`) run no more often than this. */
  auditIntervalMs?: number;
  now?: () => string;
}

const DEFAULT_VERIFY_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_AUDIT_INTERVAL_MS = 15 * 60 * 1000;

type Listener = (messageIds: Set<string>) => void;

/** Store meta key holding the auto-download watermark for a cleared room. */
export function mediaClearedAtKey(roomId: string): string {
  return `media_cleared_at:${roomId}`;
}

/**
 * Downloads received attachments into app-private storage and indexes them.
 *
 * State machine per message: (absent) → queued → downloading → (absent, on
 * disk) | failed. The index is written only after the file was size-verified
 * and renamed into place, so a crash mid-download leaves nothing indexed and
 * the next attempt starts clean. Failed rows wait for a tap (manual retry);
 * auto downloads are never retried in a loop against a dead relay.
 *
 * The viewer's own attachments are candidates too: sends made before this
 * device kept originals (or whose copy was cleared) are fetched back from the
 * relay like any other attachment, indexed as `sent` and never `stored`-acked.
 *
 * Clearing a room's media (`clearRoom`) cancels its queued and in-flight
 * downloads and records a watermark so the auto policy does not immediately
 * refill the room; anything at or before the watermark is manual-only.
 *
 * Integrity: an index row is a promise that the bytes are on disk, and the
 * server relies on that promise (`stored` receipts license the relay purge).
 * `verify` re-checks a file's size against its row when a bubble renders it
 * and `audit` sweeps every row whose relay copy still exists. A file that is
 * missing or the wrong size is treated as gone: its row is dropped, the
 * server is told (`lost` ack, only for copies it was told were stored) so the
 * purge waits for a fresh `stored`, and the message goes to the `lost` state
 * — re-fetched straight away when the auto policy allows, otherwise offered
 * as "save again" in the bubble. Loss is never inferred for media whose relay
 * copy is already gone beyond dropping the stale row: nothing can bring it
 * back, and the bubble's "no longer available" placeholder is the truth.
 */
export class ChatMediaDownloadManager {
  private statuses = new Map<string, MediaDownloadStatus>();
  private queue: ChatMessage[] = [];
  private active = 0;
  private stopped = false;
  private listeners = new Set<Listener>();
  private readonly concurrency: number;
  private readonly verifyIntervalMs: number;
  private readonly auditIntervalMs: number;
  /** Bumped by clearRoom; an in-flight download from an older epoch is discarded. */
  private roomEpoch = new Map<string, number>();
  /** Room of every message that currently has a status (for clearRoom). */
  private roomOf = new Map<string, string>();
  /** Auto-download watermark per room (ISO createdAt), lazily read from store meta. */
  private clearedAt = new Map<string, Promise<string | null>>();
  /** Epoch ms of the last successful size check per message. */
  private verifiedAt = new Map<string, number>();
  private verifying = new Map<string, Promise<boolean>>();
  private lastAuditAt: number | null = null;
  private auditing: Promise<MediaAuditResult> | null = null;

  constructor(
    private readonly store: ChatStore,
    private readonly options: MediaDownloadOptions,
  ) {
    this.concurrency = Math.max(1, options.concurrency ?? 2);
    this.verifyIntervalMs = Math.max(0, options.verifyIntervalMs ?? DEFAULT_VERIFY_INTERVAL_MS);
    this.auditIntervalMs = Math.max(0, options.auditIntervalMs ?? DEFAULT_AUDIT_INTERVAL_MS);
  }

  get accountId(): string {
    return this.store.accountId;
  }

  status(messageId: string): MediaDownloadStatus | undefined {
    return this.statuses.get(messageId);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(ids: Iterable<string>): void {
    const set = new Set(ids);
    if (set.size === 0) return;
    for (const listener of this.listeners) listener(set);
  }

  /** A message whose bytes the device could keep a copy of (own sends included). */
  isCandidate(message: ChatMessage): boolean {
    return isMediaKind(message.kind) && relayAvailable(message) && !message.id.startsWith('out-');
  }

  private isOwn(message: ChatMessage): boolean {
    return message.senderId === this.store.accountId;
  }

  private clearedWatermark(roomId: string): Promise<string | null> {
    let pending = this.clearedAt.get(roomId);
    if (!pending) {
      pending = this.store.getMeta(mediaClearedAtKey(roomId)).catch(() => null);
      this.clearedAt.set(roomId, pending);
    }
    return pending;
  }

  /** Auto policy never refills a room the user cleared; a tap still works. */
  private async autoSuppressed(message: ChatMessage): Promise<boolean> {
    const watermark = await this.clearedWatermark(message.roomId);
    return !!watermark && message.createdAt <= watermark;
  }

  /**
   * Applies the auto-download policy to freshly synced messages. Messages
   * already on disk, already queued or previously failed are left alone.
   */
  async consider(messages: ChatMessage[]): Promise<void> {
    if (this.stopped) return;
    // A `lost` row is a candidate again: the copy is gone and may be refetched.
    const idle = (id: string) => {
      const state = this.statuses.get(id)?.state;
      return state === undefined || state === 'lost';
    };
    const candidates = messages.filter((m) => this.isCandidate(m) && idle(m.id));
    if (candidates.length === 0) return;
    const indexed = await this.store.getMediaMany(candidates.map((m) => m.id));
    const settings = this.options.settings();
    const network = this.options.network();
    const queued: string[] = [];
    for (const message of candidates) {
      if (indexed.has(message.id) || !idle(message.id)) continue;
      if (!shouldAutoDownload(message.kind, settings, network)) continue;
      if (await this.autoSuppressed(message)) continue;
      if (this.stopped || !idle(message.id)) continue;
      this.statuses.set(message.id, { state: 'queued', manual: false });
      this.roomOf.set(message.id, message.roomId);
      this.queue.push(message);
      queued.push(message.id);
    }
    this.notify(queued);
    this.pump();
  }

  /** User tapped an attachment (or retried a failed one): download regardless of policy. */
  download(message: ChatMessage): void {
    if (this.stopped || !this.isCandidate(message)) return;
    const current = this.statuses.get(message.id);
    if (current?.state === 'downloading') return;
    if (current?.state === 'queued') {
      // Promote so a tap is not stuck behind auto downloads.
      this.statuses.set(message.id, { state: 'queued', manual: true });
      this.queue = [message, ...this.queue.filter((m) => m.id !== message.id)];
    } else {
      this.statuses.set(message.id, { state: 'queued', manual: true });
      this.roomOf.set(message.id, message.roomId);
      this.queue.unshift(message);
    }
    this.notify([message.id]);
    this.pump();
  }

  /**
   * Network class changed: auto downloads that the policy no longer permits
   * (e.g. a video queued on Wi-Fi when the phone moved to cellular) are
   * dropped back to manual; manual ones stay queued for when we are online.
   */
  networkChanged(): void {
    const network = this.options.network();
    const settings = this.options.settings();
    const dropped: string[] = [];
    this.queue = this.queue.filter((message) => {
      const status = this.statuses.get(message.id);
      if (!status || status.manual) return true;
      if (shouldAutoDownload(message.kind, settings, network)) return true;
      this.statuses.delete(message.id);
      dropped.push(message.id);
      return false;
    });
    this.notify(dropped);
    this.pump();
  }

  /** Forget a failure so the bubble shows the plain download affordance again. */
  clearFailure(messageId: string): void {
    if (this.statuses.get(messageId)?.state === 'failed') {
      this.statuses.delete(messageId);
      this.notify([messageId]);
    }
  }

  /**
   * The user is clearing a room's media: drop its queued downloads, make any
   * in-flight ones discard their result, and remember the newest message so
   * the auto policy does not fetch the same attachments straight back.
   * Runs before the index rows and files are removed.
   */
  async clearRoom(roomId: string, watermark: string): Promise<void> {
    this.roomEpoch.set(roomId, (this.roomEpoch.get(roomId) ?? 0) + 1);
    const dropped: string[] = [];
    this.queue = this.queue.filter((message) => {
      if (message.roomId !== roomId) return true;
      this.statuses.delete(message.id);
      this.roomOf.delete(message.id);
      dropped.push(message.id);
      return false;
    });
    for (const [messageId, status] of [...this.statuses]) {
      if ((status.state === 'failed' || status.state === 'lost') && this.roomOf.get(messageId) === roomId) {
        this.statuses.delete(messageId);
        this.roomOf.delete(messageId);
        dropped.push(messageId);
      }
    }
    this.notify(dropped);
    const previous = await this.clearedWatermark(roomId);
    const next = previous && previous > watermark ? previous : watermark;
    this.clearedAt.set(roomId, Promise.resolve(next));
    await this.store.setMeta(mediaClearedAtKey(roomId), next).catch(() => {});
  }

  stop(): void {
    this.stopped = true;
    const ids = [...this.statuses.keys()];
    this.queue = [];
    this.statuses.clear();
    this.roomOf.clear();
    this.verifiedAt.clear();
    this.notify(ids);
  }

  // ── Integrity ────────────────────────────────────────────────────────────

  /**
   * Confirms the indexed file for `message` is still on disk at the recorded
   * size. Cheap to call from a rendering bubble: a file checked within
   * `verifyIntervalMs` is trusted without touching disk and concurrent calls
   * share one check. Resolves true when the copy is intact (or there is
   * nothing indexed to check) and false when it was found missing, in which
   * case the loss has already been handled (see class docs).
   */
  verify(message: ChatMessage, known?: MediaIndexRow): Promise<boolean> {
    if (this.stopped || message.id.startsWith('out-')) return Promise.resolve(true);
    const last = this.verifiedAt.get(message.id);
    if (last !== undefined && Date.now() - last < this.verifyIntervalMs) return Promise.resolve(true);
    const inFlight = this.verifying.get(message.id);
    if (inFlight) return inFlight;
    const run = this.checkFile(message, known).finally(() => {
      this.verifying.delete(message.id);
    });
    this.verifying.set(message.id, run);
    return run;
  }

  private async checkFile(message: ChatMessage, known?: MediaIndexRow): Promise<boolean> {
    const row = known ?? (await this.store.getMedia(message.id));
    if (!row) return true;
    if (await this.intact(row)) {
      this.verifiedAt.set(message.id, Date.now());
      return true;
    }
    // Re-read: a download that finished while we looked has its own fresh
    // row and must not be thrown away on the strength of a stale check.
    const current = await this.store.getMedia(message.id);
    if (!current || current.localPath !== row.localPath || current.createdAt !== row.createdAt) return true;
    if (this.stopped) return true;
    this.verifiedAt.delete(message.id);
    await this.store.removeMedia([message.id]);
    // A truncated leftover would only be mistaken for a copy again.
    await this.options.files.deleteFile(current.localPath).catch(() => {});
    if (!relayAvailable(message)) {
      // Nothing can restore it; the bubble now shows the unavailable placeholder.
      this.notify([message.id]);
      return false;
    }
    if (current.origin === 'received' && current.storedAcked) {
      // The server was told this copy existed and may be counting on it.
      await this.store.queueLostAcks([{ messageId: message.id, roomId: message.roomId }]);
    }
    const status = this.statuses.get(message.id);
    if (!status || status.state === 'failed') {
      this.statuses.set(message.id, { state: 'lost', manual: false });
      this.roomOf.set(message.id, message.roomId);
    }
    this.notify([message.id]);
    if (current.origin === 'received' && current.storedAcked) this.options.onLost?.(message);
    // Fetch it straight back when the auto policy allows; otherwise the bubble
    // offers "save again" while the relay still has it.
    await this.consider([message]);
    return false;
  }

  /** Size is the only integrity signal (see files.ts); a transient miss is re-read once. */
  private async intact(row: MediaIndexRow): Promise<boolean> {
    const matches = (size: number | null) => size !== null && size === row.sizeBytes;
    if (matches(await this.options.files.size(row.localPath))) return true;
    return matches(await this.options.files.size(row.localPath));
  }

  /**
   * Sweeps every indexed file whose relay copy still exists and verifies it,
   * so a loss is reported while the server can still be told to wait — not
   * when the user finally scrolls to the message. Throttled to
   * `auditIntervalMs` unless forced; one sweep runs at a time and yields
   * between files so a large library never stalls the JS thread.
   */
  audit(force = false): Promise<MediaAuditResult> {
    if (this.stopped) return Promise.resolve({ checked: 0, lost: 0 });
    if (this.auditing) return this.auditing;
    const now = Date.now();
    if (!force && this.lastAuditAt !== null && now - this.lastAuditAt < this.auditIntervalMs) {
      return Promise.resolve({ checked: 0, lost: 0 });
    }
    this.lastAuditAt = now;
    const run = this.sweep().finally(() => {
      this.auditing = null;
    });
    this.auditing = run;
    return run;
  }

  private async sweep(): Promise<MediaAuditResult> {
    const result: MediaAuditResult = { checked: 0, lost: 0 };
    const rows = await this.store.listRecoverableMedia();
    for (const { media, message } of rows) {
      if (this.stopped) break;
      if (!this.isCandidate(message)) continue;
      result.checked += 1;
      if (!(await this.verify(message, media))) result.lost += 1;
      if (result.checked % 25 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return result;
  }

  /** Resolves when nothing is queued or in flight (test helper). */
  async idle(): Promise<void> {
    while (this.active > 0 || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  private pump(): void {
    while (!this.stopped && this.active < this.concurrency && this.queue.length > 0) {
      if (this.options.network() === 'offline') return;
      const next = this.queue.shift()!;
      this.active += 1;
      void this.run(next).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async run(message: ChatMessage): Promise<void> {
    const status = this.statuses.get(message.id);
    if (!status) return; // dropped while queued
    if (await this.store.getMedia(message.id)) {
      this.statuses.delete(message.id);
      this.notify([message.id]);
      return;
    }
    this.statuses.set(message.id, { state: 'downloading', manual: status.manual });
    this.notify([message.id]);
    const epoch = this.roomEpoch.get(message.roomId) ?? 0;
    const cancelled = () => this.stopped || (this.roomEpoch.get(message.roomId) ?? 0) !== epoch;
    try {
      const token = this.options.authToken();
      const handle = await this.options.files.download({
        url: this.options.mediaUrl(message.roomId, message.id),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        roomId: message.roomId,
        messageId: message.id,
        ext: mediaExtensionFor(message.mimeType, message.kind === 'file' ? message.body : undefined),
        expectedSize: message.sizeBytes,
      });
      if (cancelled()) {
        // Stopped or the room was cleared while the bytes were in flight:
        // the file must not outlive the clear, and nothing is indexed.
        await this.options.files.deleteFile(handle.path).catch(() => {});
        if (!this.stopped) {
          this.statuses.delete(message.id);
          this.notify([message.id]);
        }
        return;
      }
      const own = this.isOwn(message);
      await this.store.putMedia({
        messageId: message.id,
        roomId: message.roomId,
        localPath: handle.path,
        sizeBytes: handle.sizeBytes,
        mimeType: message.mimeType ?? 'application/octet-stream',
        origin: own ? 'sent' : 'received',
        // The sender never reports its own bytes as stored.
        storedAcked: own,
        createdAt: (this.options.now ?? (() => new Date().toISOString()))(),
      });
      this.verifiedAt.set(message.id, Date.now());
      this.statuses.delete(message.id);
      this.notify([message.id]);
      if (!own) this.options.onStored?.(message);
    } catch (err) {
      if (cancelled()) {
        if (!this.stopped) {
          this.statuses.delete(message.id);
          this.notify([message.id]);
        }
        return;
      }
      this.statuses.set(message.id, {
        state: 'failed',
        manual: status.manual,
        error: err instanceof Error && err.message ? err.message : 'Download failed.',
      });
      this.notify([message.id]);
    }
  }
}
