import type { ChatMessage } from '@workspace/api-client-react';

/**
 * Auto-download policy for received chat media. The user picks, per kind,
 * whether attachments are fetched as soon as they arrive on any network, only
 * on Wi-Fi, or only when tapped. Anything not auto-downloaded stays a manual
 * download in the bubble.
 */

export type AutoDownloadRule = 'always' | 'wifi' | 'never';

/** Setting keys group message kinds the way users think about them. */
export type AutoDownloadKind = 'images' | 'audio' | 'documents' | 'videos';

export type AutoDownloadSettings = Record<AutoDownloadKind, AutoDownloadRule>;

export const DEFAULT_AUTO_DOWNLOAD: AutoDownloadSettings = {
  images: 'always',
  audio: 'always',
  documents: 'always',
  videos: 'wifi',
};

export type NetworkClass = 'wifi' | 'cellular' | 'offline' | 'unknown';

export const AUTO_DOWNLOAD_KINDS: { key: AutoDownloadKind; label: string; hint: string }[] = [
  { key: 'images', label: 'Photos', hint: 'Pictures shared in chats' },
  { key: 'audio', label: 'Voice messages', hint: 'Recorded voice notes' },
  { key: 'documents', label: 'Documents', hint: 'PDFs, archives and other files' },
  { key: 'videos', label: 'Videos', hint: 'Usually the largest attachments' },
];

export const AUTO_DOWNLOAD_RULES: { value: AutoDownloadRule; label: string }[] = [
  { value: 'always', label: 'Any network' },
  { value: 'wifi', label: 'Wi-Fi only' },
  { value: 'never', label: 'On tap' },
];

export function autoDownloadKindFor(kind: ChatMessage['kind']): AutoDownloadKind | null {
  switch (kind) {
    case 'image':
      return 'images';
    case 'audio':
      return 'audio';
    case 'file':
      return 'documents';
    case 'video':
      return 'videos';
    default:
      return null;
  }
}

/** Fills in defaults for a partially stored settings object. */
export function normaliseAutoDownloadSettings(value: unknown): AutoDownloadSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<Record<AutoDownloadKind, unknown>>;
  const pick = (key: AutoDownloadKind): AutoDownloadRule => {
    const candidate = input[key];
    return candidate === 'always' || candidate === 'wifi' || candidate === 'never' ? candidate : DEFAULT_AUTO_DOWNLOAD[key];
  };
  return { images: pick('images'), audio: pick('audio'), documents: pick('documents'), videos: pick('videos') };
}

/**
 * Whether the policy allows fetching this kind right now. `unknown` networks
 * (module unavailable, transitional states) count as metered so a "Wi-Fi
 * only" rule never downloads over a connection it cannot classify.
 */
export function shouldAutoDownload(
  kind: ChatMessage['kind'],
  settings: AutoDownloadSettings,
  network: NetworkClass,
): boolean {
  const key = autoDownloadKindFor(kind);
  if (!key) return false;
  if (network === 'offline') return false;
  const rule = settings[key];
  if (rule === 'never') return false;
  if (rule === 'always') return true;
  return network === 'wifi';
}

/**
 * True when the server still holds relay bytes for this message. Only an
 * explicit `purged` / `expired` state (or a deleted message) makes the relay
 * unavailable; rows without a state are treated as available so older
 * history keeps rendering exactly as before.
 */
export function relayAvailable(message: Pick<ChatMessage, 'mediaState' | 'deletedAt'>): boolean {
  if (message.deletedAt) return false;
  return message.mediaState !== 'purged' && message.mediaState !== 'expired';
}

/** Message kinds whose bytes the device keeps. */
export function isMediaKind(kind: ChatMessage['kind']): boolean {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'file';
}
