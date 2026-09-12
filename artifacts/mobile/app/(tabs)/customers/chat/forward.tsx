import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { Avatar } from '@/components/ui/Avatar';
import { useColors } from '@/hooks/useColors';
import { useAvarpusContacts, normalizeIndianPhone, type DevicePhoneContact } from '@/hooks/useAvarpusContacts';
import { storage, KEYS } from '@/utils/storage';
import {
  useChatMessagesList,
  getChatMessagesListQueryKey,
  useChatMessagesSend,
  useChatRoomsCreate,
  useChatRoomsList,
  getChatRoomsListQueryKey,
  getChatRoomsGetQueryKey,
} from '@workspace/api-client-react';
import type { ChatContact, ChatMessage, ChatRoom } from '@workspace/api-client-react';
import { SELECTION_ACCENT, chatMediaUri, describeMessage } from '@/components/chat/messageActions';

/** One selectable destination: an existing room or a matched contact. */
type ContactListItem =
  | { kind: 'registered'; contact: ChatContact }
  | { kind: 'invite'; contact: DevicePhoneContact };

type ForwardTarget =
  | { key: string; kind: 'room'; room: ChatRoom; name: string; photo?: string }
  | { key: string; kind: 'contact'; contact: ChatContact; name: string; photo?: string };

function makeClientRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function CircleCheck({ selected, colors }: { selected: boolean; colors: { border: string } }) {
  return (
    <View
      style={[
        styles.circle,
        selected
          ? { backgroundColor: SELECTION_ACCENT, borderColor: SELECTION_ACCENT }
          : { borderColor: colors.border },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {selected && <Feather name="check" size={14} color="#FFFFFF" />}
    </View>
  );
}

export default function ForwardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useColors();
  const queryClient = useQueryClient();

  const params = useLocalSearchParams<{ roomId: string; messageIds: string }>();
  const sourceRoomId = params.roomId ?? '';
  const messageIds = useMemo(
    () => (params.messageIds ?? '').split(',').map((id) => id.trim()).filter(Boolean),
    [params.messageIds],
  );

  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    storage.get<string>(KEYS.AUTH_TOKEN).then(setToken);
  }, []);

  // ── Source messages (served from the chat screen's cache when present) ──
  const { data: sourceData } = useChatMessagesList(sourceRoomId, undefined, {
    query: {
      enabled: !!sourceRoomId,
      queryKey: getChatMessagesListQueryKey(sourceRoomId),
      staleTime: 30_000,
    },
  });
  const sourceMessages = useMemo(() => {
    const byId = new Map((sourceData?.messages ?? []).map((m) => [m.id, m]));
    return messageIds.map((id) => byId.get(id)).filter((m): m is ChatMessage => !!m && !m.deletedAt);
  }, [messageIds, sourceData?.messages]);

  // ── Destinations ────────────────────────────────────────────────────────
  const { data: roomsData, isLoading: roomsLoading } = useChatRoomsList({
    query: { queryKey: getChatRoomsListQueryKey(), refetchOnMount: 'always' },
  });
  const rooms = useMemo(
    () => (roomsData?.rooms ?? []).filter((room) => room.isBlocked !== true),
    [roomsData?.rooms],
  );

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, ForwardTarget>>(new Map());
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const contacts = useAvarpusContacts();
  const [numberMatches, setNumberMatches] = useState<ChatContact[]>([]);

  const roomTargets = useMemo<ForwardTarget[]>(
    () => rooms.map((room) => ({ key: `room:${room.id}`, kind: 'room', room, name: room.name, photo: room.profilePhoto })),
    [rooms],
  );
  const filteredTargets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roomTargets;
    return roomTargets.filter((target) => target.name.toLowerCase().includes(q));
  }, [roomTargets, search]);

  // A 10-digit query also looks the number up on Avarpus (exact match only).
  const searchPhone = normalizeIndianPhone(search);
  useEffect(() => {
    if (!searchPhone) {
      setNumberMatches([]);
      return;
    }
    let cancelled = false;
    void contacts.lookupExact(searchPhone).then((matches) => {
      if (!cancelled) setNumberMatches(matches);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchPhone]);

  const contactTarget = useCallback((contact: ChatContact): ForwardTarget => {
    const existingRoom = rooms.find((room) => room.kind === 'direct' && room.peerUserId === contact.userId);
    if (existingRoom) {
      return { key: `room:${existingRoom.id}`, kind: 'room', room: existingRoom, name: existingRoom.name, photo: existingRoom.profilePhoto };
    }
    const display = contacts.displayFor(contact);
    return { key: `contact:${contact.userId}`, kind: 'contact', contact, name: display.name, photo: display.photo };
  }, [contacts, rooms]);

  const toggleTarget = useCallback((target: ForwardTarget) => {
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(target.key)) next.delete(target.key);
      else next.set(target.key, target);
      return next;
    });
  }, []);

  const selectedList = useMemo(() => [...selected.values()], [selected]);

  const sendMutation = useChatMessagesSend();
  const roomsCreate = useChatRoomsCreate();

  // Idempotency keys are stable per (target, message) for the lifetime of
  // this screen, so a retry after a partial failure replays the same keys and
  // the server dedupes anything that already landed. Created rooms are also
  // remembered so a retry never provisions a second direct room.
  const sendingRef = useRef(false);
  const requestIdsRef = useRef(new Map<string, string>());
  const createdRoomsRef = useRef(new Map<string, { id: string; name: string }>());
  const requestIdFor = useCallback((scope: string) => {
    const existing = requestIdsRef.current.get(scope);
    if (existing) return existing;
    const fresh = makeClientRequestId('forward');
    requestIdsRef.current.set(scope, fresh);
    return fresh;
  }, []);

  const handleSend = useCallback(async () => {
    if (sendingRef.current || selectedList.length === 0 || sourceMessages.length === 0) return;
    sendingRef.current = true;
    setSending(true);
    const failures: string[] = [];
    const succeeded: ForwardTarget[] = [];
    let lastRoom: { id: string; name: string } | null = null;
    const trimmedNote = note.trim();
    try {
      for (const target of selectedList) {
        try {
          let room: { id: string; name: string };
          if (target.kind === 'room') {
            room = { id: target.room.id, name: target.name };
          } else {
            const remembered = createdRoomsRef.current.get(target.key);
            if (remembered) {
              room = remembered;
            } else {
              const created = await roomsCreate.mutateAsync({
                data: {
                  name: target.contact.name,
                  kind: 'direct',
                  targetUserId: target.contact.userId,
                  matchToken: target.contact.matchToken,
                },
              });
              room = { id: created.room.id, name: target.name };
              createdRoomsRef.current.set(target.key, room);
            }
          }
          for (const message of sourceMessages) {
            await sendMutation.mutateAsync({
              roomId: room.id,
              data: {
                kind: message.kind as 'text' | 'image' | 'file' | 'audio',
                body: message.body,
                clientRequestId: requestIdFor(`${target.key}|${message.id}`),
                forwardOf: { roomId: sourceRoomId, messageId: message.id },
              },
            });
          }
          if (trimmedNote) {
            await sendMutation.mutateAsync({
              roomId: room.id,
              data: {
                kind: 'text',
                body: trimmedNote,
                clientRequestId: requestIdFor(`${target.key}|note|${trimmedNote}`),
              },
            });
          }
          void queryClient.invalidateQueries({ queryKey: getChatMessagesListQueryKey(room.id) });
          void queryClient.invalidateQueries({ queryKey: getChatRoomsGetQueryKey(room.id) });
          succeeded.push(target);
          lastRoom = room;
        } catch (error: any) {
          failures.push(`${target.name}: ${error?.data?.message ?? error?.message ?? 'failed'}`);
        }
      }
    } finally {
      void queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() });
      sendingRef.current = false;
      setSending(false);
    }
    if (failures.length > 0) {
      // Keep only the recipients that still need sending so a retry does not
      // re-deliver to those that already received the messages.
      setSelected((previous) => {
        const next = new Map(previous);
        for (const target of succeeded) next.delete(target.key);
        return next;
      });
      Alert.alert(
        'Some forwards failed',
        `${failures.join('\n')}\n\nThe remaining recipients are still selected — tap send to retry.`,
      );
      return;
    }
    if (selectedList.length === 1 && lastRoom) {
      const single: { id: string; name: string } = lastRoom;
      router.replace(`/(tabs)/customers/chat/${single.id}?name=${encodeURIComponent(single.name)}`);
      return;
    }
    router.back();
  }, [note, queryClient, requestIdFor, roomsCreate, router, selectedList, sendMutation, sourceMessages, sourceRoomId]);

  const openContactPicker = useCallback(() => {
    setContactPickerOpen(true);
    if (!contacts.loaded && contacts.status !== 'loading') void contacts.discover();
  }, [contacts]);

  const pickContact = useCallback((contact: ChatContact) => {
    const target = contactTarget(contact);
    setSelected((previous) => {
      const next = new Map(previous);
      next.set(target.key, target);
      return next;
    });
    setContactPickerOpen(false);
  }, [contactTarget]);

  const inviteContact = useCallback(async (phone: string) => {
    const message = encodeURIComponent('Join me on Avarpus: https://avarpus.com/download');
    const smsUrl = Platform.OS === 'ios' ? `sms:${phone}&body=${message}` : `sms:${phone}?body=${message}`;
    try {
      await Linking.openURL(smsUrl);
    } catch {
      Alert.alert('Could not open messages', 'Share the Avarpus download link with this contact manually.');
    }
  }, []);

  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const numberTargets = numberMatches.map(contactTarget);
  const canSend = selectedList.length > 0 && sourceMessages.length > 0 && !sending;

  const renderTarget = useCallback(({ item }: { item: ForwardTarget }) => {
    const isSelected = selected.has(item.key);
    return (
      <TouchableOpacity
        onPress={() => toggleTarget(item)}
        style={styles.row}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isSelected }}
        accessibilityLabel={item.name}
        testID={`forward-target-${item.key}`}
      >
        <CircleCheck selected={isSelected} colors={colors} />
        <Avatar name={item.name} url={item.photo} size={44} />
        <View style={styles.rowBody}>
          <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
          {item.kind === 'contact' && (
            <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
              {item.contact.mobile}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }, [colors, selected, toggleTarget]);

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: colors.background }]} behavior="padding">
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerIcon} accessibilityLabel="Back" testID="forward-back">
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        {searchOpen ? (
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search name or number"
            placeholderTextColor={colors.mutedForeground}
            autoFocus
            style={[styles.searchInput, { color: colors.foreground }]}
            testID="forward-search-input"
          />
        ) : (
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>Forward to…</Text>
        )}
        <TouchableOpacity onPress={openContactPicker} style={styles.headerIcon} accessibilityLabel="Add contact" testID="forward-add-contact">
          <MaterialCommunityIcons name="account-plus-outline" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            if (searchOpen) setSearch('');
            setSearchOpen((v) => !v);
          }}
          style={styles.headerIcon}
          accessibilityLabel={searchOpen ? 'Close search' : 'Search'}
          testID="forward-search-toggle"
        >
          <Feather name={searchOpen ? 'x' : 'search'} size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* Destinations */}
      {roomsLoading && rooms.length === 0 ? (
        <View style={styles.centered}><AvarpusSpinner size={28} /></View>
      ) : (
        <FlatList
          data={[...numberTargets, ...filteredTargets]}
          keyExtractor={(item) => item.key}
          renderItem={renderTarget}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 200 }}
          ListHeaderComponent={
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {search.trim() ? 'Results' : 'Recent chats'}
            </Text>
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {search.trim() ? 'No chats match this search.' : 'No chats yet. Add a contact to forward.'}
              </Text>
            </View>
          }
        />
      )}

      {/* Composer: forwarded previews + note, then selected names + send */}
      <View
        style={[
          styles.footer,
          { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        <View style={styles.previewRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewStrip}>
            {sourceMessages.map((message) =>
              message.kind === 'image' ? (
                <Image
                  key={message.id}
                  source={{ uri: chatMediaUri(sourceRoomId, message.id), headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
                  style={styles.previewThumb}
                  contentFit="cover"
                  accessibilityLabel="Photo to forward"
                  testID={`forward-preview-${message.id}`}
                />
              ) : (
                <View
                  key={message.id}
                  style={[styles.previewChip, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                  testID={`forward-preview-${message.id}`}
                >
                  {message.kind === 'audio' && <Feather name="mic" size={12} color={colors.mutedForeground} />}
                  {message.kind === 'file' && <Feather name="file" size={12} color={colors.mutedForeground} />}
                  <Text style={[styles.previewChipText, { color: colors.foreground }]} numberOfLines={1}>
                    {describeMessage(message.kind, message.body)}
                  </Text>
                </View>
              ),
            )}
          </ScrollView>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Add a message…"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.noteInput, { color: colors.foreground, backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
            testID="forward-note-input"
          />
        </View>
        {selectedList.length > 0 && (
          <View style={styles.selectedRow} testID="forward-selected-row">
            <Text style={[styles.selectedNames, { color: colors.foreground }]} numberOfLines={2}>
              {selectedList.map((target) => target.name).join(', ')}
            </Text>
            <TouchableOpacity
              onPress={() => void handleSend()}
              disabled={!canSend}
              style={[styles.sendButton, { backgroundColor: colors.success, opacity: canSend ? 1 : 0.5 }]}
              accessibilityLabel={sending ? 'Forwarding…' : 'Send'}
              testID="forward-send"
            >
              {sending ? <AvarpusSpinner size={18} color="#FFFFFF" /> : <Feather name="send" size={20} color="#FFFFFF" />}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Device contact picker */}
      <Modal visible={contactPickerOpen} animationType="slide" onRequestClose={() => setContactPickerOpen(false)}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { paddingTop: topPadding, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setContactPickerOpen(false)} style={styles.headerIcon} accessibilityLabel="Close contacts">
              <Feather name="arrow-left" size={20} color={colors.foreground} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: colors.foreground }]}>Select contact</Text>
              <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                {contacts.status === 'loading'
                  ? `${contacts.deviceContacts.length} contacts · checking who is on Avarpus…`
                  : `${contacts.deviceContacts.length} contacts · ${contacts.matchedContacts.length} on Avarpus`}
              </Text>
            </View>
            <TouchableOpacity onPress={() => void contacts.discover()} style={styles.headerIcon} accessibilityLabel="Refresh contacts">
              <Feather name="refresh-cw" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          {contacts.status === 'denied' ? (
            <View style={styles.centered}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Contacts permission was denied. Allow access so Avarpus can show who is registered.
              </Text>
              <TouchableOpacity onPress={() => void Linking.openSettings()} style={[styles.settingsBtn, { borderColor: colors.border }]}>
                <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Open settings</Text>
              </TouchableOpacity>
            </View>
          ) : contacts.status === 'loading' && !contacts.loaded ? (
            <View style={styles.centered}><AvarpusSpinner size={28} /></View>
          ) : (
            <SectionList<ContactListItem, { title: string; data: ContactListItem[] }>
              sections={[
                { title: 'Contacts on Avarpus', data: contacts.matchedContacts.map((contact): ContactListItem => ({ kind: 'registered', contact })) },
                { title: 'Invite to Avarpus', data: contacts.inviteContacts.map((contact): ContactListItem => ({ kind: 'invite', contact })) },
              ]}
              keyExtractor={(item) => (item.kind === 'registered' ? `r-${item.contact.userId}` : `i-${item.contact.id}`)}
              renderSectionHeader={({ section }) =>
                section.data.length > 0 ? (
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground, backgroundColor: colors.background }]}>{section.title}</Text>
                ) : null
              }
              renderItem={({ item }) =>
                item.kind === 'registered' ? (
                  <TouchableOpacity onPress={() => pickContact(item.contact)} style={styles.row} accessibilityLabel={`Forward to ${item.contact.name}`}>
                    <Avatar name={contacts.displayFor(item.contact).name} url={contacts.displayFor(item.contact).photo} size={44} />
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>{contacts.displayFor(item.contact).name}</Text>
                      <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>{item.contact.mobile}</Text>
                    </View>
                    <Feather name="plus-circle" size={20} color={colors.primary} />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.row}>
                    <Avatar name={item.contact.name} url={item.contact.imageUri} size={44} />
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>{item.contact.name}</Text>
                      <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>{item.contact.phone}</Text>
                    </View>
                    <TouchableOpacity onPress={() => void inviteContact(item.contact.phone)} accessibilityLabel={`Invite ${item.contact.name}`}>
                      <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Invite</Text>
                    </TouchableOpacity>
                  </View>
                )
              }
              ListEmptyComponent={
                <View style={styles.centered}>
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    {contacts.error ?? 'No contacts found on this device.'}
                  </Text>
                </View>
              }
              stickySectionHeadersEnabled
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    gap: 2,
  },
  headerIcon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold', paddingHorizontal: 6 },
  searchInput: { flex: 1, fontSize: 16, fontFamily: 'Inter_400Regular', paddingHorizontal: 6, height: 44 },
  sectionLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  rowBody: { flex: 1 },
  rowName: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  rowMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  circle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 19 },
  settingsBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewStrip: { gap: 6, alignItems: 'center' },
  previewThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#222' },
  previewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 140,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewChipText: { fontSize: 12, fontFamily: 'Inter_400Regular', flexShrink: 1 },
  noteInput: {
    flex: 1,
    minWidth: 120,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectedNames: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium' },
  sendButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
