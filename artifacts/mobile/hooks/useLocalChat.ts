import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/context/ChatStoreContext';
import type { LocalChatMessage, LocalChatRoom, OutboxItem, StoreChange } from '@/utils/chatStore';
import { HISTORY_PAGE } from '@/utils/chatSync';

/**
 * Reactive reads over the local chat store. Each hook re-runs its query when
 * the store reports a relevant change, so screens render from device data and
 * update the moment a sync pass, a send or a local action writes rows.
 */

interface LocalQuery<T> {
  data: T | null;
  /** First read has not completed yet. */
  loading: boolean;
}

function useStoreQuery<T>(
  enabled: boolean,
  relevant: (change: StoreChange) => boolean,
  read: () => Promise<T>,
  deps: unknown[],
): LocalQuery<T> {
  const { store } = useChatStore();
  const [state, setState] = useState<LocalQuery<T>>({ data: null, loading: true });
  const readRef = useRef(read);
  readRef.current = read;
  const relevantRef = useRef(relevant);
  relevantRef.current = relevant;

  useEffect(() => {
    if (!store || !enabled) {
      setState({ data: null, loading: false });
      return;
    }
    let cancelled = false;
    let pending = false;
    let running = false;
    const run = async () => {
      if (running) {
        pending = true;
        return;
      }
      running = true;
      try {
        const data = await readRef.current();
        if (!cancelled) setState({ data, loading: false });
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
      } finally {
        running = false;
        if (pending && !cancelled) {
          pending = false;
          void run();
        }
      }
    };
    setState((prev) => ({ ...prev, loading: prev.data === null }));
    void run();
    const off = store.subscribe((change) => {
      if (relevantRef.current(change)) void run();
    });
    return () => {
      cancelled = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, enabled, ...deps]);

  return state;
}

export function useLocalRooms(enabled = true): LocalQuery<LocalChatRoom[]> {
  const { store } = useChatStore();
  return useStoreQuery(
    enabled,
    (change) => change.rooms,
    () => (store ? store.listRooms() : Promise.resolve([])),
    [],
  );
}

export function useLocalRoom(roomId: string | null): LocalQuery<LocalChatRoom | null> {
  const { store } = useChatStore();
  return useStoreQuery(
    !!roomId,
    (change) => change.rooms || (!!roomId && change.roomIds.has(roomId)),
    () => (store && roomId ? store.getRoom(roomId) : Promise.resolve(null)),
    [roomId],
  );
}

export interface LocalTimeline {
  messages: LocalChatMessage[] | null;
  loading: boolean;
  /** More local rows exist beyond the current window. */
  hasMoreLocal: boolean;
  /** Extend the window by one page (local first, then server backfill). */
  loadOlder: () => Promise<void>;
  /** A server backfill page is being fetched. */
  loadingOlder: boolean;
  /** Everything the server has for this room is stored locally. */
  historyComplete: boolean;
}

/**
 * Newest-first window over a room's local messages. Scrolling back grows the
 * window from local rows first; once those run out the sync engine fetches
 * one older page from the server (until the server reports no more).
 */
export function useLocalMessages(roomId: string | null, enabled = true): LocalTimeline {
  const { store, engine } = useChatStore();
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyComplete, setHistoryComplete] = useState(false);
  const limitRef = useRef(limit);
  limitRef.current = limit;

  useEffect(() => {
    setLimit(HISTORY_PAGE);
    setHistoryComplete(false);
    if (!engine || !roomId) return;
    void engine.isBackfillDone(roomId).then(setHistoryComplete);
  }, [engine, roomId]);

  const query = useStoreQuery(
    !!roomId && enabled,
    (change) => !!roomId && change.roomIds.has(roomId),
    async () => {
      if (!store || !roomId) return { rows: [] as LocalChatMessage[], hasMore: false };
      // Ask for one extra row to know whether the window can still grow.
      const rows = await store.listMessages(roomId, { limit: limit + 1 });
      return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
    },
    [roomId, limit],
  );

  const backfillingRef = useRef(false);
  const loadOlder = useCallback(async () => {
    if (!roomId || !store) return;
    if (query.data?.hasMore) {
      setLimit((n) => n + HISTORY_PAGE);
      return;
    }
    if (!engine || historyComplete || backfillingRef.current) return;
    backfillingRef.current = true;
    setLoadingOlder(true);
    try {
      const result = await engine.loadOlder(roomId);
      if (result.done) setHistoryComplete(true);
      if (result.fetched > 0) setLimit((n) => n + HISTORY_PAGE);
    } catch {
      // Offline or server error: local rows stay; the next attempt retries.
    } finally {
      backfillingRef.current = false;
      setLoadingOlder(false);
    }
  }, [roomId, store, engine, query.data?.hasMore, historyComplete]);

  // A room with fewer local rows than a page has never been opened here (or
  // only its preview is stored): fetch its first page from the server once.
  const initialFillRef = useRef<string | null>(null);
  useEffect(() => {
    if (!roomId || !engine || !query.data || query.loading) return;
    if (initialFillRef.current === roomId) return;
    initialFillRef.current = roomId;
    if (query.data.rows.length >= HISTORY_PAGE || historyComplete) return;
    void loadOlder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, engine, query.data, query.loading]);

  return {
    messages: query.data?.rows ?? null,
    loading: query.loading,
    hasMoreLocal: query.data?.hasMore ?? false,
    loadOlder,
    loadingOlder,
    historyComplete,
  };
}

export function useLocalOutbox(roomId: string | null): LocalQuery<OutboxItem[]> {
  const { store } = useChatStore();
  return useStoreQuery(
    !!roomId,
    (change) => change.outbox && (!!roomId && (change.roomIds.size === 0 || change.roomIds.has(roomId))),
    () => (store && roomId ? store.listOutbox(roomId) : Promise.resolve([])),
    [roomId],
  );
}
