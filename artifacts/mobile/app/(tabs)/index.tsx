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
import { useFocusEffect, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Contacts from 'expo-contacts/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { buildInviteSmsUrl } from '@/constants/install';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';
import { Avatar } from '@/components/ui/Avatar';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { useDeviceContactNames } from '@/hooks/useDeviceContactNames';
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
import { useChatStore } from '@/context/ChatStoreContext';
import { useLocalRooms } from '@/hooks/useLocalChat';
import { ChatSyncBanner } from '@/components/chat/ChatSyncBanner';

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
  // A room without messages shows an empty preview line, not placeholder copy.
  if (!message) return { text: '' };
  if (message.kind === 'image') return { text: 'Photo', icon: 'image' };
  if (message.kind === 'audio') return { text: 'Voice message', icon: 'mic' };
  if (message.kind === 'file') return { text: 'Attachment', icon: 'paperclip' };
  return { text: message.body };
}

function RoomItem({
  room,
  displayName,
  currentUserId,
  onPress,
  onAvatarPress,
  onLongPress,
  selected,
  selecting,
  colors,
}: {
  room: ChatRoom;
  displayName: string;
  currentUserId?: string;
  onPress: () => void;
  /** Tapping the photo opens the peer's profile; the rest of the row opens the chat. */
  onAvatarPress: () => void;
  onLongPress: () => void;
  selected: boolean;
  /** True while any room is selected; the photo then toggles selection instead. */
  selecting: boolean;
  colors: any;
}) {
  const lastMsg = room.lastMessage;
  const unread = room.unreadCount ?? 0;
  const preview = formatMessagePreview(room);
  const isOutgoing = !!lastMsg && lastMsg.senderId === currentUserId;
  const receiptColor = room.lastMessageStatus === 'read' ? colors.primary : colors.mutedForeground;
  const receiptText = room.lastMessageStatus === 'delivered' || room.lastMessageStatus === 'read' ? '✓✓' : '✓';

  // The row is a plain container with two sibling controls: the photo (opens
  // the peer's profile) and the rest of the row (opens the chat). Siblings —
  // not nested touchables — so each stays independently reachable to screen
  // readers and neither steals the other's long-press.
  return (
    <View
      style={[styles.roomItem, selected && { backgroundColor: colors.accent }]}
      testID={`room-row-${room.id}`}
    >
        <TouchableOpacity
          style={{ position: 'relative' }}
          onPress={onAvatarPress}
          onLongPress={onLongPress}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel={
            selecting
              ? `${selected ? 'Selected, ' : ''}toggle selection of ${displayName}`
              : `View profile of ${displayName}`
          }
          accessibilityState={{ selected }}
          testID={`room-avatar-${room.id}`}
        >
          <Avatar
            name={displayName}
            url={room.profilePhoto}
            size={size.avatar}
            style={styles.roomAvatar}
          />
          {selected && (
            <View
              style={[
                styles.selectionCheckmark,
                { backgroundColor: colors.primary, borderColor: colors.background },
              ]}
            >
              <Feather name="check" size={13} color="#FFFFFF" />
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.roomContent}
          onPress={onPress}
          onLongPress={onLongPress}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel={
            selecting
              ? `${selected ? 'Selected, ' : ''}toggle selection of ${displayName}`
              : `Open chat with ${displayName}`
          }
          accessibilityState={{ selected }}
          testID={`room-item-${room.id}`}
        >
          <View style={styles.roomHeader}>
            <Text style={[styles.roomName, { color: colors.foreground }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text
              style={[
                styles.roomTime,
                { color: unread > 0 && !selected ? colors.notification : colors.mutedForeground },
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
                size={16}
                color={colors.mutedForeground}
                style={styles.roomPreviewIcon}
              />
            )}
            <Text style={[styles.roomLastMsg, { color: colors.mutedForeground }]} numberOfLines={1}>
              {isOutgoing && !preview.icon ? `You: ${preview.text}` : preview.text}
            </Text>
            <View style={styles.roomFooterIcons}>
              {room.isPinned && <Feather name="map-pin" size={18} color={colors.mutedForeground} />}
              {room.isMuted && <Feather name="bell-off" size={18} color={colors.mutedForeground} />}
              {unread > 0 && !selected && (
                <View style={[styles.unreadBadge, { backgroundColor: colors.notification }]}>
                  <Text style={styles.unreadText}>
                    {unread > 99 ? '99+' : String(unread)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
    </View>
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
  const searchInputRef = useRef<TextInput>(null);

  const contactsMatch = useChatContactsMatch();
  const roomsCreate = useChatRoomsCreate();
  const preferencesUpdate = useChatRoomsPreferencesUpdate();
  const roomsDelete = useChatRoomsDelete();
  const deviceContactNames = useDeviceContactNames();
  const nameForRoom = useCallback(
    (room: ChatRoom) => deviceContactNames.nameFor(room.peerMobile, room.name),
    [deviceContactNames],
  );

  const topPad = Platform.OS === 'web' ? insets.top + 67 : Math.max(insets.top, 20);

  const { data: capData, isLoading: capLoading } = useChatCapabilities();
  const providerConfigured = capData?.matrixAvailable === true;

  // Local-first: when the device store is open the inbox renders from it and
  // the sync engine refreshes it (foreground, push, focus, slow poll). The
  // network queries below stay as the fallback when no store could be opened.
  const { store: chatStore, ready: storeReady, status: syncStatus, requestSync } = useChatStore();
  const localFirst = !!chatStore;
  const networkRooms = providerConfigured && storeReady && !localFirst;

  useFocusEffect(
    useCallback(() => {
      if (localFirst && providerConfigured) void requestSync('inbox');
    }, [localFirst, providerConfigured, requestSync]),
  );

  const {
    data: roomsData,
    isLoading: roomsLoading,
    isRefetching: roomsRefetching,
    isError: roomsError,
    refetch: roomsRefetch,
  } = useChatRoomsList({
    query: {
      enabled: networkRooms,
      queryKey: getChatRoomsListQueryKey(),
      refetchInterval: networkRooms ? 5_000 : false,
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
      enabled: networkRooms && roomFilter === 'archived',
      queryKey: getChatRoomsArchivedListQueryKey(),
      refetchInterval: networkRooms && roomFilter === 'archived' ? 5_000 : false,
      refetchIntervalInBackground: false,
      refetchOnMount: 'always',
    },
  });
  const localRooms = useLocalRooms(localFirst && providerConfigured);

  const activeRooms = useMemo<ChatRoom[]>(() => {
    if (localFirst) return (localRooms.data ?? []).filter((room) => !room.deletedAt && !room.isArchived);
    return roomsData?.rooms ?? [];
  }, [localFirst, localRooms.data, roomsData]);
  const archivedRooms = useMemo<ChatRoom[]>(() => {
    if (localFirst) return (localRooms.data ?? []).filter((room) => !room.deletedAt && room.isArchived === true);
    return archivedRoomsData?.rooms ?? [];
  }, [archivedRoomsData, localFirst, localRooms.data]);

  const rooms = useMemo(() => {
    const source = roomFilter === 'archived' ? archivedRooms : activeRooms;
    const all = source.filter((room) => room.kind === 'customer' || room.kind === 'direct');
    const filtered = roomFilter === 'unread' ? all.filter((room) => (room.unreadCount ?? 0) > 0) : all;
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter(
      (r) => r.name.toLowerCase().includes(q) || r.lastMessage?.body.toLowerCase().includes(q),
    );
  }, [activeRooms, archivedRooms, roomFilter, search]);

  const localBootstrapping =
    localFirst && !syncStatus.bootstrapped && (localRooms.data?.length ?? 0) === 0 && (syncStatus.syncing || !syncStatus.error);
  const isLoading =
    capLoading ||
    !storeReady ||
    (providerConfigured &&
      (localFirst
        ? localRooms.loading || localBootstrapping
        : roomFilter === 'archived'
          ? archivedRoomsLoading
          : roomsLoading));
  const roomsQueryError = localFirst
    ? !!syncStatus.error && !syncStatus.bootstrapped && (localRooms.data?.length ?? 0) === 0
    : roomFilter === 'archived'
      ? archivedRoomsError
      : roomsError;
  const refetchRooms = localFirst
    ? () => requestSync('manual')
    : roomFilter === 'archived'
      ? archivedRoomsRefetch
      : roomsRefetch;
  const roomsAreRefetching = localFirst
    ? syncStatus.syncing && syncStatus.bootstrapped
    : roomFilter === 'archived'
      ? archivedRoomsRefetching
      : roomsRefetching;

  const invalidateRoomLists = useCallback(async () => {
    if (localFirst) {
      await requestSync('manual');
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getChatRoomsArchivedListQueryKey() }),
    ]);
  }, [localFirst, queryClient, requestSync]);

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
    const sourceRooms = roomFilter === 'archived' ? archivedRooms : activeRooms;
    const selected = sourceRooms.filter((room) => selectedRoomIds.has(room.id));
    setBulkActionPending(true);
    try {
      if (action === 'delete') {
        const deletedAt = new Date().toISOString();
        await Promise.all(
          [...selectedRoomIds].map(async (roomId) => {
            await roomsDelete.mutateAsync({ roomId });
            // Mirror the server-side preference so the row leaves the inbox now.
            await chatStore?.setRoomPreference(roomId, { deletedAt });
          }),
        );
      } else {
        const field = action === 'pin' ? 'isPinned' : action === 'mute' ? 'isMuted' : 'isArchived';
        const nextValue = action === 'restore' ? false : !selected.every((room) => room[field] === true);
        await Promise.all(
          [...selectedRoomIds].map(async (roomId) => {
            await preferencesUpdate.mutateAsync({ roomId, data: { [field]: nextValue } });
            await chatStore?.setRoomPreference(roomId, { [field]: nextValue });
          }),
        );
      }
      clearSelection();
      await invalidateRoomLists();
    } catch {
      Alert.alert('Could not update chats', 'Please check your connection and try again.');
    } finally {
      setBulkActionPending(false);
    }
  }, [activeRooms, archivedRooms, bulkActionPending, chatStore, invalidateRoomLists, preferencesUpdate, roomFilter, roomsDelete, selectedRoomIds]);

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
    const unreadRooms = activeRooms.filter((room) => (room.unreadCount ?? 0) > 0 && !!room.lastMessage?.id);
    if (!unreadRooms.length) return;
    try {
      await Promise.all(
        unreadRooms.map(async (room) => {
          await chatMarkRead(room.id, { messageId: room.lastMessage!.id });
          if (chatStore && user?.id) {
            await chatStore.applyReadStates([
              {
                roomId: room.id,
                userId: user.id,
                lastReadMessageId: room.lastMessage!.id,
                lastReadAt: new Date().toISOString(),
              },
            ]);
          }
        }),
      );
      await invalidateRoomLists();
    } catch {
      Alert.alert('Could not mark chats as read', 'Please check your connection and try again.');
    }
  }, [activeRooms, chatStore, invalidateRoomLists, user?.id]);

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
    if (action === 'toggle-unread') {
      setRoomFilter((current) => (current === 'unread' ? 'all' : 'unread'));
      return;
    }
    if (action === 'scan-repair') {
      router.push('/(tabs)/repairs/scanner');
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
    <View style={[styles.selectionHeader, { paddingTop: topPad, backgroundColor: colors.secondary }]}>
      <View style={styles.selectionHeaderLeft}>
        <TouchableOpacity onPress={clearSelection} style={styles.iconButton} accessibilityLabel="Exit selection mode">
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.selectionCount, { color: colors.foreground }]} testID="selected-room-count">{selectedRoomIds.size}</Text>
      </View>
      <View style={styles.selectionHeaderRight}>
        {roomFilter === 'archived' ? (
          <TouchableOpacity disabled={bulkActionPending} onPress={() => handleBulkAction('restore')} style={styles.iconButton} accessibilityLabel="Restore selected chats">
            <Feather name="rotate-ccw" size={22} color={colors.foreground} />
          </TouchableOpacity>
        ) : (
          <>
        <TouchableOpacity disabled={bulkActionPending} onPress={() => handleBulkAction('pin')} style={styles.iconButton} accessibilityLabel="Pin selected chats">
          <Feather name="map-pin" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity disabled={bulkActionPending} onPress={() => handleBulkAction('delete')} style={styles.iconButton} accessibilityLabel="Delete selected chats">
          <Feather name="trash-2" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity disabled={bulkActionPending} onPress={() => handleBulkAction('mute')} style={styles.iconButton} accessibilityLabel="Mute selected chats">
          <Feather name="bell-off" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity disabled={bulkActionPending} onPress={() => handleBulkAction('archive')} style={styles.iconButton} accessibilityLabel="Archive selected chats">
          <Feather name="archive" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowOverflowMenu(true)} style={styles.iconButton} accessibilityLabel="More selection actions">
          <Feather name="more-vertical" size={22} color={colors.foreground} />
        </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

  const renderSearchField = (autoFocusRef: boolean) => (
    <View style={[styles.searchBar, { backgroundColor: colors.secondary }]}>
      <Feather name="search" size={size.headerIcon} color={colors.mutedForeground} />
      <TextInput
        ref={autoFocusRef ? searchInputRef : undefined}
        value={search}
        onChangeText={setSearch}
        placeholder="Search"
        placeholderTextColor={colors.mutedForeground}
        style={[styles.searchInput, { color: colors.foreground }]}
        returnKeyType="search"
        testID={autoFocusRef ? 'chat-search-input' : undefined}
      />
      {!!search && (
        <TouchableOpacity
          onPress={() => setSearch('')}
          accessibilityLabel="Clear chat search"
          style={styles.searchClear}
          hitSlop={8}
        >
          <Feather name="x" size={22} color={colors.mutedForeground} />
        </TouchableOpacity>
      )}
    </View>
  );

  const renderNormalHeader = () => (
    <View style={[styles.normalHeaderContainer, { paddingTop: topPad }]}>
      <View style={styles.topAppBar}>
        <View style={styles.appTitleBlock}>
          <Text style={[styles.appTitle, { color: colors.foreground }]} numberOfLines={1}>
            Avarpus
          </Text>
        </View>
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
            <Feather name="more-vertical" size={size.headerIcon} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchContainer}>{renderSearchField(true)}</View>

      {roomFilter !== 'all' && (
        <View style={styles.activeFilterRow}>
          <View style={[styles.activeFilterChip, { backgroundColor: colors.accent }]}>
            <Text style={[styles.activeFilterText, { color: colors.accentForeground }]}>
              {roomFilter === 'unread' ? 'Unread chats' : 'Archived chats'}
            </Text>
            <TouchableOpacity
              onPress={() => setRoomFilter('all')}
              accessibilityLabel="Show all chats"
              hitSlop={10}
            >
              <Feather name="x" size={18} color={colors.accentForeground} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Fixed Header */}
      {selectedRoomIds.size > 0 ? (
        <View style={{ backgroundColor: colors.background }}>
          {renderSelectionHeader()}
          <View style={[styles.searchContainer, styles.selectionSearchContainer]}>
            {renderSearchField(false)}
          </View>
        </View>
      ) : renderNormalHeader()}

      {localFirst && providerConfigured ? (
        <ChatSyncBanner
          status={syncStatus}
          hasLocalData={(localRooms.data?.length ?? 0) > 0}
          onRetry={() => void requestSync('manual')}
        />
      ) : null}

      <FlatList
        data={rooms}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <RoomItem
            room={item}
            displayName={nameForRoom(item)}
            currentUserId={user?.id}
            colors={colors}
            selected={selectedRoomIds.has(item.id)}
            selecting={selectedRoomIds.size > 0}
            onPress={() => {
              if (selectedRoomIds.size > 0) {
                toggleSelection(item.id);
                return;
              }
              router.push(`/(tabs)/customers/chat/${item.id}?name=${encodeURIComponent(nameForRoom(item))}`);
            }}
            onAvatarPress={() => {
              // While selecting, the photo behaves like the row so the checkmark stays reachable.
              if (selectedRoomIds.size > 0) {
                toggleSelection(item.id);
                return;
              }
              router.push(`/(tabs)/customers/chat/profile/${item.id}?name=${encodeURIComponent(nameForRoom(item))}`);
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
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Floating Action Button */}
      {providerConfigured && roomFilter !== 'archived' && selectedRoomIds.size === 0 && (
        <TouchableOpacity
          // Clear the tab bar (a fixed height plus 20 on web, plus the
          // safe-area inset on native) by one spacing step.
          style={[
            styles.fab,
            {
              backgroundColor: colors.primary,
              bottom: size.tabBar + (Platform.OS === 'web' ? 20 : Math.max(insets.bottom, 12)) + space.lg,
            },
          ]}
          activeOpacity={0.8}
          onPress={() => setShowContactDiscovery(true)}
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
          testID="new-chat-control"
        >
          <Feather name="message-square" size={28} color="#FFFFFF" />
          <View style={styles.fabPlusBadge}>
            <Feather name="plus" size={13} color="#FFFFFF" />
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
            style={[
              styles.overflowMenu,
              { top: topPad + 48, backgroundColor: colors.surfaceElevated, borderColor: colors.border },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            {[
              { id: 'new-group', label: 'New group' },
              { id: 'new-community', label: 'New community' },
              { id: 'read-all', label: 'Read all' },
              { id: 'toggle-unread', label: roomFilter === 'unread' ? 'Show all chats' : 'Unread chats' },
              { id: 'toggle-archived', label: roomFilter === 'archived' ? 'All chats' : 'Archived' },
              { id: 'scan-repair', label: 'Scan repair code' },
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
                    url={item.contact.profilePhoto ?? deviceContactByPhone.get(normalizeIndianPhone(item.contact.mobile ?? '') ?? '')?.imageUri}
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
    paddingHorizontal: layout.screenPadding,
    paddingBottom: space.md,
  },
  topAppBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 64,
  },
  appTitleBlock: {
    flexShrink: 1,
  },
  appTitle: font.display,
  headerBusySlot: { width: 18, alignItems: 'center', justifyContent: 'center' },
  appBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    // Optically align the glyph with the screen's right padding.
    marginRight: -space.sm,
  },
  iconButton: {
    width: size.iconButton,
    height: size.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    marginTop: space.lg,
  },
  selectionSearchContainer: {
    marginTop: 0,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: size.searchField,
    borderRadius: size.searchRadius,
    paddingHorizontal: space.xl,
    gap: space.lg,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    ...font.search,
    paddingVertical: 0,
  },
  searchClear: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -space.sm,
  },
  activeFilterRow: {
    flexDirection: 'row',
    marginTop: space.lg,
  },
  activeFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 36,
    paddingLeft: space.lg,
    paddingRight: space.md,
    borderRadius: 18,
  },
  activeFilterText: font.captionStrong,
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: space.md,
  },
  selectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  selectionCount: font.itemTitle,
  selectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  listContent: {
    flexGrow: 1,
    paddingTop: space.md,
    paddingBottom: size.fab + space.xxxl, // room for FAB
  },
  roomItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: layout.rowPaddingVertical,
    paddingHorizontal: layout.screenPadding,
  },
  roomAvatar: {
    borderWidth: 0,
  },
  selectionCheckmark: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomContent: {
    flex: 1,
    marginLeft: layout.avatarGap,
    minWidth: 0,
  },
  roomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  roomName: {
    ...font.itemTitle,
    flex: 1,
    marginRight: space.md,
  },
  roomTime: font.caption,
  roomFooter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  receiptTicks: {
    ...font.captionStrong,
    fontFamily: fontFamily.semibold,
    letterSpacing: -2,
    marginRight: space.xs,
  },
  roomPreviewIcon: {
    marginRight: 6,
  },
  roomLastMsg: {
    ...font.body,
    flex: 1,
  },
  roomFooterIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
    marginLeft: space.md,
  },
  unreadBadge: {
    minWidth: size.badge,
    height: size.badge,
    borderRadius: size.badge / 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  unreadText: {
    ...font.badge,
    color: '#FFFFFF',
  },
  fab: {
    position: 'absolute',
    right: layout.screenPadding,
    width: size.fab,
    height: size.fab,
    borderRadius: size.fabRadius,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
  },
  // Sits inside the bubble so the glyph reads as "new message".
  fabPlusBadge: {
    position: 'absolute',
    top: 18,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredState: {
    position: 'absolute',
    top: '35%',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
  },
  stateText: {
    ...font.caption,
    marginTop: space.md,
  },
  emptyContainer: {
    padding: space.xxxl,
    alignItems: 'center',
  },
  emptyText: {
    ...font.body,
    textAlign: 'center',
  },
  emptyTitle: {
    ...font.heading,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: space.xl,
    minHeight: size.buttonSm,
    paddingHorizontal: space.xxl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: font.labelStrong,
  overflowBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  overflowMenu: {
    position: 'absolute',
    right: space.md,
    width: 236,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 10,
  },
  overflowMenuItem: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  overflowMenuLabel: font.body,
  contactDiscoveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  contactScreen: {
    flex: 1,
  },
  contactHeaderTitle: {
    flex: 1,
    marginLeft: space.sm,
  },
  contactTitle: font.heading,
  contactCount: {
    marginTop: 2,
    ...font.caption,
  },
  contactSearchBar: {
    minHeight: 52,
    marginHorizontal: layout.screenPadding,
    marginVertical: space.md,
    paddingHorizontal: space.xl,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  contactSearchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: space.sm,
    ...font.input,
  },
  contactLoading: {
    paddingTop: 42,
    alignItems: 'center',
    gap: space.md,
  },
  contactPermissionState: {
    paddingHorizontal: space.xxxl,
    paddingTop: 56,
    alignItems: 'center',
    gap: space.md,
  },
  contactPermissionText: {
    ...font.caption,
    textAlign: 'center',
  },
  permissionButton: {
    marginTop: space.sm,
    minHeight: size.buttonSm,
    paddingHorizontal: space.xxl,
    borderRadius: 22,
    justifyContent: 'center',
  },
  permissionButtonText: {
    color: '#FFFFFF',
    ...font.labelStrong,
  },
  contactListContent: {
    paddingBottom: space.xxl,
  },
  contactSectionHeader: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  contactSectionTitle: font.captionStrong,
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.sm,
  },
  contactDetails: {
    flex: 1,
    minWidth: 0,
    marginLeft: layout.avatarGap,
  },
  contactName: font.bodyStrong,
  contactPhone: {
    marginTop: 2,
    ...font.caption,
  },
  contactRowAction: {
    width: size.iconButton,
    height: size.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteAction: {
    minWidth: 58,
    paddingVertical: space.sm,
    alignItems: 'flex-end',
  },
  inviteText: font.labelStrong,
});
