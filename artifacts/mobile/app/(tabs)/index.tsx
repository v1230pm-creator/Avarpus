import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Contacts from 'expo-contacts';
import { type Repair } from '@/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { Avatar } from '@/components/ui/Avatar';
import { formatCurrency, formatDate } from '@/utils/helpers';
import {
  useChatCapabilities,
  useChatContactsMatch,
  useChatRoomsCreate,
  useChatRoomsList,
  getChatRoomsListQueryKey,
  getRepairsListQueryKey,
  useRepairsList,
} from '@workspace/api-client-react';
import type { ChatContact, ChatRoom } from '@workspace/api-client-react';
import { APP_BRAND } from '@/constants/branding';
import { BrandMark } from '@/components/ui/BrandMark';

const PHONE_BATCH_SIZE = 50;

function normalizeIndianPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

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

function formatMessagePreview(room: ChatRoom): { text: string; icon?: 'image' | 'mic' | 'paperclip' } {
  const message = room.lastMessage;
  if (!message) return { text: 'No messages yet' };
  if (message.kind === 'image') return { text: 'Photo', icon: 'image' };
  if (message.kind === 'audio') return { text: 'Voice message', icon: 'mic' };
  if (message.kind === 'file') return { text: 'Attachment', icon: 'paperclip' };
  return { text: message.body };
}

function RoomItem({ room, onPress, colors }: { room: ChatRoom; onPress: () => void; colors: any }) {
  const lastMsg = room.lastMessage;
  const unread = room.unreadCount ?? 0;
  const preview = formatMessagePreview(room);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.roomItem, { borderBottomColor: 'transparent', backgroundColor: colors.background }]}
      testID={`room-item-${room.id}`}
      accessibilityLabel={`Open chat with ${room.name}`}
    >
      <View style={{ position: 'relative' }}>
        <Avatar
          name={room.name}
          size={48}
          style={{ ...styles.roomAvatar, borderColor: colors.backgroundSecondary }}
        />
        {/* Mockup shows a heart icon next to some names. We'll skip for real data unless present. */}
      </View>
      <View style={styles.roomContent}>
        <View style={styles.roomHeader}>
          <Text
            style={[styles.roomName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 16 }]}
            numberOfLines={1}
          >
            {room.name}
          </Text>
          <Text
            style={[
              styles.roomTime,
              {
                color: unread > 0 ? colors.primary : colors.mutedForeground,
                fontFamily: unread > 0 ? 'Inter_500Medium' : 'Inter_400Regular',
                fontSize: 12,
              },
            ]}
          >
            {formatRoomTime(lastMsg?.createdAt ?? room.createdAt)}
          </Text>
        </View>
        <View style={styles.roomFooter}>
          {preview.icon && (
            <Feather
              name={preview.icon}
              size={14}
              color={unread > 0 ? colors.foreground : colors.primary}
              style={[styles.roomPreviewIcon, { marginRight: 4 }]}
            />
          )}
          <Text
            style={[
              styles.roomLastMsg,
              { color: unread > 0 ? colors.foreground : colors.mutedForeground, fontFamily: unread > 0 ? 'Inter_500Medium' : 'Inter_400Regular', fontSize: 13, flex: 1 },
            ]}
            numberOfLines={1}
          >
            {preview.text}
          </Text>
          {unread > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.unreadText, { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#fff' }]}>
                {unread > 99 ? '99+' : String(unread)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function CustomerInboxScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const chatSearchInputRef = useRef<TextInput>(null);
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [roomFilter, setRoomFilter] = useState<'all' | 'unread'>('all');
  const [showContactDiscovery, setShowContactDiscovery] = useState(false);
  const [exactPhone, setExactPhone] = useState('');
  const [matchedContacts, setMatchedContacts] = useState<ChatContact[]>([]);
  const [contactStatus, setContactStatus] = useState<'idle' | 'loading' | 'denied' | 'empty' | 'error'>('idle');
  const [contactError, setContactError] = useState<string | null>(null);
  const [openingContactId, setOpeningContactId] = useState<string | null>(null);
  const contactsMatch = useChatContactsMatch();
  const roomsCreate = useChatRoomsCreate();

  const topPad = Platform.OS === 'web' ? insets.top + 67 : Math.max(insets.top, 20);

  const {
    data: capData,
    isLoading: capLoading,
  } = useChatCapabilities();

  const providerConfigured = capData?.matrixAvailable === true;

  const {
    data: roomsData,
    isLoading: roomsLoading,
    isError: roomsError,
    refetch: roomsRefetch,
  } = useChatRoomsList({
    query: {
      enabled: providerConfigured,
      queryKey: getChatRoomsListQueryKey(),
      refetchInterval: providerConfigured ? 5_000 : false,
      refetchIntervalInBackground: false,
      refetchOnMount: 'always',
    },
  });

  const rooms = useMemo(() => {
    // Repairs, payment activity and dealer conversations belong in their own
    // app areas. Direct rooms are intentionally included alongside customers.
    const all = (roomsData?.rooms ?? []).filter(
      (room) => room.kind === 'customer' || room.kind === 'direct',
    );
    const filtered = roomFilter === 'unread'
      ? all.filter((room) => (room.unreadCount ?? 0) > 0)
      : all;
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.lastMessage?.body.toLowerCase().includes(q),
    );
  }, [roomFilter, roomsData, search]);

  const isLoading = capLoading || (providerConfigured && roomsLoading);

  const openDirectChat = useCallback(async (contact: ChatContact) => {
    if (openingContactId) return;
    setOpeningContactId(contact.userId);
    setContactError(null);
    try {
      const result = await roomsCreate.mutateAsync({
        data: {
          name: contact.name,
          kind: 'direct',
          targetUserId: contact.userId,
          matchToken: contact.matchToken,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() });
      router.push(
        `/(tabs)/customers/chat/${result.room.id}?name=${encodeURIComponent(contact.name)}`,
      );
    } catch (error: any) {
      setContactStatus('error');
      setContactError(
        error?.data?.message ?? error?.message ?? 'Could not start this conversation. Please try again.',
      );
    } finally {
      setOpeningContactId(null);
    }
  }, [openingContactId, queryClient, roomsCreate, router]);

  const matchPhones = useCallback(async (phones: string[]) => {
    if (!phones.length) {
      setMatchedContacts([]);
      setContactStatus('empty');
      return;
    }
    setContactStatus('loading');
    setContactError(null);
    try {
      const responses = await Promise.all(
        Array.from({ length: Math.ceil(phones.length / PHONE_BATCH_SIZE) }, (_, index) =>
          contactsMatch.mutateAsync({ data: { phones: phones.slice(index * PHONE_BATCH_SIZE, (index + 1) * PHONE_BATCH_SIZE) } }),
        ),
      );
      const byUserId = new Map<string, ChatContact>();
      responses.flatMap((response) => response.contacts).forEach((contact) => byUserId.set(contact.userId, contact));
      const contacts = [...byUserId.values()];
      setMatchedContacts(contacts);
      setContactStatus(contacts.length ? 'idle' : 'empty');
    } catch (error: any) {
      setContactStatus('error');
      setContactError(error?.data?.message ?? error?.message ?? 'Could not check your contacts. Please try again.');
    }
  }, [contactsMatch]);

  const discoverContacts = useCallback(async () => {
    if (Platform.OS === 'web') {
      setContactStatus('error');
      setContactError('Contact discovery is available in the mobile app. You can still search an exact phone number.');
      return;
    }
    setContactStatus('loading');
    setContactError(null);
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        setContactStatus('denied');
        return;
      }
      const result = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      const phones = [...new Set(result.data.flatMap((contact) =>
        (contact.phoneNumbers ?? []).map((phone) => normalizeIndianPhone(phone.number ?? '')).filter((phone): phone is string => !!phone),
      ))];
      await matchPhones(phones);
    } catch (error: any) {
      setContactStatus('error');
      setContactError(error?.message ?? 'Could not read your contacts. Please try again.');
    }
  }, [matchPhones]);

  const lookupExactPhone = useCallback(async () => {
    const phone = normalizeIndianPhone(exactPhone);
    if (!phone) {
      setContactStatus('error');
      setContactError('Enter a valid 10-digit mobile number.');
      return;
    }
    await matchPhones([phone]);
  }, [exactPhone, matchPhones]);

  const renderHeader = () => (
    <View
      style={{
        paddingTop: topPad + 16,
        paddingHorizontal: 20,
        paddingBottom: 12,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={[styles.chatHeaderRow, { justifyContent: 'space-between', paddingHorizontal: 0 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/more')}
            style={[styles.chatHeaderIcon, { marginRight: 16 }]}
            accessibilityLabel="Open account menu"
            testID="account-menu-control"
          >
            <Feather name="menu" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.chatHeaderTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 24 }]}>
            Chats
          </Text>
        </View>
        
        <View style={styles.chatHeaderActions}>
          <TouchableOpacity
            onPress={() => {
              setShowChatSearch((visible) => {
                if (!visible) requestAnimationFrame(() => chatSearchInputRef.current?.focus());
                return !visible;
              });
            }}
            style={styles.chatHeaderIcon}
            accessibilityLabel="Search chats"
          >
            <Feather name="search" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowContactDiscovery((visible) => !visible)}
            style={styles.chatHeaderIcon}
            accessibilityLabel="Start a new chat"
            testID="new-chat-control"
          >
            <Feather name="plus-circle" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {providerConfigured && showChatSearch && (
        <View style={[styles.homeSearch, { backgroundColor: colors.backgroundSecondary, marginTop: 12 }]}>
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            ref={chatSearchInputRef}
            value={search}
            onChangeText={setSearch}
            placeholder="Search chats"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.homeSearchInput, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
            returnKeyType="search"
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear chat search">
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {providerConfigured && (
        <View style={[styles.roomFilters, { marginTop: 12 }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {(['All', 'Unread', 'Groups', 'Favorites'] as const).map((label) => {
              const value = label.toLowerCase() as 'all' | 'unread' | 'groups' | 'favorites';
              const disabled = value === 'groups' || value === 'favorites';
              const selected = !disabled && roomFilter === value;
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => {
                    if (!disabled) setRoomFilter(value);
                  }}
                  disabled={disabled}
                  accessibilityState={{ disabled, selected }}
                  accessibilityHint={disabled ? `${label} filtering is not available for direct chats` : undefined}
                  style={[
                    styles.roomFilterChip,
                    {
                      backgroundColor: selected ? colors.primary : 'transparent',
                      opacity: disabled ? 0.5 : 1,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: selected ? '#FFFFFF' : colors.mutedForeground,
                      fontSize: 13,
                      fontFamily: 'Inter_500Medium',
                    }}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {providerConfigured && showContactDiscovery && (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 8 }}>
            Start a direct chat
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TextInput
              value={exactPhone}
              onChangeText={setExactPhone}
              keyboardType="phone-pad"
              placeholder="10-digit mobile number"
              placeholderTextColor={colors.mutedForeground}
              style={{ flex: 1, height: 40, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, color: colors.foreground, fontFamily: 'Inter_400Regular' }}
              accessibilityLabel="Exact mobile number"
            />
            <TouchableOpacity onPress={lookupExactPhone} style={{ marginLeft: 8, padding: 10 }} accessibilityLabel="Find registered contact">
              <Feather name="search" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={discoverContacts} style={{ marginLeft: 4, padding: 10 }} accessibilityLabel="Find contacts on this device">
              <Feather name="users" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
          {contactStatus === 'loading' && <ActivityIndicator style={{ marginTop: 12 }} color={colors.primary} />}
          {contactStatus === 'denied' && <Text style={{ marginTop: 10, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Contacts permission was denied. Search an exact number instead.</Text>}
          {contactStatus === 'empty' && <Text style={{ marginTop: 10, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>No registered contacts were found.</Text>}
          {contactStatus === 'error' && (
            <View style={{ marginTop: 10 }}>
              <Text style={{ color: colors.destructive, fontFamily: 'Inter_400Regular' }}>{contactError}</Text>
              <TouchableOpacity onPress={exactPhone ? lookupExactPhone : discoverContacts} accessibilityLabel="Retry contact lookup">
                <Text style={{ color: colors.primary, marginTop: 6, fontFamily: 'Inter_600SemiBold' }}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          {matchedContacts.map((contact) => (
            <TouchableOpacity
              key={contact.userId}
              onPress={() => void openDirectChat(contact)}
              disabled={openingContactId !== null}
              testID={`matched-contact-${contact.userId}`}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: openingContactId && openingContactId !== contact.userId ? 0.5 : 1 }}
            >
              <Avatar name={contact.name} size={36} />
              <View style={{ marginLeft: 10 }}>
                <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{contact.name}</Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 12 }}>{contact.mobile}</Text>
              </View>
              {openingContactId === contact.userId && (
                <ActivityIndicator style={{ marginLeft: 'auto' }} color={colors.primary} />
              )}
            </TouchableOpacity>
          ))}
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
            service is connected. Until then, conversations will not appear here.
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
            Customer and direct conversations will appear here.
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
            onPress={() => {
              // Existing rooms always open by room id. Contact discovery is
              // the only path that creates a new direct room.
              router.push(
                `/(tabs)/customers/chat/${item.id}?name=${encodeURIComponent(item.name)}`,
              );
            }}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
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
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 24, paddingTop: 8, paddingHorizontal: 12 }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

function formatRepairTime(dateStr?: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function repairStatusLine(repair: Repair): string {
  if (repair.status === 'received') {
    return `Received: ${formatDate(repair.receiveDate || repair.createdAt)}`;
  }
  if (repair.status === 'ready') return 'Ready for Delivery';
  if (repair.status === 'delivered') {
    return `Delivered: ${formatDate(repair.deliveryDate || repair.createdAt)}`;
  }
  if (repair.status === 'testing') return 'Testing in progress';
  if (repair.status === 'waiting_parts') return 'Waiting for parts';
  if (repair.status === 'customer_approval') return 'Customer approval pending';
  if (repair.status === 'cannot_repair') return 'Cannot repair';
  return 'In Repair';
}

function normalizeIdentityText(value?: string): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

function normalizePhone(value?: string): string {
  return (value ?? '').replace(/\D/g, '');
}

function RepairHomeItem({
  repair,
  colors,
  onPress,
  onCustomerPress,
}: {
  repair: Repair;
  colors: any;
  onPress: () => void;
  onCustomerPress?: () => void;
}) {
  const total = repair.totalAmount ?? repair.repairCharge + repair.partsCharge;
  const paid = repair.paidAmount ?? repair.advance;
  const due = Math.max(0, total - paid);
  const isPaid = total > 0 && due <= 0;
  const avatarPalette = [
    colors.primary,
    colors.purple,
    colors.info,
    colors.success,
    colors.warning,
  ];
  const avatarIndex =
    Array.from(repair.customerName).reduce(
      (sum, char) => sum + char.charCodeAt(0),
      0,
    ) % avatarPalette.length;
  const initials = repair.customerName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const statusColor =
    repair.status === 'received'
      ? colors.primary
      : repair.status === 'ready' || repair.status === 'delivered'
        ? colors.success
        : colors.info;

  return (
    <View
      style={[styles.repairItem, { borderBottomColor: colors.border }]}
    >
      <TouchableOpacity
        activeOpacity={0.72}
        onPress={onCustomerPress}
        disabled={!onCustomerPress}
        style={[
          styles.repairAvatar,
          { backgroundColor: avatarPalette[avatarIndex] },
        ]}
        testID={`home-customer-avatar-${repair.id}`}
        accessibilityLabel={`Open chat with ${repair.customerName}`}
      >
        <Text
          style={[
            styles.repairAvatarText,
            { fontFamily: 'Inter_700Bold' },
          ]}
        >
          {initials || 'C'}
        </Text>
      </TouchableOpacity>

      <View style={styles.repairContent}>
        <View style={styles.repairNameRow}>
          <TouchableOpacity
            activeOpacity={0.72}
            onPress={onCustomerPress}
            disabled={!onCustomerPress}
            style={styles.repairNameWrap}
            testID={`home-chat-customer-${repair.id}`}
            accessibilityLabel={`Open chat with ${repair.customerName}`}
          >
            <Text
              style={[
                styles.repairCustomerName,
                {
                  color: colors.foreground,
                  fontFamily: 'Inter_700Bold',
                },
              ]}
              numberOfLines={1}
            >
              {repair.customerName}
            </Text>
            {!!repair.dealerName && (
              <View
                style={[
                  styles.dealerPill,
                  { backgroundColor: colors.successLight },
                ]}
              >
                <Text
                  style={[
                    styles.dealerPillText,
                    {
                      color: colors.success,
                      fontFamily: 'Inter_600SemiBold',
                    },
                  ]}
                >
                  Dealer
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.72}
            onPress={onPress}
            accessibilityLabel={`Open repair ${repair.repairId}`}
          >
            <Text
              style={[
                styles.repairTime,
                {
                  color: colors.mutedForeground,
                  fontFamily: 'Inter_500Medium',
                },
              ]}
            >
              {formatRepairTime(repair.createdAt)}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.72}
          onPress={onPress}
          testID={`home-repair-${repair.id}`}
          accessibilityLabel={`Open repair ${repair.repairId}`}
        >
          <View style={styles.repairTicketRow}>
            <Text
              style={[
                styles.repairMeta,
                {
                  color: colors.secondaryForeground,
                  fontFamily: 'Inter_500Medium',
                },
              ]}
            >
              {repair.repairId}
            </Text>
            <Text
              style={[
                styles.repairDevice,
                {
                  color: colors.secondaryForeground,
                  fontFamily: 'Inter_500Medium',
                },
              ]}
              numberOfLines={1}
            >
              · {repair.brand} {repair.model}
            </Text>
          </View>

          <View style={styles.repairBottomRow}>
            <Text
              style={[
                styles.repairStatus,
                { color: statusColor, fontFamily: 'Inter_600SemiBold' },
              ]}
              numberOfLines={1}
            >
              {repairStatusLine(repair)}
            </Text>

            <View
              style={[
                styles.amountPill,
                {
                  backgroundColor:
                    total <= 0
                      ? colors.backgroundSecondary
                      : isPaid
                        ? colors.successLight
                        : `${colors.destructive}12`,
                },
              ]}
            >
              <Text
                style={[
                  styles.amountLabel,
                  {
                    color:
                      total <= 0
                        ? colors.mutedForeground
                        : isPaid
                          ? colors.success
                          : colors.destructive,
                    fontFamily: 'Inter_600SemiBold',
                  },
                ]}
              >
                {total <= 0 ? 'No Amount' : isPaid ? 'Paid' : 'Due'}
              </Text>
              {total > 0 && (
                <Text
                  style={[
                    styles.amountValue,
                    {
                      color: isPaid ? colors.success : colors.destructive,
                      fontFamily: 'Inter_700Bold',
                    },
                  ]}
                >
                  {formatCurrency(isPaid ? total : due)}
                </Text>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function RepairHomeScreen() {
  const colors = useColors();
  const scheme = useColorScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { canAccess } = useAuth();
  const { customers } = useData();
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const repairsParams = {
    q: search.trim() || undefined,
    page: 1,
    limit: 50,
  };
  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useRepairsList(repairsParams, {
    query: { queryKey: getRepairsListQueryKey(repairsParams) },
  });
  const allRepairs = (data?.repairs ?? []) as Repair[];
  const repairs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return allRepairs;
    return allRepairs.filter((repair) =>
      [
        repair.customerName,
        repair.repairId,
        repair.mobile,
        repair.brand,
        repair.model,
      ].some((value) => value?.toLowerCase().includes(query)),
    );
  }, [allRepairs, search]);
  const topPad =
    Platform.OS === 'web' ? insets.top + 67 : Math.max(insets.top, 12);
  const canCreateRepair = canAccess('repairs_create');
  const chatCustomerForRepair = useCallback(
    (repair: Repair) => {
      const directMatch = customers.find((customer) => customer.id === repair.customerId);
      if (directMatch) return directMatch;

      // Older repair rows can predate the customerId link. Resolve a safe,
      // unique customer identity from the live, shop-scoped customer list.
      const mobile = normalizePhone(repair.mobile);
      const mobileMatches = mobile
        ? customers.filter((customer) => normalizePhone(customer.mobile) === mobile)
        : [];
      if (mobileMatches.length === 1) return mobileMatches[0];

      const customerName = normalizeIdentityText(repair.customerName);
      const nameMatches = customerName
        ? customers.filter(
            (customer) => normalizeIdentityText(customer.name) === customerName,
          )
        : [];
      return nameMatches.length === 1 ? nameMatches[0] : null;
    },
    [customers],
  );

  const renderHeader = () => (
    <View
      style={[
        styles.homeHeader,
        {
          paddingTop: topPad,
          backgroundColor: colors.card,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={styles.homeHeaderRow}>
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/more')}
          style={styles.headerIconButton}
          accessibilityLabel="Open menu"
        >
          <Feather name="menu" size={27} color={colors.foreground} />
        </TouchableOpacity>

        <View style={styles.brandLockup}>
          <BrandMark size={27} />
          <Text style={[styles.brandName, { color: colors.foreground }]}>{APP_BRAND}</Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => searchInputRef.current?.focus()}
            style={styles.headerIconButton}
            accessibilityLabel="Search repairs"
          >
            <Feather name="search" size={23} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/more/notifications')}
            style={styles.headerIconButton}
            accessibilityLabel="Open notifications"
          >
            <Feather name="bell" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View
          style={[
            styles.homeSearch,
            { backgroundColor: colors.backgroundSecondary },
          ]}
        >
          <Feather
            name="search"
            size={19}
            color={colors.mutedForeground}
          />
          <TextInput
            ref={searchInputRef}
            value={search}
            onChangeText={setSearch}
            placeholder="Search customer or ticket..."
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.homeSearchInput,
              {
                color: colors.foreground,
                fontFamily: 'Inter_400Regular',
              },
            ]}
            accessibilityLabel="Search customer or ticket"
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearch('')}
              accessibilityLabel="Clear search"
            >
              <Feather
                name="x"
                size={18}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/repairs')}
          style={[
            styles.filterButton,
            { backgroundColor: colors.backgroundSecondary },
          ]}
          accessibilityLabel="Open repair filters"
        >
          <Feather name="sliders" size={21} color={colors.foreground} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={repairs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const chatCustomer = chatCustomerForRepair(item);
          return (
            <RepairHomeItem
              repair={item}
              colors={colors}
              onPress={() => router.push(`/(tabs)/repairs/${item.id}`)}
              onCustomerPress={
                chatCustomer
                  ? () =>
                      router.push(
                        `/(tabs)/customers/chat/${chatCustomer.id}?targetId=${chatCustomer.id}&type=customer&name=${encodeURIComponent(chatCustomer.name)}`,
                      )
                  : undefined
              }
            />
          );
        }}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.homeEmpty}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.homeEmpty}>
              <Feather
                name={isError ? 'alert-circle' : 'clipboard'}
                size={32}
                color={
                  isError ? colors.destructive : colors.mutedForeground
                }
              />
              <Text
                style={[
                  styles.homeEmptyTitle,
                  {
                    color: colors.foreground,
                    fontFamily: 'Inter_700Bold',
                  },
                ]}
              >
                {isError
                  ? 'Could not load repairs'
                  : search
                    ? 'No matching repairs'
                    : 'No repairs yet'}
              </Text>
              <Text
                style={[
                  styles.homeEmptyText,
                  {
                    color: colors.mutedForeground,
                    fontFamily: 'Inter_400Regular',
                  },
                ]}
              >
                {isError
                  ? 'Check your connection and try again.'
                  : search
                    ? 'Try a customer name or repair ticket.'
                    : 'New repair jobs will appear here.'}
              </Text>
              {isError && (
                <TouchableOpacity
                  onPress={() => refetch()}
                  style={[
                    styles.retryBtn,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text
                    style={{
                      color: colors.primaryForeground,
                      fontFamily: 'Inter_600SemiBold',
                    }}
                  >
                    Retry
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
        contentContainerStyle={styles.homeListContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      />

      {canCreateRepair && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/(tabs)/repairs/new')}
          accessibilityLabel="Create new repair"
          testID="home-create-repair"
        >
          <Feather
            name="plus"
            size={32}
            color={colors.primaryForeground}
          />
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function HomeScreen() {
  // The first tab is Chats for every role. Repair, payment, and dealer
  // workflows stay in their own tabs instead of leaking into the chat inbox.
  return <CustomerInboxScreen />;
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
    paddingHorizontal: 8,
    paddingVertical: 2,
    gap: 13,
  },
  roomAvatar: {
    borderWidth: 0,
  },
  roomContent: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  roomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roomName: {
    fontSize: 16,
    flex: 1,
    marginRight: 12,
  },
  roomTime: {
    fontSize: 12,
  },
  roomFooter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roomLastMsg: {
    fontSize: 14,
    marginRight: 8,
  },
  roomPreviewIcon: {
    marginRight: 5,
  },
  unreadBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 6,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    fontSize: 11,
    color: '#FFFFFF',
  },
  chatHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatHeaderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatHeaderTitle: { fontSize: 24 },
  chatHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  chatHeaderIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  roomFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    marginRight: 4,
  },
  securePill: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  homeHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  homeHeaderRow: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 11,
  },
  headerIconButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandLogo: {
    width: 38,
    height: 38,
  },
  brandName: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeSearch: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 13,
    paddingHorizontal: 14,
  },
  homeSearchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    paddingVertical: 0,
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeListContent: {
    flexGrow: 1,
    paddingBottom: 108,
  },
  repairItem: {
    minHeight: 112,
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  repairAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
    marginTop: 1,
  },
  repairAvatarText: {
    color: '#FFFFFF',
    fontSize: 17,
  },
  repairContent: {
    flex: 1,
    minWidth: 0,
  },
  repairNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  repairNameWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  repairCustomerName: {
    flexShrink: 1,
    fontSize: 16,
  },
  dealerPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  dealerPillText: {
    fontSize: 10,
  },
  repairTime: {
    fontSize: 11,
  },
  repairTicketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    minWidth: 0,
  },
  repairMeta: {
    fontSize: 12,
  },
  repairDevice: {
    flex: 1,
    fontSize: 12,
  },
  repairBottomRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  repairStatus: {
    flex: 1,
    fontSize: 12,
  },
  amountPill: {
    alignItems: 'flex-end',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    minWidth: 72,
  },
  amountLabel: {
    fontSize: 11,
  },
  amountValue: {
    fontSize: 13,
    marginTop: 1,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: Platform.OS === 'web' ? 100 : 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0B63F6',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.25,
    shadowRadius: 9,
    elevation: 6,
  },
  homeEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 72,
  },
  homeEmptyTitle: {
    fontSize: 17,
    marginTop: 14,
  },
  homeEmptyText: {
    fontSize: 14,
    marginTop: 6,
    textAlign: 'center',
  },
});
