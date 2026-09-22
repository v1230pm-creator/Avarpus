import {
  getChatCapabilitiesQueryKey,
  getChatRoomsListQueryKey,
  useChatCapabilities,
  useChatRoomsList,
} from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useChatStore } from '@/context/ChatStoreContext';
import { useLocalRooms } from '@/hooks/useLocalChat';

/**
 * Unread count for the Chats tab badge and the launcher badge.
 *
 * With the device store open the count comes from local rooms (kept fresh by
 * the sync engine, no polling). Without a store it falls back to the room list
 * query the inbox already runs, at the inbox's own poll cadence.
 */
export function useChatUnreadCount(): number {
  // Mounted app-wide (launcher badge), so nothing may fetch while signed out.
  const { isAuthenticated, isLoading } = useAuth();
  const signedIn = isAuthenticated && !isLoading;
  const { data: capData } = useChatCapabilities({
    query: { enabled: signedIn, queryKey: getChatCapabilitiesQueryKey() },
  });
  const providerConfigured = signedIn && capData?.matrixAvailable === true;
  const { store, ready } = useChatStore();
  const localFirst = !!store;
  const networkRooms = providerConfigured && ready && !localFirst;

  const { data: roomsData } = useChatRoomsList({
    query: {
      enabled: networkRooms,
      queryKey: getChatRoomsListQueryKey(),
      refetchInterval: networkRooms ? 5_000 : false,
      refetchIntervalInBackground: false,
    },
  });
  const localRooms = useLocalRooms(localFirst && providerConfigured);

  const rooms = localFirst
    ? (localRooms.data ?? []).filter((room) => !room.deletedAt && !room.isArchived)
    : roomsData?.rooms ?? [];
  return rooms
    .filter((room) => room.kind === 'customer' || room.kind === 'direct')
    .reduce((sum, room) => sum + (room.unreadCount ?? 0), 0);
}
