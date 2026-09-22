import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * App-private storage for chat media (see
 * .local/tasks/chat-local-first/00-architecture.md). Files live under the
 * document directory — never the cache, which the OS may clear — laid out as
 *
 *   <document>/chat-media/<accountId>/<roomId>/<messageId>.<ext>
 *
 * so a room or an account can be removed by deleting one directory. Writes
 * are atomic: bytes land in a `.part` sibling first and are renamed into
 * place only after their size matched what the server reported, so a crash
 * or a dropped connection can never leave a truncated file at the final path.
 */

export const CHAT_MEDIA_DIR = 'chat-media';

export interface MediaFileHandle {
  /** file:// URI of the completed file. */
  path: string;
  sizeBytes: number;
}

export interface DownloadParams {
  url: string;
  headers?: Record<string, string>;
  roomId: string;
  messageId: string;
  ext: string;
  /** Server-reported byte size; when known the file must match it exactly. */
  expectedSize?: number;
}

export interface ImportParams {
  /** Device file (picked, recorded or staged copy) to keep. */
  sourceUri: string;
  roomId: string;
  messageId: string;
  ext: string;
  /** Move instead of copy when the app owns the source (voice notes, staging copies). */
  move?: boolean;
}

/**
 * File operations the media layer depends on. The native implementation is
 * below; tests inject an in-memory double so the download state machine can
 * be exercised without a device.
 */
export interface MediaFileOps {
  download(params: DownloadParams): Promise<MediaFileHandle>;
  importFile(params: ImportParams): Promise<MediaFileHandle>;
  /** Byte size of an existing file, or null when it is gone. */
  size(path: string): Promise<number | null>;
  deleteFile(path: string): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  deleteAccount(): Promise<void>;
}

export class MediaVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaVerificationError';
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function safeExt(ext: string): string {
  const cleaned = ext.replace(/^\.+/, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return cleaned || 'bin';
}

function rootDirectory(): Directory {
  return new Directory(Paths.document, CHAT_MEDIA_DIR);
}

function accountDirectory(accountId: string): Directory {
  return new Directory(rootDirectory(), safeSegment(accountId));
}

function roomDirectory(accountId: string, roomId: string): Directory {
  return new Directory(accountDirectory(accountId), safeSegment(roomId));
}

function ensureDirectory(dir: Directory): void {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

function deleteIfExists(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Best effort; a stray .part file is harmless and overwritten next time.
  }
}

/**
 * Verifies the temporary file and renames it into place. Throws (and removes
 * the temporary file) when the size does not match, so nothing partial is
 * ever visible under the final name.
 */
function commit(temp: File, final: File, expectedSize: number | undefined): MediaFileHandle {
  const size = temp.exists ? temp.size ?? 0 : 0;
  if (!temp.exists || size <= 0) {
    deleteIfExists(temp);
    throw new MediaVerificationError('Downloaded file is empty.');
  }
  if (expectedSize !== undefined && expectedSize > 0 && size !== expectedSize) {
    deleteIfExists(temp);
    throw new MediaVerificationError(`File size mismatch (expected ${expectedSize} bytes, got ${size}).`);
  }
  deleteIfExists(final);
  temp.move(final);
  return { path: final.uri, sizeBytes: size };
}

class NativeMediaFileOps implements MediaFileOps {
  constructor(private readonly accountId: string) {}

  private target(roomId: string, messageId: string, ext: string): { dir: Directory; temp: File; final: File } {
    const dir = roomDirectory(this.accountId, roomId);
    const base = safeSegment(messageId);
    const extension = safeExt(ext);
    return {
      dir,
      temp: new File(dir, `.${base}.${Date.now().toString(36)}.part`),
      final: new File(dir, `${base}.${extension}`),
    };
  }

  async download(params: DownloadParams): Promise<MediaFileHandle> {
    const { dir, temp, final } = this.target(params.roomId, params.messageId, params.ext);
    ensureDirectory(dir);
    deleteIfExists(temp);
    try {
      await File.downloadFileAsync(params.url, temp, {
        headers: params.headers,
        idempotent: true,
      });
    } catch (err) {
      deleteIfExists(temp);
      throw err;
    }
    return commit(temp, final, params.expectedSize);
  }

  async importFile(params: ImportParams): Promise<MediaFileHandle> {
    const { dir, temp, final } = this.target(params.roomId, params.messageId, params.ext);
    ensureDirectory(dir);
    deleteIfExists(temp);
    const source = new File(params.sourceUri);
    if (!source.exists) throw new MediaVerificationError('The selected file no longer exists.');
    try {
      if (params.move) source.move(temp);
      else source.copy(temp);
    } catch (err) {
      deleteIfExists(temp);
      throw err;
    }
    return commit(temp, final, undefined);
  }

  async size(path: string): Promise<number | null> {
    try {
      const file = new File(path);
      return file.exists ? file.size ?? 0 : null;
    } catch {
      return null;
    }
  }

  async deleteFile(path: string): Promise<void> {
    deleteIfExists(new File(path));
  }

  async deleteRoom(roomId: string): Promise<void> {
    deleteDirectory(roomDirectory(this.accountId, roomId));
  }

  async deleteAccount(): Promise<void> {
    deleteDirectory(accountDirectory(this.accountId));
  }
}

function deleteDirectory(dir: Directory): void {
  try {
    if (dir.exists) dir.delete();
  } catch {
    // Leave it for the next attempt; the index rows are already gone so the
    // files cannot be rendered even if the delete lagged behind.
  }
}

/**
 * Per-account file operations, or null where the device has no app-private
 * storage (web keeps placeholder behaviour and renders from the relay only).
 */
export function createMediaFileOps(accountId: string): MediaFileOps | null {
  if (Platform.OS === 'web') return null;
  return new NativeMediaFileOps(accountId);
}

/** Deletes one account's media directory. Safe to call without an open store. */
export async function deleteAccountMedia(accountId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  deleteDirectory(accountDirectory(accountId));
}

/**
 * Deletes every account's media directory except `keepAccountId`'s. Called on
 * store open so a crash between sign-out and cleanup can never leave another
 * account's attachments on disk for the next sign-in.
 */
export async function deleteOtherAccountsMedia(keepAccountId: string | null): Promise<void> {
  if (Platform.OS === 'web') return;
  let entries: (Directory | File)[];
  try {
    const root = rootDirectory();
    if (!root.exists) return;
    entries = root.list();
  } catch {
    return;
  }
  const keep = keepAccountId ? safeSegment(keepAccountId) : null;
  for (const entry of entries) {
    if (keep && entry.name === keep) continue;
    try {
      entry.delete();
    } catch {
      // Retried on the next open.
    }
  }
}

/** File extension for a stored attachment: the original name wins, then the verified MIME type. */
export function mediaExtensionFor(mimeType: string | undefined, filename: string | undefined): string {
  const fromName = filename?.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();
  const known: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
  };
  if (known[mime]) return known[mime];
  const sub = mime.split('/')[1];
  return sub && /^[a-z0-9]{1,8}$/.test(sub) ? sub : 'bin';
}
