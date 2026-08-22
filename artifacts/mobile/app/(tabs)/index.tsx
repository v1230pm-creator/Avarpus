import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { isDealerPortalRole } from '@/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Avatar } from '@/components/ui/Avatar';
import {
  useChatCapabilities,
  useChatRoomsList,
  getChatRoomsListQueryKey,
} from '@workspace/api-client-react';
import type { ChatRoom } from '@workspace/api-client-react';

function formatRoomTime(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function RoomItem({ room, onPress, colors }: { room: ChatRoom; onPress: () => void; colors: any }) {
  const lastMsg = room.lastMessage;
  const unread = room.unreadCount ?? 0;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.roomItem, { borderBottomColor: colors.border }]}
      testID={`room-item-${room.id}`}
    >
      <Avatar name={room.name} size={46} />
      <View style={styles.roomContent}>
        <View style={styles.roomHeader}>
          <Text
            style={[styles.roomName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}
            numberOfLines={1}
          >
            {room.name}
          </Text>
          <Text style={[styles.roomTime, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {formatRoomTime(lastMsg?.createdAt ?? room.createdAt)}
          </Text>
        </View>
        <View style={styles.roomFooter}>
          <Text
            style={[
              styles.roomLastMsg,
              { color: unread > 0 ? colors.foreground : colors.mutedForeground, fontFamily: unread > 0 ? 'Inter_500Medium' : 'Inter_400Regular' },
            ]}
            numberOfLines={1}
          >
            {lastMsg ? lastMsg.body : 'No messages yet'}
          </Text>
          {unread > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.unreadText, { fontFamily: 'Inter_700Bold' }]}>
                {unread > 99 ? '99+' : String(unread)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function InboxScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');

  const topPad = Platform.OS === 'web' ? insets.top + 67 : Math.max(insets.top, 20);

  const {
    data: capData,
    isLoading: capLoading,
    isError: capError,
  } = useChatCapabilities();

  const providerConfigured = capData?.matrixAvailable === true;

  const {
    data: roomsData,
    isLoading: roomsLoading,
    isError: roomsError,
    refetch: roomsRefetch,
  } = useChatRoomsList({
    query: { enabled: providerConfigured, queryKey: getChatRoomsListQueryKey() },
  });

  const rooms = useMemo(() => {
    const all = roomsData?.rooms ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.lastMessage?.body.toLowerCase().includes(q),
    );
  }, [roomsData, search]);

  const isLoading = capLoading || (providerConfigured && roomsLoading);

  const renderHeader = () => (
    <View
      style={{
        paddingTop: topPad + 16,
        paddingHorizontal: 20,
        paddingBottom: 12,
        backgroundColor: colors.card,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <View>
          <Text style={{ fontSize: 24, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>
            Inbox
          </Text>
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
            Customer conversations
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => router.push('/(tabs)/more')}
          style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: colors.backgroundSecondary,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: colors.border,
          }}
        >
          <Avatar name={user?.name ?? 'User'} size={40} />
          <View style={{ position: 'absolute', bottom: -2, right: -2, backgroundColor: colors.card, borderRadius: 10, padding: 2 }}>
            <Feather name="menu" size={12} color={colors.primary} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Search bar — only shown when provider is up */}
      {providerConfigured && (
        <View
          style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: colors.backgroundSecondary,
            borderRadius: 12, paddingHorizontal: 12, height: 40,
            borderWidth: 1, borderColor: colors.border,
          }}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search conversations…"
            placeholderTextColor={colors.mutedForeground}
            style={{ flex: 1, marginLeft: 8, fontSize: 14, color: colors.foreground, fontFamily: 'Inter_400Regular' }}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <View style={styles.centeredState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.stateText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Loading conversations…
          </Text>
        </View>
      </View>
    );
  }

  // Provider not configured
  if (!providerConfigured) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <View style={styles.emptyContainer}>
          <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
            <Feather name="message-square" size={32} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            Chat provider not configured
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Messaging, attachments, voice notes and calls will be available after the communication
            service is connected. Until then, customer conversations will not appear here.
          </Text>
          <View style={[styles.shieldBox, { backgroundColor: colors.backgroundSecondary }]}>
            <Feather name="shield" size={16} color={colors.mutedForeground} />
            <Text style={[styles.shieldText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
              End-to-end encryption is not enabled
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Rooms fetch error
  if (roomsError) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <View style={styles.emptyContainer}>
          <View style={[styles.iconWrap, { backgroundColor: colors.destructive + '18' }]}>
            <Feather name="alert-circle" size={32} color={colors.destructive} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            Could not load conversations
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            A network error occurred. Please check your connection and try again.
          </Text>
          <TouchableOpacity
            onPress={() => roomsRefetch()}
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Empty state
  if (rooms.length === 0 && !search) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <View style={styles.emptyContainer}>
          <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
            <Feather name="message-square" size={32} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            No conversations yet
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Start a conversation by messaging a customer from their profile page.
          </Text>
          <View style={[styles.shieldBox, { backgroundColor: colors.backgroundSecondary }]}>
            <Feather name="shield" size={16} color={colors.mutedForeground} />
            <Text style={[styles.shieldText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
              End-to-end encryption is not enabled
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={rooms}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) => (
          <RoomItem
            room={item}
            colors={colors}
            onPress={() =>
              router.push(
                `/(tabs)/customers/chat/${item.id}?name=${encodeURIComponent(item.name)}`,
              )
            }
          />
        )}
        ListEmptyComponent={
          search ? (
            <View style={styles.emptyContainer}>
              <Feather name="search" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold', marginTop: 12 }]}>
                No results for "{search}"
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  stateText: {
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
    marginBottom: 24,
  },
  shieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  shieldText: {
    fontSize: 12,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  roomItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  roomContent: {
    flex: 1,
    gap: 4,
  },
  roomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roomName: {
    fontSize: 15,
    flex: 1,
    marginRight: 8,
  },
  roomTime: {
    fontSize: 11,
  },
  roomFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roomLastMsg: {
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  unreadText: {
    fontSize: 11,
    color: '#FFFFFF',
  },
});
