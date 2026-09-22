import {
  ApiError,
  chatMessagesSend,
  type ChatMessage,
  type ChatMessageSendInput,
  type ChatMessagesSend200,
} from '@workspace/api-client-react';
import type { ChatStore, OutboxItem } from '@/utils/chatStore';
import { discardOutboxMedia, finalizeSentMedia } from '@/utils/chatMedia';
import type { MediaFileOps } from '@/utils/chatMedia';

export interface ChatOutboxApi {
  send(roomId: string, input: ChatMessageSendInput): Promise<ChatMessagesSend200>;
}

export const liveChatOutboxApi: ChatOutboxApi = {
  send: (roomId, input) => chatMessagesSend(roomId, input),
};

export interface OutboxFlushOptions {
  /** Called after each successful send (e.g. to refresh room previews). */
  onSent?: (message: ChatMessage, item: OutboxItem) => void;
  /** Called when a send fails permanently (4xx). */
  onFailed?: (item: OutboxItem, error: unknown) => void;
  /** Deletes a device temp file the app created for the send (voice notes). */
  deleteOwnedFile?: (uri: string) => Promise<void>;
  /** App-private media storage; the kept copy of a discarded send is removed through it. */
  mediaFiles?: MediaFileOps | null;
  now?: () => number;
}

export const MAX_BACKOFF_MS = 60_000;

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.max(0, attempts - 1));
}

/** True when the failure is worth retrying automatically later. */
export function isRetryableSendError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 408 || err.status === 429 || err.status >= 500;
  // No HTTP status at all: the request never reached the API (offline, DNS,
  // aborted). The server may still have received it, which is exactly what
  // the clientRequestId idempotency key protects against on retry.
  return true;
}

export function sendErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const data = err.data as { message?: unknown } | null;
    if (typeof data?.message === 'string' && data.message) return data.message;
    return `Message failed to send (${err.status}).`;
  }
  return err instanceof Error && err.message ? err.message : 'Message failed to send.';
}

export function outboxToSendInput(item: OutboxItem): ChatMessageSendInput {
  return {
    kind: item.kind,
    body: item.body,
    clientRequestId: item.clientRequestId,
    ...(item.replyToMessageId ? { replyToMessageId: item.replyToMessageId } : {}),
    ...(item.objectPath ? { objectPath: item.objectPath } : {}),
    ...(item.kind === 'audio' && item.durationMs !== undefined
      ? { durationMs: Math.max(1, Math.round(item.durationMs)) }
      : {}),
  };
}

/**
 * Drains the durable outbox one message at a time, in enqueue order.
 *
 * Ordering rules:
 * - Only `queued` rows are sent; `pending_upload` rows belong to the upload
 *   flow that created them and `failed` rows wait for the user (retry/discard).
 * - A retryable failure (offline, 5xx, 429) keeps the row `queued` with a
 *   growing `nextAttemptAt` and stops the pass: everything behind it waits so
 *   messages never overtake each other.
 * - A definitive failure (other 4xx) marks the row `failed` and the pass
 *   continues with the next row.
 *
 * Passes are coalesced like sync passes; `flush()` resolves when the pass that
 * covered the request has finished.
 */
export class ChatOutboxFlusher {
  private running: Promise<void> | null = null;
  private rerun = false;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private online = true;

  constructor(
    private readonly store: ChatStore,
    private readonly api: ChatOutboxApi = liveChatOutboxApi,
    private readonly options: OutboxFlushOptions = {},
  ) {}

  setOnline(online: boolean): void {
    const wasOffline = !this.online;
    this.online = online;
    if (online && wasOffline) void this.flush();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.running = this.runPass()
      .catch(() => {})
      .finally(() => {
        this.running = null;
        if (this.rerun && !this.stopped) {
          this.rerun = false;
          void this.flush();
        }
      });
    return this.running;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private scheduleRetry(delayMs: number): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delayMs);
  }

  private async runPass(): Promise<void> {
    for (let guard = 0; guard < 500; guard += 1) {
      if (this.stopped) return;
      const items = await this.store.listOutbox();
      const next = items.find((item) => item.state === 'queued' || item.state === 'sending');
      if (!next) return;
      const wait = Date.parse(next.nextAttemptAt) - this.now();
      if (wait > 0) {
        this.scheduleRetry(wait);
        return;
      }
      if (!this.online) {
        // Stay queued; setOnline(true) flushes again.
        return;
      }
      const outcome = await this.sendOne(next);
      if (outcome === 'retry-later') return;
    }
  }

  private async sendOne(item: OutboxItem): Promise<'sent' | 'failed' | 'retry-later'> {
    await this.store.updateOutbox(item.clientRequestId, { state: 'sending' });
    try {
      const { message } = await this.api.send(item.roomId, outboxToSendInput(item));
      await this.store.batch(async () => {
        await this.store.upsertMessages([message]);
        await this.store.removeOutbox(item.clientRequestId);
        // The kept original now belongs to the server message id so the
        // sender's bubble keeps rendering from disk after the outbox row goes.
        await finalizeSentMedia(this.store, item.clientRequestId, message.id);
      });
      if (item.ownedTempFile && item.localUri && this.options.deleteOwnedFile) {
        await this.options.deleteOwnedFile(item.localUri).catch(() => {});
      }
      this.options.onSent?.(message, item);
      return 'sent';
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // The session is gone; the global handler signs the app out and the
        // store is wiped with it. Leave the row untouched.
        await this.store.updateOutbox(item.clientRequestId, { state: 'queued' });
        return 'retry-later';
      }
      if (isRetryableSendError(err)) {
        const attempts = item.attempts + 1;
        const delay = backoffMs(attempts);
        await this.store.updateOutbox(item.clientRequestId, {
          state: 'queued',
          attempts,
          lastError: sendErrorMessage(err),
          nextAttemptAt: new Date(this.now() + delay).toISOString(),
        });
        this.scheduleRetry(delay);
        return 'retry-later';
      }
      await this.store.updateOutbox(item.clientRequestId, {
        state: 'failed',
        attempts: item.attempts + 1,
        lastError: sendErrorMessage(err),
      });
      this.options.onFailed?.(item, err);
      return 'failed';
    }
  }

  /** User asked to retry a failed row: it re-enters the queue in its original position. */
  async retry(clientRequestId: string): Promise<void> {
    const item = await this.store.getOutbox(clientRequestId);
    if (!item) return;
    await this.store.updateOutbox(clientRequestId, {
      state: 'queued',
      lastError: null,
      nextAttemptAt: new Date(this.now()).toISOString(),
    });
    await this.flush();
  }

  /** User discarded a failed row. */
  async discard(clientRequestId: string): Promise<void> {
    const item = await this.store.getOutbox(clientRequestId);
    if (!item) return;
    await this.store.removeOutbox(clientRequestId);
    if (item.ownedTempFile && item.localUri && this.options.deleteOwnedFile) {
      await this.options.deleteOwnedFile(item.localUri).catch(() => {});
    }
    await discardOutboxMedia(this.store, this.options.mediaFiles ?? null, clientRequestId).catch(() => {});
  }
}

/** Builds a queued text send. */
export function makeTextOutboxItem(params: {
  clientRequestId: string;
  roomId: string;
  body: string;
  replyTo?: ChatMessage | null;
  now?: string;
}): OutboxItem {
  const now = params.now ?? new Date().toISOString();
  return {
    clientRequestId: params.clientRequestId,
    roomId: params.roomId,
    kind: 'text',
    body: params.body,
    ...(params.replyTo ? { replyToMessageId: params.replyTo.id, replyTo: quoteOf(params.replyTo) } : {}),
    state: 'queued',
    attempts: 0,
    lastError: null,
    nextAttemptAt: now,
    createdAt: now,
  };
}

export function quoteOf(message: ChatMessage): NonNullable<ChatMessage['replyTo']> {
  return {
    id: message.id,
    senderId: message.senderId,
    senderName: message.senderName,
    kind: message.kind,
    body: message.body,
    deleted: !!message.deletedAt,
  };
}

/** Renders an outbox row as a message bubble for the timeline. */
export function outboxToMessage(item: OutboxItem, viewer: { id: string; name: string }): ChatMessage & {
  localStatus: 'queued' | 'sending' | 'failed';
  outboxId: string;
  localMediaPath?: string;
} {
  return {
    id: `out-${item.clientRequestId}`,
    outboxId: item.clientRequestId,
    roomId: item.roomId,
    shopId: '',
    senderId: viewer.id,
    senderName: viewer.name,
    kind: item.kind,
    body: item.body,
    clientRequestId: item.clientRequestId,
    createdAt: item.createdAt,
    ...(item.objectPath ? { objectPath: item.objectPath } : {}),
    ...(item.contentType ? { mimeType: item.contentType } : {}),
    ...(item.sizeBytes !== undefined ? { sizeBytes: item.sizeBytes } : {}),
    ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
    ...(item.replyTo ? { replyTo: item.replyTo } : {}),
    // Our own attachment renders from the device file it is sent from.
    ...(item.localUri ? { localMediaPath: item.localUri } : {}),
    localStatus: item.state === 'failed' ? 'failed' : item.state === 'sending' ? 'sending' : 'queued',
  };
}
