import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  getChatMessagesListQueryKey,
  getChatRoomsListQueryKey,
  getNotificationPreferencesGetQueryKey,
  getNotificationsListQueryKey,
  notificationPreferencesGet,
  useChatRoomsList,
} from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { getNotificationRoute } from '@/utils/notificationNavigation';
import {
  canReceivePush,
  installPushListeners,
  onPushOpened,
  onPushReceived,
  setAppBadge,
  setCachedNotificationPreferences,
  watchAppStateForPush,
  type NotificationData,
} from '@/utils/pushNotifications';

// Connects the native push layer to the app: a received push refreshes the
// screens that show the same data (so an open inbox updates without waiting
// for its next poll), and a tapped push opens the exact record — the
// conversation, repair or request — never just the home screen.
//
// Registration itself happens in AuthContext on sign-in; this component only
// listens. It renders nothing.
export function PushNotificationsBridge() {
  const { isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const authReady = isAuthenticated && !isLoading;
  const authReadyRef = useRef(authReady);
  authReadyRef.current = authReady;
  // A tap that arrives before the session is restored (cold start) waits here
  // until navigation can safely land inside the signed-in tabs.
  const pendingRouteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!canReceivePush()) return;
    const teardownListeners = installPushListeners();
    const teardownAppState = watchAppStateForPush();
    return () => {
      teardownListeners();
      teardownAppState();
    };
  }, []);

  useEffect(() => {
    if (!canReceivePush()) return;
    const refreshFor = (data: NotificationData) => {
      if (!authReadyRef.current) return;
      void queryClient.invalidateQueries({ queryKey: getNotificationsListQueryKey() });
      if (data.type === 'chat_message') {
        void queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() });
        if (typeof data.roomId === 'string' && data.roomId) {
          void queryClient.invalidateQueries({ queryKey: getChatMessagesListQueryKey(data.roomId) });
        }
      }
    };
    const open = (data: NotificationData) => {
      const route = getNotificationRoute(data);
      if (!route) return;
      if (authReadyRef.current) {
        router.push(route as never);
      } else {
        pendingRouteRef.current = route;
      }
    };
    const offReceived = onPushReceived(refreshFor);
    const offOpened = onPushOpened(open);
    return () => {
      offReceived();
      offOpened();
    };
  }, [queryClient, router]);

  useEffect(() => {
    if (!authReady) {
      setCachedNotificationPreferences(null);
      return;
    }
    // The foreground handler needs the Sound preference without a network
    // round-trip at presentation time.
    queryClient
      .fetchQuery({
        queryKey: getNotificationPreferencesGetQueryKey(),
        queryFn: () => notificationPreferencesGet(),
        staleTime: 60_000,
      })
      .then((result) => setCachedNotificationPreferences(result.preferences))
      .catch(() => {});
    const pending = pendingRouteRef.current;
    if (pending) {
      pendingRouteRef.current = null;
      // Let the tab navigator mount before pushing a nested route.
      const timer = setTimeout(() => router.push(pending as never), 400);
      return () => clearTimeout(timer);
    }
  }, [authReady, queryClient, router]);

  // The launcher badge mirrors the Chats tab count. This observes the room
  // list already polled by the tabs (enabled: false = cache only, no extra
  // traffic): reading in-app clears the badge that a push set while closed.
  const { data: roomsData } = useChatRoomsList({
    query: { enabled: false, queryKey: getChatRoomsListQueryKey() },
  });
  useEffect(() => {
    if (!authReady || !roomsData || !canReceivePush()) return;
    const unread = (roomsData.rooms ?? [])
      .filter((room) => room.kind === 'customer' || room.kind === 'direct')
      .reduce((sum, room) => sum + (room.unreadCount ?? 0), 0);
    void setAppBadge(unread);
  }, [authReady, roomsData]);

  return null;
}
