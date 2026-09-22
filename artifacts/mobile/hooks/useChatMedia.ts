import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatMessage } from '@workspace/api-client-react';
import { useChatStore } from '@/context/ChatStoreContext';
import { getChatMessageMediaUrl } from '@workspace/api-client-react';
import { relayAvailable, shouldAutoDownload, type MediaDownloadStatus } from '@/utils/chatMedia';
import type { MediaSummary } from '@/utils/chatStore';

/**
 * Where an attachment's bytes should be read from, in preference order:
 * the device copy, then the server relay (only while the server still holds
 * it), otherwise nothing — the bubble shows an explicit "no longer available"
 * placeholder rather than a broken image or an endless spinner.
 */
export type ChatMediaSource =
  | { kind: 'local'; uri: string }
  | { kind: 'remote'; uri: string; headers?: Record<string, string> }
  /** Relay copy gone and no device copy: `expired` = nobody collected it before the hard cap. */
  | { kind: 'unavailable'; reason: 'purged' | 'expired' }
  /** Device-owned mode and no local copy yet: the bubble offers a download. */
  | { kind: 'pending' };

export function localMediaPathOf(message: ChatMessage): string | undefined {
  const path = (message as ChatMessage & { localMediaPath?: string }).localMediaPath;
  return typeof path === 'string' && path.length > 0 ? path : undefined;
}

export interface ChatMediaState {
  source: ChatMediaSource;
  /** Download progress for this message (device-owned mode only). */
  download: MediaDownloadStatus | undefined;
  /**
   * True when a tap should start (or retry) a download rather than open the
   * media — including after this device's saved copy was found missing
   * (`download.state === 'lost'`), while the server still holds the bytes.
   */
  needsDownload: boolean;
  requestDownload: () => void;
  /** Forget a failed attempt (used when the user dismisses the error). */
  clearFailure: () => void;
}

/** Live download status for one message from the download manager. */
export function useMediaDownloadStatus(messageId: string): MediaDownloadStatus | undefined {
  const { media } = useChatStore();
  const [status, setStatus] = useState<MediaDownloadStatus | undefined>(() => media?.status(messageId));
  useEffect(() => {
    if (!media) {
      setStatus(undefined);
      return;
    }
    setStatus(media.status(messageId));
    return media.subscribe((ids) => {
      if (ids.has(messageId)) setStatus(media.status(messageId));
    });
  }, [media, messageId]);
  return status;
}

/**
 * Resolves how a media bubble should render and what a tap should do.
 *
 * With a device store and app-private storage (`media` manager present) the
 * relay is never streamed into a bubble: the bytes are downloaded once into
 * the device copy (automatically when the policy allows, otherwise on tap)
 * and rendered from disk afterwards. Without a manager (web, or the store
 * failed to open) the bubble streams from the relay as before.
 */
export function useChatMediaSource(message: ChatMessage, token: string | null): ChatMediaState {
  const { media, autoDownload, networkClass } = useChatStore();
  const download = useMediaDownloadStatus(message.id);
  const localPath = localMediaPathOf(message);
  const available = relayAvailable(message);
  const deviceOwned = !!media && !message.id.startsWith('out-');
  const autoAllowed = deviceOwned && available && shouldAutoDownload(message.kind, autoDownload, networkClass);

  // Older history (backfilled before the policy ran, or a bubble scrolled
  // into view after a network change) is fetched the moment it is shown.
  useEffect(() => {
    if (!media || localPath || !autoAllowed || download) return;
    void media.consider([message]);
    // Re-run only when identity or policy inputs change; `message` object
    // identity churns with every store read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, message.id, localPath, autoAllowed, download?.state]);

  // A device copy is only trusted once its size still matches the index: a
  // file the OS or the user removed behind our back must not be rendered as
  // a broken image, and the server must hear about it while it can still
  // help (the manager caches recent checks, so this is cheap on re-render).
  useEffect(() => {
    if (!media || !localPath || !deviceOwned) return;
    void media.verify(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, message.id, localPath, deviceOwned]);

  const source = useMemo<ChatMediaSource>(() => {
    if (localPath) return { kind: 'local', uri: localPath };
    if (!available) return { kind: 'unavailable', reason: message.mediaState === 'expired' ? 'expired' : 'purged' };
    if (deviceOwned) return { kind: 'pending' };
    return {
      kind: 'remote',
      uri: `${process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : ''}${getChatMessageMediaUrl(message.roomId, message.id)}`,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    };
  }, [available, deviceOwned, localPath, message.id, message.mediaState, message.roomId, token]);

  const requestDownload = useCallback(() => {
    if (!media || localPath || !available) return;
    media.download(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, localPath, available, message.id]);

  const clearFailure = useCallback(() => media?.clearFailure(message.id), [media, message.id]);

  return {
    source,
    download,
    needsDownload: source.kind === 'pending',
    requestDownload,
    clearFailure,
  };
}

/**
 * Device copy path for a message id (quote thumbnails). `undefined` while the
 * index is still being read, `null` when there is no local copy.
 */
export function useLocalMediaPath(messageId: string | null | undefined): string | null | undefined {
  const { store } = useChatStore();
  const [path, setPath] = useState<string | null | undefined>(() => (store && messageId ? undefined : null));
  useEffect(() => {
    if (!store || !messageId) {
      setPath(null);
      return;
    }
    let cancelled = false;
    setPath(undefined);
    const read = () => {
      store
        .getMedia(messageId)
        .then((row) => {
          if (!cancelled) setPath(row?.localPath ?? null);
        })
        .catch(() => {
          if (!cancelled) setPath(null);
        });
    };
    read();
    const off = store.subscribe(() => read());
    return () => {
      cancelled = true;
      off();
    };
  }, [store, messageId]);
  return path;
}

/**
 * Image source for a small thumbnail (quotes, reply strips). Reads the device
 * copy; while the index is being read nothing is rendered. In device-owned
 * mode the relay is never fetched for a thumbnail — that would bypass the
 * user's auto-download rules — so a photo that is not on the device shows no
 * preview until the bubble itself is downloaded. Without a device store the
 * relay is used as before.
 */
export function useMediaThumbnailSource(
  message: Pick<ChatMessage, 'id' | 'roomId' | 'mediaState' | 'deletedAt'> | null,
  token: string | null,
): { uri: string; headers?: Record<string, string> } | null {
  const { media } = useChatStore();
  const localPath = useLocalMediaPath(message?.id ?? null);
  return useMemo(() => {
    if (!message) return null;
    if (localPath) return { uri: localPath };
    if (localPath === undefined) return null; // still resolving
    if (!relayAvailable(message)) return null;
    if (media) return null; // device-owned mode: the bubble download is the only fetch
    return {
      uri: `${process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : ''}${getChatMessageMediaUrl(message.roomId, message.id)}`,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    };
  }, [localPath, media, message?.id, message?.roomId, message?.mediaState, message?.deletedAt, token]);
}

/**
 * What this phone holds versus what the server can still give back (see
 * `MediaSummary`). `null` while the index is being read or when this build
 * does not keep media on the device (web, or the store failed to open).
 * Re-reads after every store change so a purge learnt from sync, a fresh
 * download or a cleared room is reflected without leaving the screen.
 */
export function useMediaSummary(): MediaSummary | null {
  const { store, media } = useChatStore();
  const [summary, setSummary] = useState<MediaSummary | null>(null);
  useEffect(() => {
    if (!store || !media) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    const read = () => {
      store
        .mediaSummary()
        .then((next) => {
          if (!cancelled) setSummary(next);
        })
        .catch(() => {});
    };
    read();
    const off = store.subscribe(() => read());
    return () => {
      cancelled = true;
      off();
    };
  }, [store, media]);
  return summary;
}
