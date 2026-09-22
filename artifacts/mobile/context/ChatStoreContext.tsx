import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import { useQueryClient } from '@tanstack/react-query';
import { getChatRoomsGetQueryKey, getChatRoomsListQueryKey } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { destroyChatStore, openChatStore, type ChatStore } from '@/utils/chatStore';
import { ChatOutboxFlusher } from '@/utils/chatOutbox';
import { ChatSyncEngine, type ChatSyncStatus, type SyncReason } from '@/utils/chatSync';
import {
  ChatMediaDownloadManager,
  DEFAULT_AUTO_DOWNLOAD,
  createMediaFileOps,
  loadAutoDownloadSettings,
  saveAutoDownloadSettings,
  type AutoDownloadSettings,
  type MediaFileOps,
  type NetworkClass,
} from '@/utils/chatMedia';
import { getChatMessageMediaUrl } from '@workspace/api-client-react';
import { deleteOwnedTempFile } from '@/utils/tempFiles';
import { onPushReceived } from '@/utils/pushNotifications';
import { storage, KEYS } from '@/utils/storage';

/** Slow safety net while the app is active; pushes and foreground events do the real work. */
const FALLBACK_POLL_MS = 30_000;

export interface ChatStoreContextValue {
  /** Null until opened, and stays null when no store can be opened (network-only rendering). */
  store: ChatStore | null;
  engine: ChatSyncEngine | null;
  outbox: ChatOutboxFlusher | null;
  /** True once the open attempt for the current account has finished (either way). */
  ready: boolean;
  status: ChatSyncStatus;
  requestSync: (reason: SyncReason) => Promise<void>;
  /** Downloads received attachments into app-private storage; null without a store or on web. */
  media: ChatMediaDownloadManager | null;
  /** App-private media file operations for the signed-in account (null on web / without a store). */
  mediaFiles: MediaFileOps | null;
  autoDownload: AutoDownloadSettings;
  setAutoDownload: (settings: AutoDownloadSettings) => Promise<void>;
  /** Current connection class as the download policy sees it. */
  networkClass: NetworkClass;
}

const idleStatus: ChatSyncStatus = {
  online: true,
  syncing: false,
  error: null,
  lastSyncedAt: null,
  bootstrapped: false,
};

const ChatStoreContext = createContext<ChatStoreContextValue>({
  store: null,
  engine: null,
  outbox: null,
  ready: true,
  status: idleStatus,
  requestSync: async () => {},
  media: null,
  mediaFiles: null,
  autoDownload: DEFAULT_AUTO_DOWNLOAD,
  setAutoDownload: async () => {},
  networkClass: 'unknown',
});

interface Session {
  store: ChatStore;
  engine: ChatSyncEngine;
  outbox: ChatOutboxFlusher;
  media: ChatMediaDownloadManager | null;
  mediaFiles: MediaFileOps | null;
  accountId: string;
}

function classifyNetwork(state: { isConnected?: boolean; isInternetReachable?: boolean | null; type?: string }): NetworkClass {
  if (state.isConnected === false || state.isInternetReachable === false) return 'offline';
  const type = String(state.type ?? '').toUpperCase();
  if (type === 'WIFI' || type === 'ETHERNET') return 'wifi';
  if (type === 'CELLULAR' || type === 'BLUETOOTH' || type === 'WIMAX' || type === 'VPN' || type === 'OTHER') return 'cellular';
  if (type === 'NONE') return 'offline';
  return 'unknown';
}

/**
 * Owns the per-account chat store, the sync engine and the outbox flusher for
 * the signed-in user. Opens the store when a user appears (or their active
 * workspace changes), destroys it when the user disappears (sign-out, revoked
 * session, account deletion), and drives sync from app lifecycle events.
 */
export function ChatStoreProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const accountId = user?.id ?? null;
  const shopId = user?.shopId ?? null;
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!accountId);
  const [status, setStatus] = useState<ChatSyncStatus>(idleStatus);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const lastAccountRef = useRef<string | null>(null);
  const [autoDownload, setAutoDownloadState] = useState<AutoDownloadSettings>(DEFAULT_AUTO_DOWNLOAD);
  const autoDownloadRef = useRef(autoDownload);
  autoDownloadRef.current = autoDownload;
  const [networkClass, setNetworkClass] = useState<NetworkClass>(Platform.OS === 'web' ? 'wifi' : 'unknown');
  const networkRef = useRef(networkClass);
  networkRef.current = networkClass;
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAutoDownloadSettings()
      .then((settings) => {
        if (!cancelled) setAutoDownloadState(settings);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setAutoDownload = useCallback(async (settings: AutoDownloadSettings) => {
    setAutoDownloadState(settings);
    await saveAutoDownloadSettings(settings);
    sessionRef.current?.media?.networkChanged();
  }, []);

  // Open / close per identity.
  useEffect(() => {
    let cancelled = false;
    const previous = sessionRef.current;
    const previousAccount = lastAccountRef.current;
    lastAccountRef.current = accountId;
    setSession(null);
    setStatus(idleStatus);

    const closePrevious = async () => {
      if (!previous) {
        // No open store, but a stale database from a crashed sign-out may
        // still exist; the next open removes it. On sign-out with nothing
        // open there is nothing to destroy.
        if (!accountId && previousAccount) await destroyChatStore(null, previousAccount);
        return;
      }
      previous.engine.stop();
      previous.outbox.stop();
      previous.media?.stop();
      if (!accountId || accountId !== previous.accountId) {
        // Sign-out or a different account: nothing of the old account may
        // remain readable on the device.
        await destroyChatStore(previous.store, previous.accountId);
      } else {
        // Same account, different workspace: openChatStore wipes on shop
        // mismatch; just release the handle.
        await previous.store.close().catch(() => {});
      }
    };

    (async () => {
      setReady(false);
      await closePrevious();
      if (!accountId) {
        if (!cancelled) setReady(true);
        return;
      }
      const store = await openChatStore({ accountId, shopId });
      if (cancelled) {
        if (store) await store.close().catch(() => {});
        return;
      }
      if (!store) {
        setReady(true);
        return;
      }
      tokenRef.current = await storage.get<string>(KEYS.AUTH_TOKEN);
      const engine = new ChatSyncEngine(store);
      const mediaFiles = createMediaFileOps(accountId);
      const media = mediaFiles
        ? new ChatMediaDownloadManager(store, {
            files: mediaFiles,
            authToken: () => tokenRef.current,
            mediaUrl: (roomId, messageId) =>
              `${process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : ''}${getChatMessageMediaUrl(roomId, messageId)}`,
            settings: () => autoDownloadRef.current,
            network: () => networkRef.current,
            onStored: () => {
              // Report the stored copy promptly; the next pass retries if offline.
              void engine.requestSync('media');
            },
            onLost: () => {
              // Tell the server before its purge trusts a copy that is gone.
              void engine.requestSync('media');
            },
          })
        : null;
      if (media) engine.onMessagesApplied((messages) => void media.consider(messages));
      const outbox = new ChatOutboxFlusher(store, undefined, {
        deleteOwnedFile: async (uri) => deleteOwnedTempFile(uri),
        mediaFiles,
        onSent: (message) => {
          void queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getChatRoomsGetQueryKey(message.roomId) });
        },
      });
      // Crash recovery: a send interrupted mid-flight is retried (idempotent
      // by clientRequestId); an upload interrupted before it finished cannot
      // resume and waits for the user to retry or discard it.
      for (const item of await store.listOutbox()) {
        if (item.state === 'sending') {
          await store.updateOutbox(item.clientRequestId, { state: 'queued' });
        } else if (item.state === 'pending_upload') {
          await store.updateOutbox(item.clientRequestId, {
            state: 'failed',
            lastError: 'Upload was interrupted. Tap to retry.',
          });
        }
      }
      await engine.prime();
      if (cancelled) {
        engine.stop();
        outbox.stop();
        media?.stop();
        await store.close().catch(() => {});
        return;
      }
      setSession({ store, engine, outbox, media, mediaFiles, accountId });
      setReady(true);
    })().catch(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [accountId, shopId]);

  // Status, lifecycle triggers, connectivity and the slow fallback poll.
  useEffect(() => {
    if (!session) return;
    const { engine, outbox, media } = session;
    const offStatus = engine.subscribe(setStatus);
    // The integrity sweep runs after the first pass so freshly synced
    // `mediaState` values decide which files can still be repaired; the
    // manager throttles repeats, so foreground returns are cheap.
    void engine
      .requestSync('start')
      .then(() => outbox.flush())
      .finally(() => void media?.audit().catch(() => {}));
    void outbox.flush();

    const onAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        void engine
          .requestSync('foreground')
          .then(() => outbox.flush())
          .finally(() => void media?.audit().catch(() => {}));
      }
    };
    const appStateSub = AppState.addEventListener('change', onAppState);

    const offPush = onPushReceived((data) => {
      if (data.type === 'chat_message') void engine.requestSync('push');
    });

    let networkSub: { remove: () => void } | null = null;
    if (Platform.OS !== 'web') {
      try {
        const applyNetwork = (state: Network.NetworkState) => {
          const cls = classifyNetwork(state);
          networkRef.current = cls;
          setNetworkClass(cls);
          media?.networkChanged();
        };
        networkSub = Network.addNetworkStateListener((event) => {
          const online = event.isConnected !== false && event.isInternetReachable !== false;
          engine.setOnline(online);
          outbox.setOnline(online);
          applyNetwork(event);
          if (online) void engine.requestSync('reconnect');
        });
        Network.getNetworkStateAsync()
          .then((state) => {
            const online = state.isConnected !== false && state.isInternetReachable !== false;
            engine.setOnline(online);
            outbox.setOnline(online);
            applyNetwork(state);
          })
          .catch(() => {});
      } catch {
        // Network module unavailable: assume online, sync failures still surface.
      }
    }

    const poll = setInterval(() => {
      if (AppState.currentState === 'active') void engine.requestSync('poll').then(() => outbox.flush());
    }, FALLBACK_POLL_MS);

    return () => {
      offStatus();
      appStateSub.remove();
      offPush();
      networkSub?.remove();
      clearInterval(poll);
    };
  }, [session]);

  const requestSync = useCallback((reason: SyncReason) => {
    const current = sessionRef.current;
    if (!current) return Promise.resolve();
    return current.engine.requestSync(reason).then(() => current.outbox.flush());
  }, []);

  const value = useMemo<ChatStoreContextValue>(
    () => ({
      store: session?.store ?? null,
      engine: session?.engine ?? null,
      outbox: session?.outbox ?? null,
      ready,
      status,
      requestSync,
      media: session?.media ?? null,
      mediaFiles: session?.mediaFiles ?? null,
      autoDownload,
      setAutoDownload,
      networkClass,
    }),
    [session, ready, status, requestSync, autoDownload, setAutoDownload, networkClass],
  );

  return <ChatStoreContext.Provider value={value}>{children}</ChatStoreContext.Provider>;
}

export function useChatStore(): ChatStoreContextValue {
  return useContext(ChatStoreContext);
}
