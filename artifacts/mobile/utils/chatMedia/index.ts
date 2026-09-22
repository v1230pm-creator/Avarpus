import { storage, KEYS } from '@/utils/storage';
import type { ChatStore, MediaIndexRow } from '@/utils/chatStore';
import type { MediaFileOps } from './files';
import type { ChatMediaDownloadManager } from './downloadManager';
import { normaliseAutoDownloadSettings, type AutoDownloadSettings } from './policy';

export * from './files';
export * from './policy';
export {
  ChatMediaDownloadManager,
  mediaClearedAtKey,
  type MediaAuditResult,
  type MediaDownloadStatus,
  type MediaDownloadOptions,
} from './downloadManager';

/** Index key for media of a send that has not reached the server yet. */
export function outboxMediaKey(clientRequestId: string): string {
  return `out-${clientRequestId}`;
}

export interface KeepSentMediaParams {
  clientRequestId: string;
  roomId: string;
  sourceUri: string;
  mimeType: string;
  /** Original file name (documents) used to pick the stored extension. */
  filename?: string;
  ext: string;
  /** The app owns the source (voice note / staging copy): move it instead of copying. */
  move?: boolean;
}

/**
 * Copies the file the user is about to send into app-private storage and
 * indexes it under the outbox key. The sender's bubble renders from this copy
 * straight away and never downloads its own media back from the relay.
 * Returns null when the copy failed; the send still proceeds from the
 * original URI in that case.
 */
export async function keepSentMedia(
  store: ChatStore,
  files: MediaFileOps,
  params: KeepSentMediaParams,
): Promise<MediaIndexRow | null> {
  try {
    const key = outboxMediaKey(params.clientRequestId);
    const handle = await files.importFile({
      sourceUri: params.sourceUri,
      roomId: params.roomId,
      messageId: key,
      ext: params.ext,
      move: params.move,
    });
    const row: MediaIndexRow = {
      messageId: key,
      roomId: params.roomId,
      localPath: handle.path,
      sizeBytes: handle.sizeBytes,
      mimeType: params.mimeType,
      origin: 'sent',
      storedAcked: true,
      createdAt: new Date().toISOString(),
    };
    await store.putMedia(row);
    return row;
  } catch {
    return null;
  }
}

/** After a successful send, the kept copy belongs to the server message id. */
export async function finalizeSentMedia(store: ChatStore, clientRequestId: string, messageId: string): Promise<void> {
  await store.rekeyMedia(outboxMediaKey(clientRequestId), messageId).catch(() => {});
}

/** A queued send was discarded: its kept copy has no message to belong to. */
export async function discardOutboxMedia(store: ChatStore, files: MediaFileOps | null, clientRequestId: string): Promise<void> {
  const key = outboxMediaKey(clientRequestId);
  const row = await store.getMedia(key);
  if (!row) return;
  await store.removeMedia([key]);
  if (files) await files.deleteFile(row.localPath).catch(() => {});
}

/**
 * Removes every media file and index row for a room; message text is
 * untouched. The download manager is told first so queued and in-flight
 * downloads for the room are cancelled and the auto policy does not refill
 * it with the same attachments the moment their index rows disappear.
 */
export async function clearRoomMedia(
  store: ChatStore,
  files: MediaFileOps | null,
  roomId: string,
  manager?: ChatMediaDownloadManager | null,
): Promise<void> {
  if (manager) {
    const [newest] = await store.listMessages(roomId, { limit: 1 });
    await manager.clearRoom(roomId, newest?.createdAt ?? new Date().toISOString());
  }
  const rows = await store.listMedia(roomId);
  await store.removeMedia(rows.map((r) => r.messageId));
  if (files) await files.deleteRoom(roomId).catch(() => {});
}

export async function loadAutoDownloadSettings(): Promise<AutoDownloadSettings> {
  return normaliseAutoDownloadSettings(await storage.get<unknown>(KEYS.CHAT_AUTO_DOWNLOAD));
}

export async function saveAutoDownloadSettings(settings: AutoDownloadSettings): Promise<void> {
  await storage.set(KEYS.CHAT_AUTO_DOWNLOAD, settings);
}
