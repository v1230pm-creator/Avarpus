/**
 * Chat peer profile: app/(tabs)/customers/chat/profile/[id]
 *
 * Route params:
 *   id    – chat room ID
 *   name  – display name fallback while the room loads
 *
 * Opened from the avatar in the Chats list. Layout (top to bottom): glowing
 * hero photo with presence dot, name, number, last-seen pill, a row of four
 * action tiles (Message / Phone / Video / Save), an info card (mobile number
 * with copy, notifications on/off) and a block card. Every row is wired to a
 * real capability — there are no placeholder rows. Authorization is handled by
 * the parent chat _layout.tsx.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import * as Contacts from 'expo-contacts/legacy';
import { font } from '@/constants/typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  getChatRoomsGetQueryKey,
  getChatRoomsListQueryKey,
  useChatCapabilities,
  useChatRoomsBlock,
  useChatRoomsGet,
  useChatRoomsPreferencesUpdate,
  useChatRoomsUnblock,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useDeviceContactNames } from '@/hooks/useDeviceContactNames';
import { Avatar } from '@/components/ui/Avatar';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';

const PHOTO_SIZE = 168;
const RING_SIZE = PHOTO_SIZE + 12;
const ACCENT_BLUE = '#2F80FF';
const ACCENT_GREEN = '#22C55E';
const ACCENT_PURPLE = '#A855F7';
const ACCENT_RED = '#F05252';

function formatLastSeen(dateStr?: string | Date): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const daysAgo = Math.round((today - day) / (24 * 60 * 60 * 1000));
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (daysAgo === 0) return `Last seen today at ${time}`;
  if (daysAgo === 1) return `Last seen yesterday at ${time}`;
  return `Last seen ${date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })}`;
}

function formatMobile(mobile?: string): string {
  if (!mobile) return '';
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return `${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return mobile;
}

export default function ChatPeerProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useColors();
  const queryClient = useQueryClient();
  const { confirm } = useConfirmDialog();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const roomId = typeof params.id === 'string' ? params.id : '';
  const fallbackName = typeof params.name === 'string' ? params.name : '';

  const { data: roomData, isLoading, isError, refetch, isRefetching } = useChatRoomsGet(roomId, {
    query: {
      enabled: !!roomId,
      queryKey: getChatRoomsGetQueryKey(roomId),
    },
  });
  const room = roomData?.room;
  const deviceContactNames = useDeviceContactNames();
  const displayName = deviceContactNames.nameFor(room?.peerMobile, room?.name ?? fallbackName);
  const isOnline = room?.peerOnline === true;
  const presenceText = isOnline ? 'Online' : formatLastSeen(room?.peerLastSeenAt);
  const mobileText = formatMobile(room?.peerMobile);

  const { data: capData } = useChatCapabilities();
  const isBlocked = room?.isBlocked === true;
  const blockedByMe = room?.blockedByMe === true;
  const isMuted = room?.isMuted === true;
  const roomReady = !!room;
  const callEnabled =
    capData?.livekitAvailable === true && roomReady && Platform.OS !== 'web' && !isBlocked;
  const saveEnabled = roomReady && Platform.OS !== 'web' && !!room?.peerMobile;

  const preferencesUpdate = useChatRoomsPreferencesUpdate();
  const blockMutation = useChatRoomsBlock();
  const unblockMutation = useChatRoomsUnblock();
  // Independent guards: a running mute update must never swallow a Block.
  const muteInFlightRef = useRef(false);
  const blockInFlightRef = useRef(false);

  const refreshRoom = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getChatRoomsGetQueryKey(roomId) }),
      queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() }),
    ]);
  }, [queryClient, roomId]);

  // ---- Copy number -------------------------------------------------------
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );
  const copyNumber = useCallback(async () => {
    if (!room?.peerMobile) return;
    try {
      await Clipboard.setStringAsync(room.peerMobile);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      Alert.alert('Copy failed', 'The number could not be copied. Please try again.');
    }
  }, [room?.peerMobile]);

  // ---- Save to device contacts -------------------------------------------
  const [saving, setSaving] = useState(false);
  const saveContact = useCallback(async () => {
    if (!saveEnabled || saving || !room?.peerMobile) return;
    setSaving(true);
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert(
          'Contacts permission needed',
          'Allow Avarpus to access your contacts to save this number.',
        );
        return;
      }
      await Contacts.presentFormAsync(
        null,
        {
          contactType: Contacts.ContactTypes.Person,
          name: displayName,
          firstName: displayName,
          phoneNumbers: [{ label: 'mobile', number: room.peerMobile, isPrimary: true }],
        } as Contacts.Contact,
        { isNew: true },
      );
    } catch (err: any) {
      Alert.alert('Could not open contacts', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [saveEnabled, saving, room?.peerMobile, displayName]);

  // ---- Notifications (mute) ----------------------------------------------
  const toggleNotifications = useCallback(() => {
    if (!roomReady || muteInFlightRef.current) return;
    muteInFlightRef.current = true;
    preferencesUpdate.mutate(
      { roomId, data: { isMuted: !isMuted } },
      {
        // The guard is released only once the room cache reflects the new
        // state, so a second tap can't resubmit the stale target.
        onSuccess: async () => {
          try {
            await refreshRoom();
          } finally {
            muteInFlightRef.current = false;
          }
        },
        onError: (err: any) => {
          muteInFlightRef.current = false;
          Alert.alert(
            'Could not update notifications',
            err?.data?.message ?? err?.message ?? 'Please try again.',
          );
        },
      },
    );
  }, [roomReady, roomId, isMuted, preferencesUpdate, refreshRoom]);

  // ---- Block / unblock ---------------------------------------------------
  const toggleBlock = useCallback(() => {
    if (!roomReady || blockInFlightRef.current) return;
    const mutation = blockedByMe ? unblockMutation : blockMutation;
    const action = blockedByMe ? 'Unblock' : 'Block';
    confirm({
      title: `${action} ${displayName}?`,
      message: blockedByMe
        ? 'They will be able to message and call you again.'
        : 'Neither of you will be able to send messages or start calls. Existing history stays readable.',
      caption: null,
      icon: blockedByMe ? 'unlock' : 'slash',
      actions: [
        {
          label: action,
          description: blockedByMe ? 'Allow messages and calls' : 'Stop messages and calls',
          icon: blockedByMe ? 'unlock' : 'slash',
          tone: blockedByMe ? 'neutral' : 'destructive',
          onPress: () =>
            new Promise<void>((resolve) => {
              if (blockInFlightRef.current) {
                resolve();
                return;
              }
              blockInFlightRef.current = true;
              const release = () => {
                blockInFlightRef.current = false;
                resolve();
              };
              mutation.mutate(
                { roomId },
                {
                  // Keep the dialog busy until the refreshed room state has
                  // landed, so the row can't be re-pressed against stale data.
                  onSuccess: async () => {
                    try {
                      await refreshRoom();
                    } finally {
                      release();
                    }
                  },
                  onError: (err: any) => {
                    release();
                    Alert.alert(
                      `${action} failed`,
                      err?.data?.message ?? err?.message ?? 'Please try again.',
                    );
                  },
                },
              );
            }),
        },
      ],
    });
  }, [roomReady, blockedByMe, unblockMutation, blockMutation, confirm, displayName, roomId, refreshRoom]);

  const topPadding = Platform.OS === 'web' ? insets.top + 67 : Math.max(insets.top, 20);
  const nameParam = `name=${encodeURIComponent(displayName)}`;
  const photoParam = room?.profilePhoto ? `&photo=${encodeURIComponent(room.profilePhoto)}` : '';

  const openChat = () => {
    if (!roomReady) return;
    router.replace(`/(tabs)/customers/chat/${roomId}?${nameParam}`);
  };
  const startVideoCall = () => {
    if (!callEnabled) return;
    router.push(`/(tabs)/customers/chat/call/${roomId}?mode=video&${nameParam}${photoParam}`);
  };
  const phoneCall = async () => {
    if (!room?.peerMobile) return;
    try {
      await Linking.openURL(`tel:${room.peerMobile}`);
    } catch {
      Alert.alert('No phone app', 'This device cannot place phone calls.');
    }
  };

  const cardStyle = [styles.card, { backgroundColor: colors.card, borderColor: colors.border }];
  const tileStyle = [styles.tile, { backgroundColor: colors.card, borderColor: colors.border }];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Profile</Text>
      </View>

      {isError && !room ? (
        <View style={styles.errorBody}>
          <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
          <Text style={[styles.name, { color: colors.foreground, ...font.itemTitle, marginTop: 12 }]}>
            Profile unavailable
          </Text>
          <Text style={[styles.mobile, { color: colors.mutedForeground, textAlign: 'center' }]}>
            This conversation could not be loaded. It may have been removed.
          </Text>
          <View style={styles.tilesRow}>
            <TouchableOpacity
              onPress={() => void refetch()}
              disabled={isRefetching}
              style={tileStyle}
              accessibilityRole="button"
              accessibilityLabel="Retry loading profile"
            >
              {isRefetching ? (
                <AvarpusSpinner size={22} />
              ) : (
                <Feather name="refresh-cw" size={22} color={colors.primary} />
              )}
              <Text style={[styles.tileLabel, { color: colors.foreground }]}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.back()}
              style={tileStyle}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Feather name="arrow-left" size={22} color={colors.primary} />
              <Text style={[styles.tileLabel, { color: colors.foreground }]}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero: glow, decorative arcs, ringed photo, presence dot. */}
          <View style={styles.hero}>
            <LinearGradient
              colors={['rgba(47, 128, 255, 0.28)', 'rgba(47, 128, 255, 0.06)', 'rgba(0,0,0,0)']}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View pointerEvents="none" style={[styles.arc, styles.arcOuter]} />
            <View pointerEvents="none" style={[styles.arc, styles.arcInner]} />
            <View style={styles.ring} accessibilityLabel={`${displayName} profile photo`}>
              <Avatar name={displayName || '?'} url={room?.profilePhoto} size={PHOTO_SIZE} />
              {roomReady && (
                <View
                  style={[
                    styles.presenceDot,
                    {
                      backgroundColor: isOnline ? ACCENT_GREEN : colors.mutedForeground,
                      borderColor: colors.background,
                    },
                  ]}
                  accessibilityLabel={isOnline ? 'Online' : 'Offline'}
                />
              )}
            </View>
          </View>

          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>
            {displayName}
          </Text>
          {!!mobileText && (
            <Text style={[styles.mobile, { color: colors.mutedForeground }]}>{mobileText}</Text>
          )}
          {isLoading && !room ? (
            <View style={styles.presencePillWrap}>
              <AvarpusSpinner size={14} />
            </View>
          ) : !!presenceText ? (
            <View style={styles.presencePillWrap}>
              <View style={[styles.presencePill, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.presence, { color: colors.mutedForeground }]}>{presenceText}</Text>
              </View>
            </View>
          ) : null}

          {/* Action tiles */}
          <View style={styles.tilesRow}>
            <TouchableOpacity
              onPress={openChat}
              disabled={!roomReady}
              style={[
                styles.tile,
                { backgroundColor: ACCENT_BLUE, borderColor: ACCENT_BLUE },
                !roomReady && styles.tileDisabled,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !roomReady }}
              accessibilityLabel={`Message ${displayName}`}
            >
              <Feather name="message-circle" size={24} color="#FFFFFF" />
              <Text style={[styles.tileLabel, { color: '#FFFFFF' }]}>Message</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void phoneCall()}
              disabled={!room?.peerMobile}
              style={[tileStyle, !room?.peerMobile && styles.tileDisabled]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !room?.peerMobile }}
              accessibilityLabel={`Phone call ${displayName}`}
            >
              <Feather name="phone" size={24} color={ACCENT_GREEN} />
              <Text style={[styles.tileLabel, { color: colors.foreground }]}>Phone</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={startVideoCall}
              disabled={!callEnabled}
              style={[tileStyle, !callEnabled && styles.tileDisabled]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !callEnabled }}
              accessibilityLabel={`Video call ${displayName}`}
            >
              <Feather name="video" size={24} color={ACCENT_PURPLE} />
              <Text style={[styles.tileLabel, { color: colors.foreground }]}>Video</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void saveContact()}
              disabled={!saveEnabled || saving}
              style={[tileStyle, !saveEnabled && styles.tileDisabled]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !saveEnabled || saving }}
              accessibilityLabel={`Save ${displayName} to contacts`}
            >
              {saving ? (
                <AvarpusSpinner size={24} />
              ) : (
                <Feather name="user-plus" size={24} color={colors.foreground} />
              )}
              <Text style={[styles.tileLabel, { color: colors.foreground }]}>Save</Text>
            </TouchableOpacity>
          </View>

          {/* Info card */}
          <View style={cardStyle}>
            <View style={styles.row}>
              <Feather name="phone" size={20} color={colors.mutedForeground} style={styles.rowIcon} />
              <View style={styles.rowBody}>
                <Text style={[styles.rowCaption, { color: colors.mutedForeground }]}>Mobile number</Text>
                <Text style={[styles.rowValue, { color: colors.foreground }]}>
                  {mobileText || (isLoading ? '…' : 'Not available')}
                </Text>
              </View>
              {!!room?.peerMobile && (
                <TouchableOpacity
                  onPress={() => void copyNumber()}
                  style={[styles.copyButton, { backgroundColor: colors.surfaceSecondary }]}
                  accessibilityRole="button"
                  accessibilityLabel={copied ? 'Number copied' : 'Copy mobile number'}
                >
                  <Feather name={copied ? 'check' : 'copy'} size={18} color={copied ? ACCENT_GREEN : colors.foreground} />
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <TouchableOpacity
              onPress={toggleNotifications}
              disabled={!roomReady || preferencesUpdate.isPending}
              style={styles.row}
              accessibilityRole="switch"
              accessibilityState={{ checked: !isMuted, disabled: !roomReady || preferencesUpdate.isPending }}
              accessibilityLabel={`Notifications ${isMuted ? 'off' : 'on'}, tap to turn ${isMuted ? 'on' : 'off'}`}
            >
              <Feather
                name={isMuted ? 'bell-off' : 'bell'}
                size={20}
                color={colors.mutedForeground}
                style={styles.rowIcon}
              />
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Notifications</Text>
              {preferencesUpdate.isPending ? (
                <AvarpusSpinner size={16} />
              ) : (
                <Text style={[styles.rowTrailing, { color: colors.mutedForeground }]}>
                  {isMuted ? 'Off' : 'On'}
                </Text>
              )}
              <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Block card */}
          <View style={cardStyle}>
            <TouchableOpacity
              onPress={toggleBlock}
              disabled={!roomReady || (isBlocked && !blockedByMe) || blockMutation.isPending || unblockMutation.isPending}
              style={styles.row}
              accessibilityRole="button"
              accessibilityState={{ disabled: !roomReady || (isBlocked && !blockedByMe) || blockMutation.isPending || unblockMutation.isPending }}
              accessibilityLabel={blockedByMe ? `Unblock ${displayName}` : `Block ${displayName}`}
            >
              <View style={[styles.blockIconWrap, { backgroundColor: 'rgba(240, 82, 82, 0.16)' }]}>
                <Feather name="slash" size={18} color={ACCENT_RED} />
              </View>
              <Text style={[styles.rowTitle, { color: ACCENT_RED }]} numberOfLines={1}>
                {blockedByMe
                  ? `Unblock ${displayName}`
                  : isBlocked
                    ? 'You have been blocked'
                    : `Block ${displayName}`}
              </Text>
              {!(isBlocked && !blockedByMe) && (
                <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  iconButton: { padding: 8 },
  headerTitle: { ...font.itemTitle, marginLeft: 8 },
  scroll: { paddingHorizontal: 16 },
  errorBody: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 32 },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    height: RING_SIZE + 48,
    marginHorizontal: -16,
    overflow: 'hidden',
  },
  arc: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(47, 128, 255, 0.22)',
  },
  arcOuter: {
    width: 520,
    height: 520,
    borderRadius: 260,
    top: -330,
  },
  arcInner: {
    width: 400,
    height: 400,
    borderRadius: 200,
    top: -250,
  },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 3,
    borderColor: ACCENT_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ACCENT_BLUE,
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  presenceDot: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 4,
  },
  name: {
    ...font.title,
    textAlign: 'center',
    marginTop: 8,
  },
  mobile: {
    ...font.label,
    textAlign: 'center',
    marginTop: 6,
  },
  presencePillWrap: { alignItems: 'center', marginTop: 10, minHeight: 26 },
  presencePill: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 13 },
  presence: { ...font.small },
  tilesRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  tile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  tileDisabled: { opacity: 0.4 },
  tileLabel: { ...font.smallStrong },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 16,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 6,
  },
  rowIcon: { width: 28, marginRight: 8 },
  rowBody: { flex: 1 },
  rowCaption: { ...font.small },
  rowValue: { ...font.label, marginTop: 3 },
  rowTitle: { flex: 1, ...font.label },
  rowTrailing: { ...font.caption, marginRight: 2 },
  copyButton: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 62 },
  blockIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
});
