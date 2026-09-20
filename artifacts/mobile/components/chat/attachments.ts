import type { ComponentProps } from 'react';
import type { Feather } from '@expo/vector-icons';

/**
 * Attachment classification shared by the chat composer (what kind to send)
 * and the message list (how to render / open what arrived).
 *
 * Every file type is accepted. The only job here is to pick the right kind
 * and a sensible MIME type — the server re-verifies both from the stored
 * object, so nothing below is a security boundary.
 */

export type FeatherIconName = ComponentProps<typeof Feather>['name'];

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

const MIME_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** Extension → MIME for pickers that hand back no (or a generic) type. */
const EXT_TO_MIME: Record<string, string> = {
  // images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  // video
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
  // audio
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  amr: 'audio/amr',
  // documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  vcf: 'text/vcard',
  // archives & packages
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  apk: 'application/vnd.android.package-archive',
  aab: 'application/octet-stream',
  exe: 'application/x-msdownload',
};

export function fileExtension(name: string | null | undefined): string {
  const clean = (name ?? '').split('?')[0].split('#')[0];
  const idx = clean.lastIndexOf('.');
  return idx >= 0 ? clean.slice(idx + 1).toLowerCase() : '';
}

/** Lower-case, parameter-free MIME type, or null when the value is not one. */
export function normaliseMimeType(raw: string | null | undefined): string | null {
  const bare = String(raw ?? '').split(';')[0].trim().toLowerCase();
  return MIME_TYPE_RE.test(bare) ? bare : null;
}

/**
 * Resolve the content type to upload. Prefers a real picker MIME, then the
 * file extension, then the picker's coarse media class, and finally
 * application/octet-stream — a file is never rejected for its type.
 */
export function resolveContentType(
  mimeType: string | null | undefined,
  filename: string,
  mediaClass?: 'image' | 'video' | null,
): string {
  const fromPicker = normaliseMimeType(mimeType);
  if (fromPicker && fromPicker !== 'application/octet-stream') return fromPicker;
  const fromExt = EXT_TO_MIME[fileExtension(filename)];
  if (fromExt) return fromExt;
  if (mediaClass === 'video') return 'video/mp4';
  if (mediaClass === 'image') return 'image/jpeg';
  return fromPicker ?? 'application/octet-stream';
}

/** Types the image viewer can actually decode inline. */
export function isViewableImageMime(mime: string): boolean {
  return mime.startsWith('image/') && mime !== 'image/svg+xml';
}

/**
 * Message kind for an outgoing attachment. Audio is reserved for voice notes
 * (they carry a duration); an MP3 picked as a document is a plain file.
 */
export function messageKindFor(contentType: string, hasDuration: boolean): AttachmentKind {
  if (hasDuration && contentType.startsWith('audio/')) return 'audio';
  if (isViewableImageMime(contentType)) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  return 'file';
}

/** Best-effort MIME for a received message (legacy rows have none stored). */
export function receivedMimeType(message: { mimeType?: string | null; body: string; kind: string }): string {
  const stored = normaliseMimeType(message.mimeType);
  if (stored) return stored;
  const fromExt = EXT_TO_MIME[fileExtension(message.body)];
  if (fromExt) return fromExt;
  if (message.kind === 'image') return 'image/jpeg';
  if (message.kind === 'video') return 'video/mp4';
  if (message.kind === 'audio') return 'audio/mp4';
  return 'application/octet-stream';
}

export type FileTypeVisual = { icon: FeatherIconName; label: string };

/** Icon + short label for a file bubble / preview chip. */
export function fileTypeVisual(mime: string, filename: string): FileTypeVisual {
  const ext = fileExtension(filename);
  const label = ext ? ext.toUpperCase().slice(0, 5) : 'FILE';
  if (mime === 'application/pdf') return { icon: 'file-text', label: 'PDF' };
  if (mime === 'application/vnd.android.package-archive' || ext === 'apk') return { icon: 'smartphone', label: 'APK' };
  if (
    /zip|rar|7z|tar|gzip|compressed/.test(mime) ||
    ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)
  ) {
    return { icon: 'archive', label };
  }
  if (mime.startsWith('audio/')) return { icon: 'music', label };
  if (mime.startsWith('video/')) return { icon: 'film', label };
  if (mime.startsWith('image/')) return { icon: 'image', label };
  if (/spreadsheet|excel|csv/.test(mime)) return { icon: 'grid', label };
  if (/presentation|powerpoint/.test(mime)) return { icon: 'monitor', label };
  if (/word|text\/|json|xml|rtf/.test(mime)) return { icon: 'file-text', label };
  if (/x-msdownload|executable/.test(mime)) return { icon: 'box', label };
  return { icon: 'file', label };
}
