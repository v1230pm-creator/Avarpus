import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Contacts from 'expo-contacts/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { buildInviteSmsUrl } from '@/constants/install';
import { AVARPUS_BLUE } from '@/constants/brand';
import { Avatar } from '@/components/ui/Avatar';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import {
  useChatCapabilities,
  chatMarkRead,
  useChatContactsMatch,
  useChatRoomsCreate,
  useChatRoomsList,
  useChatRoomsArchivedList,
  useChatRoomsDelete,
  useChatRoomsPreferencesUpdate,
  getChatRoomsListQueryKey,
  getChatRoomsArchivedListQueryKey,
} from '@workspace/api-client-react';
import type { ChatContact, ChatRoom } from '@workspace/api-client-react';

const PHONE_BATCH_SIZE = 50;

type DevicePhoneContact = {
  id: string;
  name: string;
  phone: string;
  imageUri?: string;
};

type ContactListItem =
  | { kind: 'registered'; contact: ChatContact }
  | { kind: 'invite'; contact: DevicePhoneContact };

function normalizeIndianPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

function formatRoomTime(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const messageDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((today - messageDay) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function formatMessagePreview(room: ChatRoom): { text: string; icon?: 'image' | 'mic' | 'paperclip' } {
  const message = room.lastMessage;
  if (!message) return { text: 'No messages yet' };
  if (message.kind === 'image') return { text: 'Photo', icon: 'image' };
  if (message.kind === 'audio') return { text: 'Voice message', icon: 'mic' };
  if (message.kind === 'file') return { text: 'Attachment', icon: 'paperclip' };
  return { text: message.body };
}

function RoomItem({
  room,
  currentUserId,
  onPress,
  onLongPress,
  selected,
  colors,
}: {
  room: ChatRoom;
  currentUserId?: string;
  onPress: () => void;
  onLongPress: () => void;
  selected: boolean;
  colors: any;
}) {
  const lastMsg = room.lastMessage;
  const unread = room.unreadCount ?? 0;
  const preview = formatMessagePreview(room);
  const isOutgoing = !!lastMsg && lastMsg.senderId === currentUserId;
  const receiptColor = room.lastMessageStatus === 'read' ? '#53BDEB' : colors.mutedForeground;
  const receiptText = room.lastMessageStatus === 'delivered' || room.lastMessageStatus === 'read' ? '✓✓' : '✓';

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`${selected ? 'Selected, ' : ''}open chat with ${room.name}`}
      accessibilityState={{ selected }}
      testID={`room-item-${room.id}`}
    >
      <View style={[styles.roomItem, selected && { backgroundColor: 'rgba(33, 192, 99, 0.15)' }]}>
        <View style={{ position: 'relative' }}>
          <Avatar
            name={room.name}
            url={room.profilePhoto}
            size={52}
            style={styles.roomAvatar}
          />
          {selected && (
            <View style={[styles.selectionCheckmark, { borderColor: colors.background }]}>
              <Feather name="check" size={12} color="#fff" />
            </View>
          )}
        </View>
        <View style={styles.roomContent}>
          <View style={styles.roomHeader}>
            <Text style={[styles.roomName, { color: colors.foreground }]} numberOfLines={1}>
              {room.name}
            </Text>
            <Text
              style={[
                styles.roomTime,
                { color: unread > 0 && !selected ? '#21C063' : colors.mutedForeground },
              ]}
            >
              {formatRoomTime(lastMsg?.createdAt ?? room.createdAt)}
            </Text>
          </View>
          <View style={styles.roomFooter}>
            {isOutgoing && (
              <Text style={[styles.receiptTicks, { color: receiptColor }]}>
                {receiptText}
              </Text>
            )}
            {preview.icon && (
              <Feather
                name={preview.icon}
                size={14}
                color={colors.mutedForeground}
                style={styles.roomPreviewIcon}
              />
            )}
            <Text style={[styles.roomLastMsg, { color: colors.mutedForeground }]} numberOfLines={1}>
              {isOutgoing && !preview.icon ? `You: ${preview.text}` : preview.text}
            </Text>
            <View style={styles.roomFooterIcons}>
              {room.isPinned && <Feather name="map-pin" size={13} color={colors.mutedForeground} />}
              {room.isMuted && <Feather name="bell-off" size={13} color={colors.mutedForeground} />}
              {unread > 0 && !selected && (
                <View style={styles.unreadBadge}>
                  <Text style={[styles.unreadText, { color: colors.background }]}>
                    {unread > 99 ? '99+' : String(unread)}
                  </Text>
                </View>
              )}
            </View>
          </View>
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
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [roomFilter, setRoomFilter] = useState<'all' | 'unread' | 'archived'>('all');
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set());
  const [bulkActionPending, setBulkActionPending] = useState(false);
  const { confirm } = useConfirmDialog();

  // Contact Discovery State
  const [showContactDiscovery, setShowContactDiscovery] = useState(false);
  const [exactPhone, setExactPhone] = useState('');
  const [matchedContacts, setMatchedContacts] = useState<ChatContact[]>([]);
  const [deviceContacts, setDeviceContacts] = useState<DevicePhoneContact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [contactStatus, setContactStatus] = useState<'idle' | 'loading' | 'denied' | 'empty' | 'error'>('idle');
  const [contactError, setContactError] = useState<string | null>(null);
  const [openingContactId, setOpeningContactId] = useState<string | null>(null);

  const contactsMatch = useChatContactsMatch();
  const roomsCreate = useChatRoomsCreate();
  const preferencesUpdate = useChatRoomsPreferencesUpdate();
  const roomsDelete = useChatRoomsDelete();

  const topPad = Platform.OS === 'web' ? insets.top + 67 : Math.max(insets.top, 20);

  const { data: capData, isLoading: capLoading } = useChatCapabilities();
  const providerConfigured = capData?.matrixAvailable === true;

  const {
    data: roomsData,
    isLoading: roomsLoading,
    isRefetching: roomsRefetching,
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
  const {
    data: archivedRoomsData,
    isLoading: archivedRoomsLoading,
    isRefetching: archivedRoomsRefetching,
    isError: archivedRoomsError,
    refetch: archivedRoomsRefetch,
  } = useChatRoomsArchivedList({
    query: {
      enabled: providerConfigured && roomFilter === 'archived',
      queryKey: getChatRoomsArchivedListQueryKey(),
      refetchInterval: providerConfigured && roomFilter === 'archived' ? 5_000 : false,
      refetchIntervalInBackground: false,
      refetchOnMount: 'always',
    },
  });

  const rooms = useMemo(() => {
    const source = roomFilter === 'archived' ? archivedRoomsData?.rooms : roomsData?.rooms;
    const all = (source ?? []).filter((room) => room.kind === 'customer' || room.kind === 'direct');
    const filtered = roomFilter === 'unread' ? all.filter((room) => (room.unreadCount ?? 0) > 0) : all;
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter(
      (r) => r.name.toLowerCase().includes(q) || r.lastMessage?.body.toLowerCase().includes(q),
    );
  }, [archivedRoomsData, roomFilter, roomsData, search]);

  const isLoading = capLoading || (providerConfigured && (roomFilter === 'archived' ? archivedRoomsLoading : roomsLoading));
  const roomsQueryError = roomFilter === 'archived' ? archivedRoomsError : roomsError;
  const refetchRooms = roomFilter === 'archived' ? archivedRoomsRefetch : roomsRefetch;
  const roomsAreRefetching = roomFilter === 'archived' ? archivedRoomsRefetching : roomsRefetching;

  const invalidateRoomLists = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getChatRoomsArchivedListQueryKey() }),
    ]);
  }, [queryClient]);

  const toggleSelection = (id: string) => {
    const next = new Set(selectedRoomIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedRoomIds(next);
  };

  const clearSelection = () => {
    setSelectedRoomIds(new Set());
  };

  const applyBulkAction = useCallback(async (action: 'pin' | 'mute' | 'archive' | 'restore' | 'delete') => {
    if (bulkActionPending || selectedRoomIds.size === 0) return;
    const sourceRooms = roomFilter === 'archived' ? archivedRoomsData?.rooms : roomsData?.rooms;
    const selected = (sourceRooms ?? []).filter((room) => selectedRoomIds.has(room.id));
    setBulkActionPending(true);
    try {
      if (action === 'delete') {
        await Promise.all([...selectedRoomIds].map((roomId) => roomsDelete.mutateAsync({ roomId })));
      } else {
        const field = action === 'pin' ? 'isPinned' : action === 'mute' ? 'isMuted' : 'isArchived';
        const nextValue = action === 'restore' ? false : !selected.every((room) => room[field] === true);
        await Promise.all(
          [...selectedRoomIds].map((roomId) =>
            preferencesUpdate.mutateAsync({ roomId, data: { [field]: nextValue } }),
          ),
        );
      }
      clearSelection();
      await invalidateRoomLists();
    } catch {
      Alert.alert('Could not update chats', 'Please check your connection and try again.');
    } finally {
      setBulkActionPending(false);
    }
  }, [archivedRoomsData?.rooms, bulkActionPending, invalidateRoomLists, preferencesUpdate, roomFilter, roomsData?.rooms, roomsDelete, selectedRoomIds]);

  const handleBulkAction = useCallback((action: 'pin' | 'mute' | 'archive' | 'restore' | 'delete') => {
    if (action !== 'delete') {
      void applyBulkAction(action);
      return;
    }
    confirm({
      title: selectedRoomIds.size === 1 ? 'Delete chat?' : `Delete ${selectedRoomIds.size} chats?`,
      message: 'This hides the chats only for you. Nobody else’s history is touched.',
      actions: [
        {
          label: 'Delete for me',
          description: 'Remove only from this device',
          tone: 'destructive',
          onPress: () => applyBulkAction('delete'),
        },
      ],
    });
  }, [applyBulkAction, confirm, selectedRoomIds]);

  const handleReadAll = useCallback(async () => {
    setShowOverflowMenu(false);
    clearSelection();
    const unreadRooms = (roomsData?.rooms ?? []).filter((room) => (room.unreadCount ?? 0) > 0 && !!room.lastMessage?.id);
    if (!unreadRooms.length) return;
    try {
      await Promise.all(unreadRooms.map((room) => chatMarkRead(room.id, { messageId: room.lastMessage!.id })));
      await invalidateRoomLists();
    } catch {
      Alert.alert('Could not mark chats as read', 'Please check your connection and try again.');
    }
  }, [invalidateRoomLists, roomsData?.rooms]);

  const handleOverflowAction = useCallback((action: string) => {
    setShowOverflowMenu(false);
    clearSelection();
    if (action === 'linked-devices') {
      router.push('/(tabs)/more/account');
      return;
    }
    if (action === 'settings') {
      router.push('/(tabs)/more/settings');
      return;
    }
    if (action === 'toggle-archived') {
      setRoomFilter((current) => (current === 'archived' ? 'all' : 'archived'));
      return;
    }
    Alert.alert('Not available yet', 'This option will be available when group messaging is enabled for Avarpus.');
  }, [router]);

  const openDirectChat = useCallback(async (contact: ChatContact) => {
    if (openingContactId) return;
    setOpeningContactId(contact.userId);
    setContactError(null);
    try {
      const result = await roomsCreate.mutateAsync({
        data: { name: contact.name, kind: 'direct', targetUserId: contact.userId, matchToken: contact.matchToken },
      });
      await invalidateRoomLists();
      setShowContactDiscovery(false);
      router.push(`/(tabs)/customers/chat/${result.room.id}?name=${encodeURIComponent(contact.name)}`);
    } catch (error: any) {
      setContactStatus('error');
      setContactError(error?.data?.message ?? error?.message ?? 'Could not start this conversation. Please try again.');
    } finally {
      setOpeningContactId(null);
    }
  }, [invalidateRoomLists, openingContactId, roomsCreate, router]);

  const matchPhones = useCallback(async (phones: string[]) => {
    if (!phones.length) {
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
      const currentPermission = await Contacts.getPermissionsAsync();
      const permission = currentPermission.granted || !currentPermission.canAskAgain
        ? currentPermission
        : await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        setContactStatus('denied');
        setContactsLoaded(true);
        return;
      }
      const result = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Image],
        sort: Contacts.SortTypes.FirstName,
      });
      const byPhone = new Map<string, DevicePhoneContact>();
      result.data.forEach((contact) => {
        (contact.phoneNumbers ?? []).forEach((entry, index) => {
          const phone = normalizeIndianPhone(entry.number ?? '');
          if (!phone || byPhone.has(phone)) return;
          byPhone.set(phone, {
            id: `${contact.id}-${index}`,
            name: contact.name?.trim() || entry.number || phone,
            phone,
            imageUri: contact.image?.uri,
          });
        });
      });
      const discovered = [...byPhone.values()];
      const phones = discovered.map((contact) => contact.phone);
      setDeviceContacts(discovered);
      setContactsLoaded(true);
      await matchPhones(phones);
    } catch (error: any) {
      setContactsLoaded(true);
      setContactStatus('error');
      setContactError(error?.message ?? 'Could not read your contacts. Please try again.');
    }
  }, [matchPhones]);

  useEffect(() => {
    if (!showContactDiscovery || contactsLoaded || contactStatus === 'loading') return;
    void discoverContacts();
  }, [contactStatus, contactsLoaded, discoverContacts, showContactDiscovery]);

  const lookupExactPhone = useCallback(async () => {
    const phone = normalizeIndianPhone(exactPhone);
    if (!phone) {
      setContactStatus('error');
      setContactError('Enter a valid 10-digit mobile number.');
      return;
    }
    await matchPhones([phone]);
  }, [exactPhone, matchPhones]);

  const registeredPhoneSet = useMemo(
    () => new Set(matchedContacts.map((contact) => normalizeIndianPhone(contact.mobile ?? '')).filter(Boolean)),
    [matchedContacts],
  );
  const deviceContactByPhone = useMemo(
    () => new Map(deviceContacts.map((contact) => [contact.phone, contact])),
    [deviceContacts],
  );
  const contactQuery = exactPhone.trim().toLowerCase();
  const contactQueryPhone = normalizeIndianPhone(exactPhone) ?? exactPhone.replace(/\D/g, '');
  const visibleRegisteredContacts = useMemo(
    () => matchedContacts.filter((contact) => {
      const deviceContact = deviceContactByPhone.get(normalizeIndianPhone(contact.mobile ?? '') ?? '');
      return !contactQuery
        || contact.name.toLowerCase().includes(contactQuery)
        || deviceContact?.name.toLowerCase().includes(contactQuery)
        || contact.mobile.includes(contactQueryPhone);
    }),
    [contactQuery, contactQueryPhone, deviceContactByPhone, matchedContacts],
  );
  const visibleInviteContacts = useMemo(
    () => deviceContacts.filter((contact) =>
      !registeredPhoneSet.has(contact.phone)
      && (!contactQuery
        || contact.name.toLowerCase().includes(contactQuery)
        || contact.phone.includes(contactQueryPhone)),
    ),
    [contactQuery, contactQueryPhone, deviceContacts, registeredPhoneSet],
  );
  const contactSections = useMemo(() => {
    const sections: Array<{ title: string; data: ContactListItem[] }> = [
      {
        title: 'Contacts on Avarpus',
        data: visibleRegisteredContacts.map((contact) => ({ kind: 'registered', contact })),
      },
      {
        title: 'Invite to Avarpus',
        data: visibleInviteContacts.map((contact) => ({ kind: 'invite', contact })),
      },
    ];
    return sections.filter((section) => section.data.length > 0);
  }, [visibleInviteContacts, visibleRegisteredContacts]);

  const callContact = useCallback(async (phone: string) => {
    try {
      await Linking.openURL(`tel:+91${phone}`);
    } catch {
      Alert.alert('Could not start call', 'This device could not open the phone dialler.');
    }
  }, []);

  const inviteContact = useCallback(async (phone: string) => {
    try {
      await Linking.openURL(buildInviteSmsUrl(phone));
    } catch {
      Alert.alert('Could not open messages', 'This device could not open the SMS app.');
    }
  }, []);

  const renderSelectionHeader = () => (
    <View style={[styles.selectionHeader, { paddingTop: topPad, backgroundColor: '#1F2C34' }]}>
      <View style={styles.selectionHeaderLeft}>
        <TouchableOpacity onPress={clearSelection} style={styles.iconButton} accessibilityLabel="Exit selection mode">
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.selectionCount} testID="selected-room-count">{selectedRoomIds.size}</Text>
      </View>
      <View style={styles.selectionHeaderRight}>
        {roomFilter === 'archived' ? (
          <TouchableOpacity disabled={bulkActionPending} onPress={() => handleBulkAction('restore')} style={styles.iconButton} accessibilityLabel="Restore selected chats">
            <Feather name="rotate-ccw" size={20} color="#fff" />
          </TouchableOpacity>
        ) : (
          <>
        <TouchableOpacity disabled={bulkActionPending} onPress={() => handleBulkAction('pin')} style={styles.iconButton} accessibilityLabel="Pin selected chats">
          <Feather name="map-pin" size={20} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity disabled={bulkActionPending} onPress={() => handleBulkAction('delete')} style={styles.iconButton} accessibilityLabel="Delete selected chats">
          <Feather name="trash-2" size={20} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity disabled={bulkActionPending} onPress={() => handleBulkAction('mute')} style={styles.iconButton} accessibilityLabel="Mute selected chats">
          <Feather name="bell-off" size={20} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity disabled={bulkActionPending} onPress={() => handleBulkAction('archive')} style={styles.iconButton} accessibilityLabel="Archive selected chats">
          <Feather name="archive" size={20} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowOverflowMenu(true)} style={styles.iconButton} accessibilityLabel="More selection actions">
          <Feather name="more-vertical" size={20} color="#fff" />
        </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

  const renderNormalHeader = () => (
    <View style={[styles.normalHeaderContainer, { paddingTop: topPad }]}>
      <View style={styles.topAppBar}>
        <Text style={[styles.appTitle, { color: colors.foreground }]}>Avarpus</Text>
        <View style={styles.appBarActions}>
          {/* Refresh activity reads as its own indicator; the menu stays a menu. */}
          <View style={styles.headerBusySlot}>
            {roomsAreRefetching ? <AvarpusSpinner size={18} /> : null}
          </View>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setShowOverflowMenu(true)}
            accessibilityLabel="Open chat menu"
            testID="account-menu-control"
          >
            <Feather name="more-vertical" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, { backgroundColor: colors.backgroundSecondary }]}>
          <View style={styles.searchBarLeft}>
            <Feather name="search" size={18} color={colors.mutedForeground} />
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search conversations"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            returnKeyType="search"
            testID="chat-search-input"
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear chat search">
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Fixed Header */}
      {selectedRoomIds.size > 0 ? (
        <View style={{ backgroundColor: colors.background }}>
          {renderSelectionHeader()}
          <View style={[styles.searchContainer, styles.selectionSearchContainer]}>
            <View style={[styles.searchBar, { backgroundColor: colors.backgroundSecondary }]}>
              <Feather name="search" size={18} color={colors.mutedForeground} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search conversations"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.searchInput, { color: colors.foreground }]}
                returnKeyType="search"
              />
              {!!search && (
                <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear chat search">
                  <Feather name="x" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      ) : renderNormalHeader()}

      <FlatList
        data={rooms}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <RoomItem
            room={item}
            currentUserId={user?.id}
            colors={colors}
            selected={selectedRoomIds.has(item.id)}
            onPress={() => {
              if (selectedRoomIds.size > 0) {
                toggleSelection(item.id);
                return;
              }
              router.push(`/(tabs)/customers/chat/${item.id}?name=${encodeURIComponent(item.name)}`);
            }}
            onLongPress={() => {
              if (selectedRoomIds.size === 0) {
                toggleSelection(item.id);
              }
            }}
          />
        )}
        ListEmptyComponent={
          !isLoading && providerConfigured ? (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {search ? `No results for "${search}"` : roomFilter === 'archived' ? 'No archived chats' : 'No conversations yet'}
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* States Overlays (Loading, Errors) */}
      {isLoading && (
        <View style={styles.centeredState}>
          <AvarpusSpinner size={40} />
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>Loading conversations…</Text>
        </View>
      )}

      {!providerConfigured && !isLoading && (
        <View style={styles.centeredState}>
          <Feather name="message-square" size={32} color={colors.mutedForeground} style={{ marginBottom: 12 }} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Chat provider not configured</Text>
        </View>
      )}

      {roomsQueryError && (
        <View style={styles.centeredState}>
          <Feather name="alert-circle" size={32} color={colors.destructive} style={{ marginBottom: 12 }} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Could not load conversations</Text>
          <TouchableOpacity onPress={() => refetchRooms()} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Floating Action Button */}
      {providerConfigured && roomFilter !== 'archived' && selectedRoomIds.size === 0 && (
        <TouchableOpacity
          // Sit 5 above the tab bar, which is a fixed 84 on web and
          // 62 plus the safe-area inset on native.
          style={[styles.fab, { bottom: (Platform.OS === 'web' ? 84 : 62 + Math.max(insets.bottom, 8)) + 5 }]}
          activeOpacity={0.8}
          onPress={() => setShowContactDiscovery(true)}
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
          testID="new-chat-control"
        >
          <Feather name="message-square" size={24} color="#FFFFFF" />
          <View style={[styles.fabPlusBadge, { backgroundColor: AVARPUS_BLUE }]}>
            <Feather name="plus" size={12} color="#FFFFFF" />
          </View>
        </TouchableOpacity>
      )}

      {/* Overflow Menu Modal */}
      <Modal
        visible={showOverflowMenu}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowOverflowMenu(false)}
      >
        <Pressable style={styles.overflowBackdrop} onPress={() => setShowOverflowMenu(false)}>
          <Pressable
            style={[styles.overflowMenu, { top: topPad + 40, backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            {[
              { id: 'new-group', label: 'New group' },
              { id: 'new-community', label: 'New community' },
              { id: 'read-all', label: 'Read all' },
              { id: 'toggle-archived', label: roomFilter === 'archived' ? 'All chats' : 'Archived' },
              { id: 'settings', label: 'Settings' },
            ].map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.overflowMenuItem}
                onPress={() => item.id === 'read-all' ? void handleReadAll() : handleOverflowAction(item.id)}
              >
                <Text style={[styles.overflowMenuLabel, { color: colors.foreground }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showContactDiscovery}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowContactDiscovery(false)}
      >
        <View style={[styles.contactScreen, { backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? topPad : insets.top }]}>
          <View style={[styles.contactDiscoveryHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setShowContactDiscovery(false)}
              style={styles.iconButton}
              accessibilityLabel="Close contact picker"
            >
              <Feather name="arrow-left" size={24} color={colors.foreground} />
            </TouchableOpacity>
            <View style={styles.contactHeaderTitle}>
              <Text style={[styles.contactTitle, { color: colors.foreground }]}>Select contact</Text>
              <Text style={[styles.contactCount, { color: colors.mutedForeground }]}>
                {!contactsLoaded
                  ? 'Loading contacts…'
                  : contactStatus === 'loading'
                    ? `${deviceContacts.length} contacts · checking who is on Avarpus…`
                    : `${deviceContacts.length} contacts · ${matchedContacts.length} on Avarpus`}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setContactsLoaded(false);
                setContactStatus('idle');
              }}
              style={styles.iconButton}
              accessibilityLabel="Find contacts on this device"
            >
              <Feather name="refresh-cw" size={20} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={[styles.contactSearchBar, { backgroundColor: colors.backgroundSecondary }]}>
            <Feather name="search" size={20} color={colors.mutedForeground} />
            <TextInput
              value={exactPhone}
              onChangeText={setExactPhone}
              placeholder="Search name or number"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.contactSearchInput, { color: colors.foreground }]}
              accessibilityLabel="Exact mobile number"
            />
            {!!exactPhone && (
              <TouchableOpacity onPress={() => setExactPhone('')} accessibilityLabel="Clear contact search">
                <Feather name="x" size={19} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={lookupExactPhone} accessibilityLabel="Find registered contact">
              <Feather name="search" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {contactStatus === 'loading' ? (
            <View style={styles.contactLoading}>
              <AvarpusSpinner size={20} />
              <Text style={{ color: colors.mutedForeground }}>Checking your contacts on Avarpus…</Text>
            </View>
          ) : contactStatus === 'denied' ? (
            <View style={styles.contactPermissionState}>
              <Feather name="users" size={36} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Allow contacts access</Text>
              <Text style={[styles.contactPermissionText, { color: colors.mutedForeground }]}>
                Contacts permission was denied. Allow access so Avarpus can show who is registered and who you can invite.
              </Text>
              <TouchableOpacity onPress={() => void Linking.openSettings()} style={[styles.permissionButton, { backgroundColor: colors.primary }]}>
                <Text style={styles.permissionButtonText}>Open settings</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <SectionList<ContactListItem>
              sections={contactSections}
              keyExtractor={(item) => item.kind === 'registered' ? item.contact.userId : item.contact.id}
              stickySectionHeadersEnabled
              keyboardShouldPersistTaps="handled"
              renderSectionHeader={({ section }) => (
                <View style={[styles.contactSectionHeader, { backgroundColor: colors.background }]}>
                  <Text style={[styles.contactSectionTitle, { color: colors.mutedForeground }]}>{section.title}</Text>
                </View>
              )}
              renderItem={({ item }) => item.kind === 'registered' ? (
                <TouchableOpacity
                  onPress={() => void openDirectChat(item.contact)}
                  disabled={openingContactId !== null}
                  style={[styles.contactItem, { opacity: openingContactId === item.contact.userId ? 0.5 : 1 }]}
                  testID={`matched-contact-${item.contact.userId}`}
                >
                  <Avatar
                    name={deviceContactByPhone.get(normalizeIndianPhone(item.contact.mobile ?? '') ?? '')?.name ?? item.contact.name}
                    url={deviceContactByPhone.get(normalizeIndianPhone(item.contact.mobile ?? '') ?? '')?.imageUri ?? item.contact.profilePhoto}
                    size={48}
                  />
                  <View style={styles.contactDetails}>
                    <Text style={[styles.contactName, { color: colors.foreground }]} numberOfLines={1}>
                      {deviceContactByPhone.get(normalizeIndianPhone(item.contact.mobile ?? '') ?? '')?.name ?? item.contact.name}
                    </Text>
                    <Text style={[styles.contactPhone, { color: colors.mutedForeground }]}>+91 {item.contact.mobile}</Text>
                  </View>
                  <TouchableOpacity onPress={() => void openDirectChat(item.contact)} style={styles.contactRowAction} accessibilityLabel={`Message ${item.contact.name}`}>
                    <Feather name="message-circle" size={21} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => void callContact(item.contact.mobile)} style={styles.contactRowAction} accessibilityLabel={`Call ${item.contact.name}`}>
                    <Feather name="phone" size={20} color={colors.primary} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ) : (
                <View style={styles.contactItem}>
                  <Avatar name={item.contact.name} url={item.contact.imageUri} size={48} />
                  <View style={styles.contactDetails}>
                    <Text style={[styles.contactName, { color: colors.foreground }]} numberOfLines={1}>{item.contact.name}</Text>
                    <Text style={[styles.contactPhone, { color: colors.mutedForeground }]}>+91 {item.contact.phone}</Text>
                  </View>
                  <TouchableOpacity onPress={() => void inviteContact(item.contact.phone)} style={styles.inviteAction} accessibilityLabel={`Invite ${item.contact.name}`}>
                    <Text style={[styles.inviteText, { color: colors.primary }]}>Invite</Text>
                  </TouchableOpacity>
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.contactPermissionState}>
                  <Text style={[styles.contactPermissionText, { color: colors.mutedForeground }]}>
                    {contactStatus === 'error' ? contactError : exactPhone ? 'No contacts match your search.' : 'No phone contacts were found.'}
                  </Text>
                </View>
              }
              contentContainerStyle={styles.contactListContent}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

export default function HomeScreen() {
  return <CustomerInboxScreen />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  normalHeaderContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  topAppBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 56,
  },
  appTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  headerBusySlot: { width: 18, alignItems: 'center', justifyContent: 'center' },
  appBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    marginTop: 4,
  },
  selectionSearchContainer: {
    marginTop: 0,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 16,
  },
  searchBarLeft: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    paddingVertical: 0,
  },
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 72,
    paddingHorizontal: 8,
  },
  selectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  selectionCount: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  selectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 80, // room for FAB
  },
  roomItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  roomAvatar: {
    borderWidth: 0,
  },
  selectionCheckmark: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#21C063',
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomContent: {
    flex: 1,
    marginLeft: 14,
    minWidth: 0,
  },
  roomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  roomName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    flex: 1,
    marginRight: 12,
  },
  roomTime: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  roomFooter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  receiptTicks: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: -2,
    marginRight: 4,
  },
  roomPreviewIcon: {
    marginRight: 4,
  },
  roomLastMsg: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    flex: 1,
  },
  roomFooterIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  unreadBadge: {
    backgroundColor: '#21C063',
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  fab: {
    position: 'absolute',
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 16,
    // Matches the sign-in screen's brand blue.
    backgroundColor: AVARPUS_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  // Sits on the message icon's top-right corner instead of floating loose.
  fabPlusBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredState: {
    position: 'absolute',
    top: 200,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  overflowBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  overflowMenu: {
    position: 'absolute',
    right: 10,
    width: 214,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  overflowMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  overflowMenuLabel: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  contactDiscoveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  contactScreen: {
    flex: 1,
  },
  contactHeaderTitle: {
    flex: 1,
    marginLeft: 8,
  },
  contactTitle: {
    fontSize: 19,
    fontFamily: 'Inter_600SemiBold',
  },
  contactCount: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  contactSearchBar: {
    minHeight: 46,
    marginHorizontal: 14,
    marginVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  contactSearchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  contactLoading: {
    paddingTop: 42,
    alignItems: 'center',
    gap: 12,
  },
  contactPermissionState: {
    paddingHorizontal: 32,
    paddingTop: 56,
    alignItems: 'center',
    gap: 12,
  },
  contactPermissionText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  permissionButton: {
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 22,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  contactListContent: {
    paddingBottom: 28,
  },
  contactSectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  contactSectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  contactDetails: {
    flex: 1,
    minWidth: 0,
    marginLeft: 14,
  },
  contactName: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
  },
  contactPhone: {
    marginTop: 3,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  contactRowAction: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteAction: {
    minWidth: 58,
    paddingVertical: 10,
    alignItems: 'flex-end',
  },
  inviteText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
