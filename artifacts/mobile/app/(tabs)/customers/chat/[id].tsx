import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Keyboard,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as Contacts from 'expo-contacts';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { Avatar } from '@/components/ui/Avatar';
import { storage, KEYS } from '@/utils/storage';
import {
  useChatCapabilities,
  useChatRoomsCreate,
  useChatRoomsGet,
  getChatRoomsGetQueryKey,
  getChatRoomsListQueryKey,
  useChatRoomsBlock,
  useChatRoomsUnblock,
  useChatReportsCreate,
  useChatMessagesList,
  getChatMessagesListQueryKey,
  useChatMessagesSend,
  useChatMarkRead,
  useChatUploadUrl,
  getChatMessageMediaUrl,
} from '@workspace/api-client-react';
import type {
  ChatMessage,
  ChatReportReason,
  ChatRoomCreateInputKind,
} from '@workspace/api-client-react';

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_RECORDING_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Server-allowlisted content types. Map raw picker MIME → normalised value.
 * NOTE: no fallback to octet-stream — server rejects it.
 */
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
  'image/heic': 'image/heic',
  'video/mp4': 'video/mp4',
  'video/quicktime': 'video/quicktime',
  'application/pdf': 'application/pdf',
  'audio/mp4': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/aac': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/webm': 'audio/webm',
};

/**
 * Resolve content type from file extension when MIME is absent or unknown.
 * Returns null if the extension maps to nothing in the allowlist.
 */
const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  m4a: 'audio/mp4',
  aac: 'audio/mp4',
};

function resolveContentType(mimeType: string | null | undefined, filename: string): string | null {
  if (mimeType) {
    const normalised = ALLOWED_CONTENT_TYPES[mimeType.toLowerCase()];
    if (normalised) return normalised;
  }
  // Fall back to extension
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_CONTENT_TYPE[ext] ?? null;
}

/** Message kind from server-normalised content type. */
function messageKindFromContentType(ct: string): 'image' | 'file' | 'audio' {
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Sanitise a filename for local cache paths — allow only safe chars. */
function sanitiseFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'attachment';
}

function makeClientRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatRoomCreateError(error: unknown): string {
  const apiError = error as {
    data?: { message?: unknown };
    message?: unknown;
    url?: unknown;
  };
  const message =
    typeof apiError?.data?.message === 'string'
      ? apiError.data.message
      : typeof apiError?.message === 'string'
        ? apiError.message
        : 'Could not open chat room.';

  if (!__DEV__ || typeof apiError?.url !== 'string') return message;

  try {
    return `${message}\nServer: ${new URL(apiError.url).host}`;
  } catch {
    return message;
  }
}

function formatMsgTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format milliseconds as mm:ss. */
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatMessageDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatLastSeen(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const daysAgo = Math.round((today - day) / (24 * 60 * 60 * 1000));
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (daysAgo === 0) return `last seen today at ${time}`;
  if (daysAgo === 1) return `last seen yesterday at ${time}`;
  return `last seen ${date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })}`;
}

function messageDayKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

const WALLPAPER_MOTIFS: Array<{
  name: React.ComponentProps<typeof Feather>['name'];
  top: number;
  left: number;
  rotate: string;
  size: number;
}> = [
  { name: 'smartphone', top: 26, left: 22, rotate: '-18deg', size: 21 },
  { name: 'tool', top: 44, left: 144, rotate: '15deg', size: 19 },
  { name: 'briefcase', top: 28, left: 286, rotate: '-12deg', size: 20 },
  { name: 'cpu', top: 126, left: 76, rotate: '12deg', size: 22 },
  { name: 'message-circle', top: 114, left: 230, rotate: '-20deg', size: 20 },
  { name: 'battery', top: 202, left: 28, rotate: '10deg', size: 20 },
  { name: 'settings', top: 220, left: 158, rotate: '-12deg', size: 20 },
  { name: 'shield', top: 194, left: 304, rotate: '18deg', size: 18 },
  { name: 'wifi', top: 306, left: 86, rotate: '-15deg', size: 22 },
  { name: 'headphones', top: 290, left: 252, rotate: '16deg', size: 20 },
  { name: 'smartphone', top: 400, left: 30, rotate: '14deg', size: 21 },
  { name: 'tool', top: 382, left: 174, rotate: '-18deg', size: 19 },
  { name: 'cpu', top: 420, left: 306, rotate: '12deg', size: 20 },
  { name: 'message-circle', top: 522, left: 74, rotate: '18deg', size: 20 },
  { name: 'briefcase', top: 500, left: 230, rotate: '-10deg', size: 20 },
  { name: 'battery', top: 624, left: 26, rotate: '-12deg', size: 20 },
  { name: 'settings', top: 606, left: 156, rotate: '16deg', size: 20 },
  { name: 'shield', top: 650, left: 300, rotate: '-18deg', size: 19 },
];

function ChatWallpaper({ colors }: { colors: any }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.wallpaperBase, { backgroundColor: colors.backgroundSecondary }]} />
      {WALLPAPER_MOTIFS.map((motif, index) => (
        <Feather
          key={`${motif.name}-${index}`}
          name={motif.name}
          size={motif.size}
          color={colors.mutedForeground}
          style={[
            styles.wallpaperMotif,
            {
              top: motif.top,
              left: motif.left,
              opacity: 0.09,
              transform: [{ rotate: motif.rotate }],
            },
          ]}
        />
      ))}
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function ImageAttachment({
  roomId,
  messageId,
  token,
}: {
  roomId: string;
  messageId: string;
  token: string | null;
}) {
  const mediaPath = getChatMessageMediaUrl(roomId, messageId);
  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : '';
  const uri = `${baseUrl}${mediaPath}`;

  return (
    <Image
      source={{
        uri,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }}
      style={styles.imageAttachment}
      contentFit="cover"
      accessibilityLabel="Image attachment"
      testID={`image-attachment-${messageId}`}
    />
  );
}

function FileAttachment({
  roomId,
  messageId,
  body,
  token,
  colors,
  onDownload,
}: {
  roomId: string;
  messageId: string;
  body: string;
  token: string | null;
  colors: any;
  onDownload: (roomId: string, messageId: string, filename: string, token: string | null) => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.fileRow, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
      onPress={() => onDownload(roomId, messageId, body, token)}
      accessibilityLabel={`Download ${body}`}
      testID={`file-attachment-${messageId}`}
    >
      <Feather name="file" size={18} color={colors.mutedForeground} />
      <Text
        style={[styles.fileRowName, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
        numberOfLines={1}
      >
        {body}
      </Text>
      <Feather name="download" size={16} color={colors.primary} />
    </TouchableOpacity>
  );
}

/** Compact audio player bubble — WhatsApp-like. */
function AudioAttachment({
  roomId,
  messageId,
  durationMs,
  token,
  colors,
  isMine,
}: {
  roomId: string;
  messageId: string;
  durationMs: number | undefined;
  token: string | null;
  colors: any;
  isMine: boolean;
}) {
  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : '';
  const mediaPath = getChatMessageMediaUrl(roomId, messageId);
  const uri = `${baseUrl}${mediaPath}`;

  const player = useAudioPlayer(
    { uri, headers: token ? { Authorization: `Bearer ${token}` } : undefined },
    { updateInterval: 250 },
  );
  const status = useAudioPlayerStatus(player);

  const isPlaying = status.playing;
  const currentSec = status.currentTime ?? 0;
  const totalSec = status.duration > 0 ? status.duration : (durationMs ? durationMs / 1000 : 0);
  const progress = totalSec > 0 ? currentSec / totalSec : 0;

  const displayDuration = durationMs
    ? formatDuration(durationMs)
    : totalSec > 0
    ? formatDuration(totalSec * 1000)
    : '0:00';

  const displayPosition = isPlaying || currentSec > 0
    ? formatDuration(currentSec * 1000)
    : displayDuration;

  const handlePress = useCallback(() => {
    if (isPlaying) {
      player.pause();
    } else {
      if (status.didJustFinish) {
        player.seekTo(0);
      }
      player.play();
    }
  }, [isPlaying, status.didJustFinish, player]);

  const textColor = isMine ? '#FFFFFF' : colors.foreground;
  const mutedColor = isMine ? 'rgba(255,255,255,0.65)' : colors.mutedForeground;
  const trackBg = isMine ? 'rgba(255,255,255,0.3)' : colors.border;
  const trackFg = isMine ? '#FFFFFF' : colors.primary;

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={styles.audioRow}
      accessibilityLabel={isPlaying ? 'Pause voice note' : 'Play voice note'}
      testID={`audio-attachment-${messageId}`}
    >
      <View style={[styles.audioPlayBtn, { backgroundColor: isMine ? 'rgba(255,255,255,0.25)' : colors.primary + '20' }]}>
        <Feather
          name={isPlaying ? 'pause' : 'play'}
          size={18}
          color={isMine ? '#FFFFFF' : colors.primary}
        />
      </View>
      <View style={styles.audioTrackArea}>
        <View style={[styles.audioTrackBg, { backgroundColor: trackBg }]}>
          <View style={[styles.audioTrackFg, { backgroundColor: trackFg, width: `${Math.min(progress * 100, 100)}%` as any }]} />
        </View>
        <Text style={[styles.audioDuration, { color: mutedColor }]}>{displayPosition}</Text>
      </View>
    </TouchableOpacity>
  );
}

function MessageBubble({
  msg,
  isMine,
  colors,
  token,
  onDownload,
}: {
  msg: ChatMessage;
  isMine: boolean;
  colors: any;
  token: string | null;
  onDownload: (roomId: string, messageId: string, filename: string, token: string | null) => void;
}) {
  if (msg.deletedAt) {
    return (
      <View style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
        <Text style={[styles.deletedMsg, { color: colors.mutedForeground }]}>Message deleted</Text>
      </View>
    );
  }

  const isImage = msg.kind === 'image';
  const isFile = msg.kind === 'file';
  const isAudio = msg.kind === 'audio';

  return (
    <View style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View
        style={[
          styles.bubble,
          isMine
            ? [styles.bubbleMine, { backgroundColor: colors.primary }]
            : [styles.bubbleTheirs, { backgroundColor: colors.card, borderColor: colors.border }],
          (isImage || isFile || isAudio) && styles.bubbleMedia,
        ]}
      >
        {isImage ? (
          <ImageAttachment roomId={msg.roomId} messageId={msg.id} token={token} />
        ) : isFile ? (
          <FileAttachment
            roomId={msg.roomId}
            messageId={msg.id}
            body={msg.body}
            token={token}
            colors={colors}
            onDownload={onDownload}
          />
        ) : isAudio ? (
          <AudioAttachment
            roomId={msg.roomId}
            messageId={msg.id}
            durationMs={msg.durationMs}
            token={token}
            colors={colors}
            isMine={isMine}
          />
        ) : (
          <Text
            style={[
              styles.bubbleText,
              { color: isMine ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_400Regular' },
            ]}
          >
            {msg.body}
          </Text>
        )}

        <View style={styles.bubbleFooter}>
          <Text
            style={[
              styles.bubbleTime,
              { color: isMine ? 'rgba(255,255,255,0.72)' : colors.mutedForeground },
            ]}
          >
            {formatMsgTime(msg.createdAt)}
          </Text>
          {isMine && (
            <Text style={[styles.deliveryTicks, { color: colors.success }]}>
              ✓✓
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

function DateSeparator({ date, colors }: { date: string; colors: any }) {
  return (
    <View style={[styles.dateSeparator, { backgroundColor: colors.card }]}>
      <Text style={[styles.dateSeparatorText, { color: colors.mutedForeground }]}>
        {formatMessageDate(date)}
      </Text>
    </View>
  );
}

// ── Pending attachment / voice-note state ─────────────────────────────────

/** Shared send state for both file attachments and voice notes. */
interface PendingUpload {
  uri: string;
  name: string;
  size: number;
  contentType: string;
  /** Stable idempotency key retained across retries. */
  clientRequestId: string;
  /** Voice notes only — duration in ms. */
  durationMs?: number;
  /**
   * If the file was already uploaded (objectPath known) but the send failed,
   * skip re-uploading and retry only the message send.
   */
  uploadedObjectPath?: string;
}

type AttachmentSheetColors = {
  background: string;
  card: string;
  border: string;
  foreground: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  backgroundSecondary: string;
  destructive: string;
};

type RecentMediaAccess = 'idle' | 'granted' | 'limited' | 'denied' | 'error' | 'unavailable';

interface AttachmentSheetProps {
  expanded: boolean;
  visible: boolean;
  recentAssets: MediaLibrary.Asset[];
  recentLoading: boolean;
  recentLoadingMore: boolean;
  recentHasMore: boolean;
  recentMediaAccess: RecentMediaAccess;
  contactsMode: boolean;
  contacts: Contacts.ExistingContact[];
  contactsLoading: boolean;
  colors: AttachmentSheetColors;
  bottomInset: number;
  onClose: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onGallery: () => void;
  onDocument: () => void;
  onLocation: () => void;
  onContact: () => void;
  onBackFromContacts: () => void;
  onRetryRecents: () => void;
  onOpenSettings: () => void;
  onLoadMoreRecents: () => void;
  onSelectRecent: (asset: MediaLibrary.Asset) => void;
  onSelectContact: (contact: Contacts.ExistingContact) => void;
}

function AttachmentSheet({
  expanded,
  visible,
  recentAssets,
  recentLoading,
  recentLoadingMore,
  recentHasMore,
  recentMediaAccess,
  contactsMode,
  contacts,
  contactsLoading,
  colors,
  bottomInset,
  onClose,
  onExpand,
  onCollapse,
  onGallery,
  onDocument,
  onLocation,
  onContact,
  onBackFromContacts,
  onRetryRecents,
  onOpenSettings,
  onLoadMoreRecents,
  onSelectRecent,
  onSelectContact,
}: AttachmentSheetProps) {
  const sheetProgress = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.max(430, windowHeight - 104);
  const collapsedOffset = Math.max(0, sheetHeight - 286);

  useEffect(() => {
    Animated.spring(sheetProgress, {
      toValue: expanded ? 1 : 0,
      useNativeDriver: true,
      damping: 22,
      stiffness: 210,
      mass: 0.85,
    }).start();
  }, [expanded, sheetProgress]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy < -45) onExpand();
          else if (gesture.dy > 45) onCollapse();
        },
      }),
    [onCollapse, onExpand],
  );

  if (!visible) return null;

  const sheetTranslateY = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [collapsedOffset, 0],
  });

  return (
    <View style={styles.attachmentSheetOverlay} testID="attachment-sheet">
      <Pressable
        style={styles.attachmentSheetBackdrop}
        onPress={onClose}
        accessibilityLabel="Close attachment panel"
      />
      <Animated.View
        style={[
          styles.attachmentSheet,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            height: sheetHeight,
            bottom: Math.max(bottomInset, 8),
            paddingBottom: 14,
            transform: [{ translateY: sheetTranslateY }],
          },
        ]}
      >
        <View
          testID="attachment-sheet-drag-handle"
          {...panResponder.panHandlers}
        >
          <View style={styles.attachmentSheetHandle} />
          <View style={styles.attachmentSheetHeader}>
            <TouchableOpacity
              onPress={contactsMode ? onBackFromContacts : expanded ? onCollapse : onClose}
              style={styles.attachmentSheetClose}
              accessibilityLabel={
                contactsMode
                  ? 'Back to attachment options'
                  : expanded
                  ? 'Collapse recent gallery'
                  : 'Close attachment panel'
              }
            >
              <Feather
                name={contactsMode ? 'chevron-left' : 'x'}
                size={22}
                color={colors.foreground}
              />
            </TouchableOpacity>
            <Text
              style={[
                styles.attachmentSheetTitle,
                { color: colors.foreground, fontFamily: 'Inter_700Bold' },
              ]}
            >
              {contactsMode ? 'Choose contact' : expanded ? 'Recents' : 'Attach'}
            </Text>
            <View style={styles.attachmentSheetHeaderSpacer} />
          </View>
        </View>

        {contactsMode ? (
          <ScrollView
            style={styles.contactPickerList}
            contentContainerStyle={styles.contactPickerContent}
            keyboardShouldPersistTaps="handled"
          >
            {contactsLoading ? (
              <View style={styles.attachmentEmptyState}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.attachmentEmptyText, { color: colors.mutedForeground }]}>
                  Reading contacts…
                </Text>
              </View>
            ) : contacts.length === 0 ? (
              <View style={styles.attachmentEmptyState}>
                <Feather name="users" size={26} color={colors.mutedForeground} />
                <Text style={[styles.attachmentEmptyText, { color: colors.mutedForeground }]}>
                  No contacts with a phone number were found.
                </Text>
              </View>
            ) : (
              contacts.map((contact) => {
                const phone = contact.phoneNumbers?.find((item) => item.number)?.number;
                return (
                  <TouchableOpacity
                    key={contact.id}
                    style={[styles.contactRow, { borderBottomColor: colors.border }]}
                    onPress={() => onSelectContact(contact)}
                    accessibilityLabel={`Share contact ${contact.name}`}
                  >
                    <View style={[styles.contactAvatar, { backgroundColor: colors.primary + '18' }]}>
                      <Feather name="user" size={18} color={colors.primary} />
                    </View>
                    <View style={styles.contactCopy}>
                      <Text
                        style={[
                          styles.contactName,
                          { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
                        ]}
                        numberOfLines={1}
                      >
                        {contact.name}
                      </Text>
                      {phone ? (
                        <Text
                          style={[
                            styles.contactPhone,
                            { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
                          ]}
                        >
                          {phone}
                        </Text>
                      ) : null}
                    </View>
                    <Feather name="send" size={16} color={colors.mutedForeground} />
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        ) : (
          <>
            <View style={styles.attachmentActionRow}>
              <AttachmentAction
                icon="image"
                label="Gallery"
                colors={colors}
                onPress={onGallery}
                testID="attachment-gallery"
              />
              <AttachmentAction
                icon="map-pin"
                label="Location"
                colors={colors}
                onPress={onLocation}
                testID="attachment-location"
              />
              <AttachmentAction
                icon="user"
                label="Contact"
                colors={colors}
                onPress={onContact}
                testID="attachment-contact"
              />
              <AttachmentAction
                icon="file-text"
                label="Document"
                colors={colors}
                onPress={onDocument}
                testID="attachment-document"
              />
            </View>
            <View style={styles.attachmentRecentHeader}>
              <Text
                style={[
                  styles.attachmentRecentTitle,
                  { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
                ]}
              >
                Recents
              </Text>
              {!expanded ? (
                <TouchableOpacity
                  onPress={onExpand}
                  accessibilityLabel="View all recent photos"
                  style={styles.attachmentSeeAll}
                >
                  <Text style={[styles.attachmentSeeAllText, { color: colors.primary }]}>
                    See all
                  </Text>
                  <Feather name="chevron-up" size={15} color={colors.primary} />
                </TouchableOpacity>
              ) : null}
            </View>
            {recentMediaAccess === 'limited' ? (
              <View style={[styles.attachmentPermissionNote, { backgroundColor: colors.backgroundSecondary }]}>
                <Feather name="shield" size={13} color={colors.mutedForeground} />
                <Text style={[styles.attachmentPermissionText, { color: colors.mutedForeground }]}>
                  Showing the photos you allowed Avarpus to access.
                </Text>
                <TouchableOpacity onPress={onOpenSettings} accessibilityLabel="Manage photo access">
                  <Text style={[styles.attachmentPermissionAction, { color: colors.primary }]}>
                    Manage
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {recentLoading ? (
              <View style={styles.attachmentLoadingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.attachmentEmptyText, { color: colors.mutedForeground }]}>
                  Loading photos…
                </Text>
              </View>
            ) : recentAssets.length === 0 ? (
              <View style={styles.attachmentEmptyState}>
                <Feather name="image" size={26} color={colors.mutedForeground} />
                <Text style={[styles.attachmentEmptyText, { color: colors.mutedForeground }]}>
                  {recentMediaAccess === 'denied'
                    ? 'Photo access is off. Allow access to show recent photos here.'
                    : recentMediaAccess === 'error'
                    ? 'Recent photos could not be loaded.'
                    : recentMediaAccess === 'unavailable'
                    ? 'Recent photos are available in the native mobile app.'
                    : 'No recent photos were found.'}
                </Text>
                <TouchableOpacity
                  onPress={
                    recentMediaAccess === 'denied'
                      ? onOpenSettings
                      : recentMediaAccess === 'error'
                      ? onRetryRecents
                      : onGallery
                  }
                  style={[styles.attachmentEmptyButton, { borderColor: colors.border }]}
                >
                  <Text style={[styles.attachmentEmptyButtonText, { color: colors.primary }]}>
                    {recentMediaAccess === 'denied'
                      ? 'Open settings'
                      : recentMediaAccess === 'error'
                      ? 'Try again'
                      : 'Open gallery'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView
                testID="attachment-recents-scroll"
                horizontal={!expanded}
                style={expanded ? styles.attachmentRecentScroll : undefined}
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={120}
                onScroll={
                  expanded
                    ? ({ nativeEvent }) => {
                        const distanceFromBottom =
                          nativeEvent.contentSize.height -
                          nativeEvent.layoutMeasurement.height -
                          nativeEvent.contentOffset.y;
                        if (distanceFromBottom < 180) onLoadMoreRecents();
                      }
                    : undefined
                }
                contentContainerStyle={
                  expanded ? styles.attachmentGrid : styles.attachmentStrip
                }
              >
                {recentAssets.map((asset) => (
                  <TouchableOpacity
                    key={asset.id}
                    onPress={() => onSelectRecent(asset)}
                    style={expanded ? styles.attachmentGridItem : styles.attachmentStripItem}
                    accessibilityLabel={`Select ${asset.filename}`}
                  >
                    <Image
                      source={{ uri: asset.uri }}
                      style={styles.attachmentRecentImage}
                      contentFit="cover"
                    />
                    {asset.mediaType === 'video' ? (
                      <View style={styles.attachmentVideoBadge}>
                        <Feather name="play" size={11} color="#FFFFFF" />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                ))}
                {expanded && recentLoadingMore ? (
                  <View style={styles.attachmentPageLoader}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : null}
                {expanded && !recentHasMore && recentAssets.length > 0 ? (
                  <Text style={[styles.attachmentEndText, { color: colors.mutedForeground }]}>
                    You’re all caught up
                  </Text>
                ) : null}
              </ScrollView>
            )}
          </>
        )}
      </Animated.View>
    </View>
  );
}

function AttachmentAction({
  icon,
  label,
  colors,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  colors: AttachmentSheetColors;
  onPress: () => void;
  testID: string;
}) {
  return (
    <TouchableOpacity
      style={styles.attachmentAction}
      onPress={onPress}
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={[styles.attachmentActionIcon, { backgroundColor: colors.primary + '18' }]}>
        <Feather name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={[styles.attachmentActionLabel, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Recording state machine ───────────────────────────────────────────────

type RecordingPhase =
  | 'idle'          // mic button shows as normal (pressable)
  | 'requesting'    // permission dialog in flight
  | 'recording'     // actively recording — red UI
  | 'stopping';     // stop() called, waiting for URI

// ── Main Screen ───────────────────────────────────────────────────────────

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const rawColors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  
  const colors = useMemo(() => ({
    ...rawColors,
    background: isDark ? '#040914' : rawColors.background,
    card: isDark ? '#0A1221' : rawColors.card,
    border: isDark ? '#1E293B' : rawColors.border,
    primary: isDark ? '#2563EB' : rawColors.primary,
    foreground: isDark ? '#FFFFFF' : rawColors.foreground,
    mutedForeground: isDark ? '#94A3B8' : rawColors.mutedForeground,
    backgroundSecondary: isDark ? '#0F172A' : rawColors.backgroundSecondary,
    success: isDark ? '#10B981' : rawColors.success,
  }), [rawColors, isDark]);

  const { user } = useAuth();
  const queryClient = useQueryClient();

  const params = useLocalSearchParams<{
    id: string;
    roomId?: string;
    targetId?: string;
    type?: 'customer' | 'dealer';
    name?: string;
  }>();

  const routeId = params.id;
  const name = params.name ?? 'Chat';
  const targetId = params.targetId;
  const targetType = (params.type ?? 'customer') as 'customer' | 'dealer';

  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const handleBack = useCallback(() => {
    // Conversations opened from a profile should always return there, rather
    // than relying on browser/native stack history that may start at a tab.
    if (targetId) {
      router.replace(
        targetType === 'dealer'
          ? `/(tabs)/repairs/dealer/${targetId}`
          : `/(tabs)/customers/${targetId}`,
      );
      return;
    }
    router.back();
  }, [router, targetId, targetType]);

  // ── Auth token for private media ────────────────────────────────────────
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    storage.get<string>(KEYS.AUTH_TOKEN).then(setToken);
  }, []);

  // ── Text composer ───────────────────────────────────────────────────────
  const [text, setText] = useState('');
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setIsKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const blinkAnim = useRef(new Animated.Value(1)).current;

  const [sendError, setSendError] = useState<string | null>(null);
  const [optimisticMsgs, setOptimisticMsgs] = useState<ChatMessage[]>([]);
  const clientRequestIdRef = useRef(makeClientRequestId('room'));
  const pendingSendRef = useRef<{ body: string; clientRequestId: string } | null>(null);

  // ── Shared upload/send state (file attachments + voice notes) ──────────
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSendingUpload, setIsSendingUpload] = useState(false);

  // ── Attachment sheet state ──────────────────────────────────────────────
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const [attachmentSheetExpanded, setAttachmentSheetExpanded] = useState(false);
  const [recentAssets, setRecentAssets] = useState<MediaLibrary.Asset[]>([]);
  const [recentAssetsLoading, setRecentAssetsLoading] = useState(false);
  const [recentAssetsLoadingMore, setRecentAssetsLoadingMore] = useState(false);
  const [recentAssetsCursor, setRecentAssetsCursor] = useState<string | null>(null);
  const [recentAssetsHasMore, setRecentAssetsHasMore] = useState(false);
  const [recentMediaAccess, setRecentMediaAccess] = useState<RecentMediaAccess>('idle');
  const [contactsMode, setContactsMode] = useState(false);
  const [deviceContacts, setDeviceContacts] = useState<Contacts.ExistingContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  // ── Voice recording state ───────────────────────────────────────────────
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>('idle');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tracks whether the audio session is currently in recording mode
  // (allowsRecording:true) so we only reset when needed and can guarantee
  // cleanup on every cancel / failure / unmount path.
  const audioModeActiveRef = useRef(false);

  /**
   * Best-effort restore of the audio session to a non-recording state.
   * Swallows errors so it is always safe to call in catch blocks / cleanup.
   */
  const resetAudioMode = useCallback(async () => {
    if (!audioModeActiveRef.current) return;
    audioModeActiveRef.current = false;
    try {
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      // Session may already be torn down (e.g. on unmount) — ignore.
    }
  }, []);

  // expo-audio recorder hook — always initialise with HIGH_QUALITY preset
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  // Unmount cleanup — if the screen is torn down mid-recording, stop the
  // recorder and restore the audio session so allowsRecording is never left
  // stuck true. Never uploads.
  useEffect(() => {
    return () => {
      if (audioModeActiveRef.current) {
        try {
          recorder.stop();
        } catch {
          // Best-effort — recorder may already be stopped.
        }
        void resetAudioMode();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-stop at 10 minutes
  const capturedDurationRef = useRef<number>(0);
  useEffect(() => {
    if (recordingPhase !== 'recording') return;
    if (recorderState.durationMillis >= MAX_RECORDING_MS) {
      void handleStopAndSendRecording();
    }
    capturedDurationRef.current = recorderState.durationMillis;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingPhase, recorderState.durationMillis]);

  // ── Capabilities ────────────────────────────────────────────────────────
  const { data: capData, isLoading: capLoading } = useChatCapabilities();
  const providerAvailable = capData?.matrixAvailable === true;
  const voiceAvailable = capData?.livekitAvailable === true;

  // ── Room resolution ─────────────────────────────────────────────────────
  const looksLikeRoomId = routeId && !targetId;

  const createRoomMutation = useChatRoomsCreate();
  const [resolvedRoomId, setResolvedRoomId] = useState<string | null>(
    looksLikeRoomId ? routeId : null,
  );
  const [roomCreateError, setRoomCreateError] = useState<string | null>(null);

  const requestRoomCreation = () => {
    if (looksLikeRoomId || resolvedRoomId) return;
    if (!targetId || !providerAvailable) return;
    if (createRoomMutation.isPending) return;

    const kind: ChatRoomCreateInputKind = targetType === 'dealer' ? 'dealer' : 'customer';
    createRoomMutation.mutate(
      {
        data: {
          name,
          kind,
          customerId: kind === 'customer' ? targetId : undefined,
          dealerId: kind === 'dealer' ? targetId : undefined,
          clientRequestId: clientRequestIdRef.current,
        },
      },
      {
        onSuccess: (res) => {
          setResolvedRoomId(res.room.id);
          setRoomCreateError(null);
        },
        onError: (err: unknown) => {
          setRoomCreateError(formatRoomCreateError(err));
        },
      },
    );
  };

  useEffect(() => {
    requestRoomCreation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, providerAvailable]);

  // ── Room details ────────────────────────────────────────────────────────
  const { data: roomData } = useChatRoomsGet(resolvedRoomId ?? '', {
    query: {
      enabled: !!resolvedRoomId,
      queryKey: getChatRoomsGetQueryKey(resolvedRoomId ?? ''),
      refetchInterval: 10_000,
    },
  });
  const room = roomData?.room;
  const roomName = room?.name ?? name;
  const presenceText = room?.peerOnline ? 'online' : formatLastSeen(room?.peerLastSeenAt);
  const isBlocked = room?.isBlocked === true;
  const blockedByMe = room?.blockedByMe === true;
  const callEnabled =
    voiceAvailable && !!resolvedRoomId && Platform.OS !== 'web' && !isBlocked;
  const blockMutation = useChatRoomsBlock();
  const unblockMutation = useChatRoomsUnblock();
  const reportMutation = useChatReportsCreate();
  const pendingReportRef = useRef<{ reason: ChatReportReason; id: string } | null>(
    null,
  );

  const refreshRoomSafetyState = useCallback(async () => {
    if (!resolvedRoomId) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getChatRoomsGetQueryKey(resolvedRoomId),
      }),
      queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() }),
    ]);
  }, [queryClient, resolvedRoomId]);

  const submitReport = useCallback(
    (reason: ChatReportReason) => {
      if (!resolvedRoomId) return;
      const clientRequestId =
        pendingReportRef.current?.reason === reason
          ? pendingReportRef.current.id
          : makeClientRequestId('report');
      pendingReportRef.current = { reason, id: clientRequestId };
      reportMutation.mutate(
        {
          roomId: resolvedRoomId,
          data: { reason, clientRequestId },
        },
        {
          onSuccess: () => {
            if (pendingReportRef.current?.id === clientRequestId) {
              pendingReportRef.current = null;
            }
            Alert.alert('Report submitted', 'Thank you. The report has been saved for review.');
          },
          onError: (err: any) => {
            Alert.alert(
              'Could not submit report',
              err?.data?.message ?? err?.message ?? 'Please try again.',
            );
          },
        },
      );
    },
    [reportMutation, resolvedRoomId],
  );

  const openReportReasons = useCallback(() => {
    Alert.alert('Report conversation', 'Choose the main reason for your report.', [
      { text: 'Spam', onPress: () => submitReport('spam') },
      { text: 'Harassment', onPress: () => submitReport('harassment') },
      { text: 'Scam', onPress: () => submitReport('scam') },
      { text: 'Inappropriate content', onPress: () => submitReport('inappropriate') },
      { text: 'Other', onPress: () => submitReport('other') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [submitReport]);

  const toggleBlock = useCallback(() => {
    if (!resolvedRoomId) return;
    const mutation = blockedByMe ? unblockMutation : blockMutation;
    const action = blockedByMe ? 'Unblock' : 'Block';
    Alert.alert(
      `${action} ${roomName}?`,
      blockedByMe
        ? 'They will be able to message and call you again.'
        : 'Neither of you will be able to send messages or start calls. Existing history stays readable.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action,
          style: blockedByMe ? 'default' : 'destructive',
          onPress: () =>
            mutation.mutate(
              { roomId: resolvedRoomId },
              {
                onSuccess: refreshRoomSafetyState,
                onError: (err: any) =>
                  Alert.alert(
                    `${action} failed`,
                    err?.data?.message ?? err?.message ?? 'Please try again.',
                  ),
              },
            ),
        },
      ],
    );
  }, [
    blockMutation,
    blockedByMe,
    refreshRoomSafetyState,
    resolvedRoomId,
    roomName,
    unblockMutation,
  ]);

  const openChatMenu = useCallback(() => {
    const options: any[] = [
      {
        text: 'Settings',
        onPress: () => router.push('/(tabs)/more/settings'),
      },
    ];
    if (room?.scope === 'global_direct') {
      options.push({ text: 'Report', onPress: openReportReasons });
    }
    if (room?.scope === 'global_direct' && (!isBlocked || blockedByMe)) {
      options.push({
        text: blockedByMe ? 'Unblock' : 'Block',
        style: blockedByMe ? 'default' : 'destructive',
        onPress: toggleBlock,
      });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Chat options', undefined, options);
  }, [blockedByMe, isBlocked, openReportReasons, room?.scope, router, toggleBlock]);

  // ── Messages ────────────────────────────────────────────────────────────
  const {
    data: msgsData,
    isLoading: msgsLoading,
    isError: msgsError,
    refetch: msgsRefetch,
  } = useChatMessagesList(resolvedRoomId ?? '', undefined, {
    query: {
      enabled: !!resolvedRoomId && providerAvailable,
      queryKey: getChatMessagesListQueryKey(resolvedRoomId ?? ''),
      refetchInterval: providerAvailable ? 4_000 : false,
    },
  });

  const serverMessages = msgsData?.messages ?? [];

  const allMessages = useMemo(() => {
    const serverIds = new Set(serverMessages.map((m) => m.id));
    const pending = optimisticMsgs.filter((m) => !serverIds.has(m.id));
    return [...pending, ...serverMessages];
  }, [serverMessages, optimisticMsgs]);

  // ── Mark read ───────────────────────────────────────────────────────────
  const markReadMutation = useChatMarkRead();
  useEffect(() => {
    if (!resolvedRoomId || serverMessages.length === 0) return;
    const newestIncoming = serverMessages.find((m) => m.senderId !== user?.id);
    if (!newestIncoming) return;
    markReadMutation.mutate({ roomId: resolvedRoomId, data: { messageId: newestIncoming.id } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedRoomId, serverMessages[0]?.id]);

  // ── Send text message ───────────────────────────────────────────────────
  const sendMutation = useChatMessagesSend();

  const sendTextValue = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !resolvedRoomId || isBlocked) return;
    const clientRequestId =
      pendingSendRef.current?.body === trimmed
        ? pendingSendRef.current.clientRequestId
        : makeClientRequestId('message');
    pendingSendRef.current = { body: trimmed, clientRequestId };
    setSendError(null);
    setText('');

    const optimistic: ChatMessage = {
      id: `opt-${clientRequestId}`,
      roomId: resolvedRoomId,
      shopId: '',
      senderId: user?.id ?? 'me',
      senderName: user?.name ?? 'Me',
      kind: 'text',
      body: trimmed,
      createdAt: new Date().toISOString(),
    };
    setOptimisticMsgs((prev) => [optimistic, ...prev]);

    sendMutation.mutate(
      { roomId: resolvedRoomId, data: { kind: 'text', body: trimmed, clientRequestId } },
      {
        onSuccess: () => {
          setOptimisticMsgs((prev) => prev.filter((m) => m.id !== optimistic.id));
          if (pendingSendRef.current?.clientRequestId === clientRequestId) {
            pendingSendRef.current = null;
          }
          msgsRefetch();
          void queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getChatRoomsGetQueryKey(resolvedRoomId) });
        },
        onError: (err: any) => {
          setOptimisticMsgs((prev) => prev.filter((m) => m.id !== optimistic.id));
          setSendError(err?.data?.message ?? err?.message ?? 'Message failed to send.');
          setText(trimmed);
        },
      },
    );
  }, [resolvedRoomId, isBlocked, user, sendMutation, msgsRefetch, queryClient]);

  const handleSend = useCallback(() => {
    sendTextValue(text);
  }, [sendTextValue, text]);

  // ── Upload URL mutation ─────────────────────────────────────────────────
  const uploadUrlMutation = useChatUploadUrl();

  // ── Shared upload → send ────────────────────────────────────────────────
  /**
   * Upload pendingUpload to S3 (unless already uploaded) then send the chat
   * message. If upload already succeeded (uploadedObjectPath set) on a
   * prior attempt, skip straight to the send step.
   */
  const handleSendUpload = useCallback(async (upload?: PendingUpload) => {
    const target = upload ?? pendingUpload;
    if (!target || !resolvedRoomId) return;

    setUploadError(null);
    setUploadProgress(target.uploadedObjectPath ? 1 : 0);

    try {
      let objectPath = target.uploadedObjectPath ?? null;

      if (!objectPath) {
        // 1) Request a presigned upload URL
        const uploadResult = await new Promise<{ uploadURL: string; objectPath: string }>(
          (resolve, reject) => {
            uploadUrlMutation.mutate(
              {
                roomId: resolvedRoomId,
                data: { name: target.name, size: target.size, contentType: target.contentType },
              },
              { onSuccess: resolve, onError: reject },
            );
          },
        );

        objectPath = uploadResult.objectPath;

        // 2) PUT the bytes to presigned URL
        if (Platform.OS === 'web') {
          const fetchResp = await fetch(target.uri);
          const blob = await fetchResp.blob();
          const putResp = await fetch(uploadResult.uploadURL, {
            method: 'PUT',
            headers: { 'Content-Type': target.contentType },
            body: blob,
          });
          if (!putResp.ok) throw new Error(`Upload failed (HTTP ${putResp.status})`);
          setUploadProgress(1);
        } else {
          await new Promise<void>((resolve, reject) => {
            const task = FileSystem.createUploadTask(
              uploadResult.uploadURL,
              target.uri,
              {
                httpMethod: 'PUT',
                headers: { 'Content-Type': target.contentType },
                uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
              },
              (progress) => {
                if (progress.totalBytesExpectedToSend > 0) {
                  setUploadProgress(
                    progress.totalBytesSent / progress.totalBytesExpectedToSend,
                  );
                }
              },
            );
            task
              .uploadAsync()
              .then((result) => {
                if (!result || result.status < 200 || result.status >= 300) {
                  reject(new Error(`Upload failed (HTTP ${result?.status ?? 'unknown'})`));
                } else {
                  setUploadProgress(1);
                  resolve();
                }
              })
              .catch(reject);
          });
        }

        // Upload done — persist objectPath so a failed send can retry without re-uploading
        setPendingUpload((prev) =>
          prev && prev.clientRequestId === target.clientRequestId
            ? { ...prev, uploadedObjectPath: objectPath! }
            : prev,
        );
      }

      // 3) Send the chat message (no optimistic — wait for server)
      setIsSendingUpload(true);
      const kind = messageKindFromContentType(target.contentType);
      await new Promise<void>((resolve, reject) => {
        const sendData: Parameters<typeof sendMutation.mutate>[0]['data'] = {
          kind,
          body: target.name,
          objectPath,
          clientRequestId: target.clientRequestId,
          ...(kind === 'audio' && target.durationMs !== undefined
            ? { durationMs: Math.max(1, Math.round(target.durationMs)) }
            : {}),
        };
        sendMutation.mutate(
          { roomId: resolvedRoomId, data: sendData },
          { onSuccess: () => resolve(), onError: reject },
        );
      });

      // Done — clear and refresh
      setPendingUpload(null);
      setUploadProgress(null);
      setIsSendingUpload(false);
      msgsRefetch();
      void queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getChatRoomsGetQueryKey(resolvedRoomId) });
    } catch (err: any) {
      setUploadProgress(null);
      setIsSendingUpload(false);
      setUploadError(
        err?.data?.message ?? err?.message ?? 'Failed to send. Tap Retry.',
      );
    }
  }, [pendingUpload, resolvedRoomId, uploadUrlMutation, sendMutation, msgsRefetch, queryClient]);

  const attachEnabled =
    providerAvailable &&
    !isBlocked &&
    !!resolvedRoomId &&
    uploadProgress === null &&
    !isSendingUpload &&
    recordingPhase === 'idle';

  // ── Attachment sheet and native pickers ──────────────────────────────────
  const queueUpload = useCallback(
    async (
      uri: string,
      name: string,
      mimeType: string | null | undefined,
      fileSize?: number | null,
    ) => {
      const contentType = resolveContentType(mimeType, name);
      if (!contentType) {
        setUploadError(
          `Unsupported file type "${mimeType ?? name.split('.').pop()}". ` +
          'Allowed: images (JPEG/PNG/GIF/WebP/HEIC), video (MP4/MOV), PDF.',
        );
        return;
      }

      let size = fileSize ?? 0;
      if ((fileSize === undefined || fileSize === null) && Platform.OS !== 'web') {
        const info = await FileSystem.getInfoAsync(uri);
        size = info.exists && 'size' in info ? (info as any).size : 0;
      }
      if (size > MAX_FILE_BYTES) {
        setUploadError(`File is too large (${formatBytes(size)}). Maximum is 50 MB.`);
        return;
      }

      setPendingUpload({
        uri,
        name,
        size,
        contentType,
        clientRequestId: makeClientRequestId('attach'),
      });
      setUploadError(null);
    },
    [],
  );

  const loadRecentAssets = useCallback(async () => {
    if (Platform.OS === 'web') {
      setRecentAssets([]);
      setRecentAssetsCursor(null);
      setRecentAssetsHasMore(false);
      setRecentMediaAccess('unavailable');
      return;
    }
    setRecentAssetsLoading(true);
    setRecentMediaAccess('idle');
    try {
      let permission = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
      if (!permission.granted) {
        permission = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
      }
      if (!permission.granted) {
        setRecentAssets([]);
        setRecentAssetsCursor(null);
        setRecentAssetsHasMore(false);
        setRecentMediaAccess('denied');
        return;
      }
      const result = await MediaLibrary.getAssetsAsync({
        first: 30,
        mediaType: ['photo', 'video'],
        sortBy: [['creationTime', false]],
      });
      setRecentAssets(result.assets);
      setRecentAssetsCursor(result.endCursor || null);
      setRecentAssetsHasMore(result.hasNextPage);
      setRecentMediaAccess(permission.accessPrivileges === 'limited' ? 'limited' : 'granted');
    } catch {
      setRecentAssets([]);
      setRecentAssetsCursor(null);
      setRecentAssetsHasMore(false);
      setRecentMediaAccess('error');
    } finally {
      setRecentAssetsLoading(false);
    }
  }, []);

  const loadMoreRecentAssets = useCallback(async () => {
    if (
      Platform.OS === 'web' ||
      !recentAssetsHasMore ||
      !recentAssetsCursor ||
      recentAssetsLoadingMore
    ) {
      return;
    }
    setRecentAssetsLoadingMore(true);
    try {
      const result = await MediaLibrary.getAssetsAsync({
        first: 30,
        after: recentAssetsCursor,
        mediaType: ['photo', 'video'],
        sortBy: [['creationTime', false]],
      });
      setRecentAssets((current) => {
        const knownIds = new Set(current.map((asset) => asset.id));
        return [...current, ...result.assets.filter((asset) => !knownIds.has(asset.id))];
      });
      setRecentAssetsCursor(result.endCursor || null);
      setRecentAssetsHasMore(result.hasNextPage);
    } catch {
      setRecentMediaAccess('error');
    } finally {
      setRecentAssetsLoadingMore(false);
    }
  }, [recentAssetsCursor, recentAssetsHasMore, recentAssetsLoadingMore]);

  const closeAttachmentSheet = useCallback(() => {
    setAttachmentSheetOpen(false);
    setAttachmentSheetExpanded(false);
    setContactsMode(false);
  }, []);

  const handleOpenMediaSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {
      Alert.alert('Open Settings', 'Open your device settings and allow photo access for Avarpus.');
    });
  }, []);

  const openAttachmentSheet = useCallback(() => {
    if (!attachEnabled) return;
    Keyboard.dismiss();
    setContactsMode(false);
    setAttachmentSheetExpanded(false);
    setAttachmentSheetOpen(true);
    void loadRecentAssets();
  }, [attachEnabled, loadRecentAssets]);

  const handleGallery = useCallback(async () => {
    if (!attachEnabled) return;
    closeAttachmentSheet();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        quality: 0.9,
        videoMaxDuration: 60,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const fallbackName = `${asset.type === 'video' ? 'video' : 'photo'}-${Date.now()}.${asset.type === 'video' ? 'mp4' : 'jpg'}`;
      await queueUpload(
        asset.uri,
        asset.fileName ?? fallbackName,
        asset.mimeType,
        asset.fileSize,
      );
    } catch (error: any) {
      setUploadError(error?.message ?? 'Could not open the photo gallery.');
    }
  }, [attachEnabled, closeAttachmentSheet, queueUpload]);

  const handlePickDocument = useCallback(async () => {
    if (!attachEnabled) return;
    closeAttachmentSheet();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/heic',
          'video/mp4',
          'video/quicktime',
          'application/pdf',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      await queueUpload(asset.uri, asset.name, asset.mimeType, asset.size);
    } catch (error: any) {
      setUploadError(error?.message ?? 'Could not open the document picker.');
    }
  }, [attachEnabled, closeAttachmentSheet, queueUpload]);

  const handleSelectRecent = useCallback(
    async (asset: MediaLibrary.Asset) => {
      if (!attachEnabled) return;
      closeAttachmentSheet();
      try {
        // SDK 57's native bridge reliably accepts the stable asset id here.
        // Passing the full JS object can be rejected on Android devices.
        let selectedUri = asset.uri;
        try {
          const info = await MediaLibrary.getAssetInfoAsync(asset.id);
          selectedUri = info.localUri ?? info.uri ?? asset.uri;
        } catch {
          // MediaLibrary may reject metadata lookup for provider-backed or
          // limited-access items even though their returned content URI is usable.
          if (!selectedUri) throw new Error('Could not prepare that photo.');
        }
        const name = asset.filename || `${asset.mediaType === 'video' ? 'video' : 'photo'}-${Date.now()}`;
        const fallbackType = asset.mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
        await queueUpload(
          selectedUri,
          name,
          resolveContentType(undefined, name) ?? fallbackType,
          0,
        );
      } catch (error: any) {
        setUploadError(error?.message ?? 'Could not prepare that photo.');
      }
    },
    [attachEnabled, closeAttachmentSheet, queueUpload],
  );

  const handleLocation = useCallback(async () => {
    if (!attachEnabled) return;
    closeAttachmentSheet();
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Location permission needed', 'Allow Avarpus to access your location to share it in this chat.');
        return;
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = location.coords;
      const locationMessage =
        `📍 My location\nhttps://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
      Alert.alert(
        'Send current location?',
        'This will share your precise current location in this conversation.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Send location',
            onPress: () => sendTextValue(locationMessage),
          },
        ],
      );
    } catch (error: any) {
      Alert.alert('Could not get location', error?.message ?? 'Try again when location is available.');
    }
  }, [attachEnabled, closeAttachmentSheet, sendTextValue]);

  const handleContact = useCallback(async () => {
    if (!attachEnabled) return;
    setContactsMode(true);
    setAttachmentSheetExpanded(true);
    setAttachmentSheetOpen(true);
    if (deviceContacts.length > 0) return;
    setContactsLoading(true);
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        setContactsMode(false);
        setAttachmentSheetExpanded(false);
        Alert.alert('Contacts permission needed', 'Allow Avarpus to choose a contact to share in this chat.');
        return;
      }
      const result = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
        pageSize: 100,
      });
      setDeviceContacts(
        result.data.filter((contact) => Boolean(contact.name && contact.phoneNumbers?.some((phone) => phone.number))),
      );
    } catch (error: any) {
      Alert.alert('Could not read contacts', error?.message ?? 'Try again when contacts are available.');
    } finally {
      setContactsLoading(false);
    }
  }, [attachEnabled, deviceContacts.length]);

  const handleSelectContact = useCallback(
    (contact: Contacts.ExistingContact) => {
      const phone = contact.phoneNumbers?.find((item) => item.number)?.number;
      closeAttachmentSheet();
      sendTextValue(`👤 ${contact.name}${phone ? `\nPhone: ${phone}` : ''}`);
    },
    [closeAttachmentSheet, sendTextValue],
  );

  // ── Voice recording ──────────────────────────────────────────────────────

  const handleMicPress = useCallback(async () => {
    if (!providerAvailable || !resolvedRoomId) return;
    if (recordingPhase !== 'idle') return;
    if (uploadProgress !== null || isSendingUpload) return;

    setPermissionDenied(false);
    setRecorderError(null);
    setRecordingPhase('requesting');

    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        setPermissionDenied(true);
        setRecordingPhase('idle');
        return;
      }

      // Configure audio session for recording
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      audioModeActiveRef.current = true;

      recorder.record();
      setRecordingPhase('recording');
    } catch (err: any) {
      // record() (or setAudioModeAsync) failed — always restore the session so
      // the mic/audio route is not left locked in recording mode.
      await resetAudioMode();
      setRecorderError(err?.message ?? 'Could not start recording.');
      setRecordingPhase('idle');
    }
  }, [providerAvailable, resolvedRoomId, recordingPhase, uploadProgress, isSendingUpload, recorder, resetAudioMode]);

  const handleStopAndSendRecording = useCallback(async () => {
    if (recordingPhase !== 'recording') return;
    setRecordingPhase('stopping');

    try {
      const durationMs = capturedDurationRef.current || recorderState.durationMillis || 1;
      // expo-audio on Android can clear recorder.uri as stop() finalises the
      // native recorder. Capture the prepared file URI before stopping.
      const uriBeforeStop = recorder.uri ?? (recorderState as any).url ?? null;
      await recorder.stop();

      const uri = recorder.uri ?? (recorderState as any).url ?? uriBeforeStop;
      if (!uri) throw new Error('Recording URI unavailable after stop.');

      const timestamp = Date.now();
      const filename = `voice-note-${timestamp}.m4a`;

      // Get file size
      let size = 0;
      if (Platform.OS !== 'web') {
        const info = await FileSystem.getInfoAsync(uri);
        size = info.exists && 'size' in info ? (info as any).size : 0;
      }

      // Recording finished — restore the audio session before uploading.
      await resetAudioMode();

      const upload: PendingUpload = {
        uri,
        name: filename,
        size,
        contentType: 'audio/mp4',
        clientRequestId: makeClientRequestId('voice'),
        durationMs: Math.min(durationMs, MAX_RECORDING_MS),
      };
      setPendingUpload(upload);
      setRecordingPhase('idle');
      setUploadError(null);

      // Auto-start the upload/send immediately
      await handleSendUpload(upload);
    } catch (err: any) {
      // stop()/getInfoAsync failed — always restore the session so the audio
      // route is not left locked in recording mode.
      await resetAudioMode();
      setRecorderError(err?.message ?? 'Recording failed.');
      setRecordingPhase('idle');
    }
  }, [recordingPhase, recorder, recorderState, handleSendUpload, resetAudioMode]);

  const handleCancelRecording = useCallback(async () => {
    if (recordingPhase !== 'recording') return;
    setRecordingPhase('stopping');
    try {
      await recorder.stop();
    } catch {
      // Best-effort stop — ignore errors
    } finally {
      // Always restore the audio session on cancel, even if stop() threw.
      await resetAudioMode();
    }
    setRecordingPhase('idle');
    setRecorderError(null);
    // Do NOT set pendingUpload — cancel means discard (no upload / no send).
  }, [recordingPhase, recorder, resetAudioMode]);

  // ── Download / open / share ─────────────────────────────────────────────
  const handleDownloadAttachment = useCallback(
    async (roomId: string, messageId: string, filename: string, authToken: string | null) => {
      try {
        if (Platform.OS === 'web') {
          const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
            ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
            : '';
          const mediaUrl = `${baseUrl}${getChatMessageMediaUrl(roomId, messageId)}`;
          const resp = await fetch(mediaUrl, {
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          });
          if (!resp.ok) throw new Error(`Download failed (HTTP ${resp.status})`);
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = sanitiseFilename(filename);
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          const safe = sanitiseFilename(filename);
          const dest = `${FileSystem.cacheDirectory}chat_media_${messageId}_${safe}`;
          const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
            ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
            : '';
          const mediaUrl = `${baseUrl}${getChatMessageMediaUrl(roomId, messageId)}`;
          const dlResult = await FileSystem.downloadAsync(mediaUrl, dest, {
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          });
          if (dlResult.status && dlResult.status !== 200) {
            throw new Error(`Download failed (HTTP ${dlResult.status})`);
          }
          const sharingAvailable = await Sharing.isAvailableAsync();
          if (sharingAvailable) {
            await Sharing.shareAsync(dlResult.uri, { dialogTitle: safe });
          }
        }
      } catch (err: any) {
        setSendError(err?.message ?? 'Could not download attachment.');
      }
    },
    [],
  );

  // ── Derived flags ───────────────────────────────────────────────────────
  const micEnabled =
    providerAvailable &&
    !isBlocked &&
    !!resolvedRoomId &&
    uploadProgress === null &&
    !isSendingUpload &&
    recordingPhase === 'idle' &&
    !pendingUpload;

  const isRecording = recordingPhase === 'recording';

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(blinkAnim, { toValue: 0.2, duration: 600, useNativeDriver: true }),
          Animated.timing(blinkAnim, { toValue: 1, duration: 600, useNativeDriver: true })
        ])
      ).start();
    } else {
      blinkAnim.stopAnimation();
      blinkAnim.setValue(1);
    }
  }, [isRecording, blinkAnim]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPadding, backgroundColor: colors.card, borderBottomColor: colors.border, paddingBottom: 6 },
        ]}
      >
        <TouchableOpacity
          onPress={handleBack}
          style={styles.iconButton}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Avatar name={roomName} size={34} />
        <View style={styles.headerTitleContainer}>
          <Text
            style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 15 }]}
            numberOfLines={1}
          >
            {roomName}
          </Text>
          {!!presenceText && (
            <View style={styles.presenceRow}>
              {room?.peerOnline && (
                <View style={[styles.presenceDot, { backgroundColor: colors.success }]} />
              )}
              <Text style={[styles.headerSubtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 11 }]}>
                {presenceText}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={[styles.disabledHeaderAction, { opacity: callEnabled ? 1 : 0.4 }]}
          accessibilityLabel={callEnabled ? 'Start or join voice call' : 'Voice calls unavailable'}
          disabled={!callEnabled}
          onPress={() =>
            router.push(
              `/(tabs)/customers/chat/call/${resolvedRoomId}?mode=audio&name=${encodeURIComponent(roomName)}`,
            )
          }
        >
          <Feather
            name="phone"
            size={18}
            color={callEnabled ? colors.primary : colors.mutedForeground}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.disabledHeaderAction, { opacity: callEnabled ? 1 : 0.4 }]}
          accessibilityLabel={callEnabled ? 'Start or join video call' : 'Video calls unavailable'}
          disabled={!callEnabled}
          onPress={() =>
            router.push(
              `/(tabs)/customers/chat/call/${resolvedRoomId}?mode=video&name=${encodeURIComponent(roomName)}`,
            )
          }
        >
          <Feather
            name="video"
            size={18}
            color={callEnabled ? colors.primary : colors.mutedForeground}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.disabledHeaderAction}
          accessibilityLabel="Open chat menu"
          onPress={openChatMenu}
        >
          <Feather name="more-vertical" size={18} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* Safety notice — chat never handles payments or ledger activity. */}
      <View
        style={[
          styles.chatSafetyArea,
          { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.border },
        ]}
      >
        <View style={[styles.chatSafetyCard, { backgroundColor: colors.warningLight }]}>
          <Feather name="lock" size={13} color={colors.warning} />
          <View style={styles.chatSafetyCopy}>
            <Text style={[styles.chatSafetyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
              Avarpus private conversation
            </Text>
            <Text style={[styles.chatSafetyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Communication only.
            </Text>
            <Text style={[styles.chatSafetyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              End-to-end encryption is not enabled
            </Text>
          </View>
        </View>
      </View>

      {/* Body */}
      <View style={styles.chatBody}>
        <ChatWallpaper colors={colors} />
        {capLoading ? (
          <View style={styles.centeredState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !providerAvailable ? (
          <View style={styles.centeredState}>
            <View
              style={[styles.noticeCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.noticeIcon, { backgroundColor: colors.primary + '18' }]}>
                <Feather name="message-circle" size={24} color={colors.primary} />
              </View>
              <Text
                style={[
                  styles.noticeTitle,
                  { color: colors.foreground, fontFamily: 'Inter_700Bold' },
                ]}
              >
                Chat setup pending
              </Text>
              <Text
                style={[
                  styles.noticeText,
                  { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
                ]}
              >
                Messaging, attachments, voice notes and calls will be available after the
                communication service is connected.
              </Text>
              <View style={[styles.safetyNote, { backgroundColor: colors.backgroundSecondary }]}>
                <Feather name="shield" size={15} color={colors.mutedForeground} />
                <Text
                  style={[
                    styles.safetyText,
                    { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
                  ]}
                >
                  Nothing is sent or stored from this screen.
                </Text>
              </View>
            </View>
          </View>
        ) : roomCreateError ? (
          <View style={styles.centeredState}>
            <Feather name="alert-circle" size={32} color={colors.destructive} />
            <Text
              style={[
                styles.noticeTitle,
                { color: colors.foreground, fontFamily: 'Inter_700Bold', marginTop: 12 },
              ]}
            >
              Could not open chat
            </Text>
            <Text
              style={[
                styles.noticeText,
                {
                  color: colors.mutedForeground,
                  fontFamily: 'Inter_400Regular',
                  textAlign: 'center',
                  marginTop: 6,
                },
              ]}
            >
              {roomCreateError}
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                setRoomCreateError(null);
                clientRequestIdRef.current = makeClientRequestId('room');
                requestRoomCreation();
              }}
            >
              <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        ) : !resolvedRoomId || msgsLoading ? (
          <View style={styles.centeredState}>
            <ActivityIndicator color={colors.primary} />
            <Text
              style={[
                styles.stateText,
                { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
              ]}
            >
              {!resolvedRoomId ? 'Opening chat room…' : 'Loading messages…'}
            </Text>
          </View>
        ) : msgsError ? (
          <View style={styles.centeredState}>
            <Feather name="alert-circle" size={28} color={colors.destructive} />
            <Text
              style={[
                styles.noticeTitle,
                { color: colors.foreground, fontFamily: 'Inter_700Bold', marginTop: 10 },
              ]}
            >
              Could not load messages
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: colors.primary }]}
              onPress={() => msgsRefetch()}
            >
              <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={allMessages}
            keyExtractor={(item) => item.id}
            inverted
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item, index }) => {
              const nextMessage = allMessages[index + 1];
              const showDateSeparator =
                !nextMessage || messageDayKey(nextMessage.createdAt) !== messageDayKey(item.createdAt);
              return (
                <View>
                  <MessageBubble
                    msg={item}
                    isMine={item.senderId === user?.id}
                    colors={colors}
                    token={token}
                    onDownload={handleDownloadAttachment}
                  />
                  {showDateSeparator && <DateSeparator date={item.createdAt} colors={colors} />}
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.centeredState}>
                <Text
                  style={[
                    styles.stateText,
                    { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
                  ]}
                >
                  No messages yet. Send the first one!
                </Text>
              </View>
            }
          />
        )}
      </View>

      {isBlocked && (
        <View
          style={[
            styles.errorBar,
            {
              backgroundColor: colors.destructive + '12',
              borderTopColor: colors.destructive + '30',
            },
          ]}
        >
          <Feather name="slash" size={14} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            {blockedByMe
              ? 'You blocked this contact. Existing messages remain available.'
              : 'This contact blocked the conversation. Existing messages remain available.'}
          </Text>
        </View>
      )}

      {/* Recording overlay (replaces composer while recording) */}
      {isRecording && (
        <View
          style={[
            styles.composer,
            {
              paddingBottom: isKeyboardVisible ? 6 : Math.max(insets.bottom, 6),
            },
          ]}
        >
          <View
            style={[
              styles.inputContainer,
              { backgroundColor: colors.card, borderColor: colors.border, justifyContent: 'space-between', paddingLeft: 12 },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Animated.View style={{ opacity: blinkAnim }}>
                <View style={styles.recordingDot} />
              </Animated.View>
              <Text
                style={[styles.recordingTimer, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}
                accessibilityLabel="Recording elapsed time"
              >
                {formatDuration(recorderState.durationMillis)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleCancelRecording}
              style={{ paddingHorizontal: 12, height: '100%', justifyContent: 'center' }}
              accessibilityLabel="Cancel recording"
            >
              <Text style={{ color: colors.destructive, fontFamily: 'Inter_500Medium', fontSize: 15 }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={handleStopAndSendRecording}
            style={[styles.actionCircle, { backgroundColor: colors.primary }]}
            accessibilityLabel="Stop and send recording"
          >
            <Feather
              name="send"
              size={19}
              color={colors.primaryForeground}
              style={{ transform: [{ translateX: -1 }, { translateY: 1 }] }}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* Pending upload preview (file attachments + voice notes after stop) */}
      {!isRecording && pendingUpload && (
        <View
          style={[
            styles.attachmentPreview,
            { backgroundColor: colors.card, borderTopColor: colors.border },
          ]}
        >
          <Feather
            name={
              pendingUpload.contentType.startsWith('image/')
                ? 'image'
                : pendingUpload.contentType.startsWith('audio/')
                ? 'mic'
                : 'file'
            }
            size={18}
            color={colors.primary}
          />
          <View style={styles.attachmentPreviewInfo}>
            <Text
              style={[
                styles.attachmentPreviewName,
                { color: colors.foreground, fontFamily: 'Inter_500Medium' },
              ]}
              numberOfLines={1}
            >
              {pendingUpload.name}
            </Text>
            <Text
              style={[
                styles.attachmentPreviewSize,
                { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
              ]}
            >
              {pendingUpload.durationMs
                ? formatDuration(pendingUpload.durationMs)
                : formatBytes(pendingUpload.size)}
              {uploadProgress !== null && uploadProgress < 1
                ? `  ·  Uploading ${Math.round(uploadProgress * 100)}%`
                : isSendingUpload
                ? '  ·  Sending…'
                : ''}
            </Text>
          </View>
          {uploadProgress === null && !isSendingUpload ? (
            <>
              <TouchableOpacity
                onPress={() => handleSendUpload()}
                style={[styles.attachSendBtn, { backgroundColor: colors.primary }]}
                accessibilityLabel="Send attachment"
              >
                <Feather name="send" size={15} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setPendingUpload(null);
                  setUploadError(null);
                }}
                style={styles.attachCancelBtn}
                accessibilityLabel="Cancel attachment"
              >
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </>
          ) : (
            <ActivityIndicator size="small" color={colors.primary} />
          )}
        </View>
      )}

      {/* Composer (hidden while recording) */}
      {!isRecording && (
        <View
          style={[
            styles.composer,
            {
              paddingBottom: isKeyboardVisible ? 6 : Math.max(insets.bottom, 6),
            },
          ]}
        >
          <View
            style={[
              styles.inputContainer,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <TextInput
              style={[styles.input, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
              placeholder={providerAvailable ? 'Message…' : 'Messaging is not available yet'}
              placeholderTextColor={colors.mutedForeground}
              value={text}
              onChangeText={setText}
              editable={providerAvailable && !!resolvedRoomId && !isBlocked}
              multiline
              returnKeyType="default"
              blurOnSubmit={false}
            />
            <TouchableOpacity
              onPress={openAttachmentSheet}
              disabled={!attachEnabled}
              style={[styles.inlineComposerAction, { opacity: attachEnabled ? 1 : 0.4 }]}
              accessibilityLabel={attachEnabled ? 'Add attachment' : 'Attachments not available'}
            >
              <Feather
                name="paperclip"
                size={20}
                color={attachEnabled ? colors.mutedForeground : colors.textDisabled ?? colors.mutedForeground}
                style={{ transform: [{ rotate: '-45deg' }] }}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleGallery}
              disabled={!attachEnabled}
              style={[styles.inlineComposerAction, { opacity: attachEnabled ? 1 : 0.4 }]}
              accessibilityLabel={attachEnabled ? 'Attach photo' : 'Camera unavailable'}
            >
              <Feather
                name="camera"
                size={20}
                color={attachEnabled ? colors.mutedForeground : colors.textDisabled ?? colors.mutedForeground}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={text.trim() ? handleSend : handleMicPress}
            disabled={text.trim() ? !resolvedRoomId || !providerAvailable || isBlocked : !micEnabled}
            style={[
              styles.actionCircle,
              {
                backgroundColor:
                  text.trim() && resolvedRoomId && providerAvailable && !isBlocked
                    ? colors.primary
                    : micEnabled
                    ? colors.primary
                    : colors.border,
              },
            ]}
            accessibilityLabel={
              text.trim()
                ? 'Send message'
                : micEnabled
                ? 'Record voice note'
                : 'Voice notes unavailable'
            }
          >
            <Feather
              name={text.trim() ? 'send' : 'mic'}
              size={text.trim() ? 19 : 22}
              color={text.trim() || micEnabled ? colors.primaryForeground : colors.mutedForeground}
              style={text.trim() ? { transform: [{ translateX: -1 }, { translateY: 1 }] } : undefined}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* Permission denied notice */}
      {permissionDenied && (
        <View
          style={[
            styles.errorBar,
            {
              backgroundColor: colors.destructive + '18',
              borderTopColor: colors.destructive + '30',
            },
          ]}
        >
          <Feather name="mic-off" size={14} color={colors.destructive} />
          <Text
            style={[styles.errorText, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}
          >
            Microphone permission denied. Enable it in Settings to send voice notes.
          </Text>
          <TouchableOpacity onPress={() => setPermissionDenied(false)}>
            <Feather name="x" size={14} color={colors.destructive} />
          </TouchableOpacity>
        </View>
      )}

      {/* Recorder error notice */}
      {recorderError && (
        <View
          style={[
            styles.errorBar,
            {
              backgroundColor: colors.destructive + '18',
              borderTopColor: colors.destructive + '30',
            },
          ]}
        >
          <Feather name="alert-circle" size={14} color={colors.destructive} />
          <Text
            style={[styles.errorText, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}
            numberOfLines={2}
          >
            {recorderError}
          </Text>
          <TouchableOpacity onPress={() => setRecorderError(null)}>
            <Feather name="x" size={14} color={colors.destructive} />
          </TouchableOpacity>
        </View>
      )}

      {/* Upload / attachment send error bar */}
      {uploadError && (
        <View
          style={[
            styles.errorBar,
            {
              backgroundColor: colors.destructive + '18',
              borderTopColor: colors.destructive + '30',
            },
          ]}
        >
          <Feather name="alert-circle" size={14} color={colors.destructive} />
          <Text
            style={[
              styles.errorText,
              { color: colors.destructive, fontFamily: 'Inter_400Regular' },
            ]}
            numberOfLines={2}
          >
            {uploadError}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setUploadError(null);
              if (pendingUpload) void handleSendUpload();
            }}
          >
            <Text
              style={{
                color: colors.destructive,
                fontFamily: 'Inter_600SemiBold',
                fontSize: 12,
                marginLeft: 4,
              }}
            >
              Retry
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setUploadError(null);
              setPendingUpload(null);
            }}
          >
            <Feather name="x" size={14} color={colors.destructive} />
          </TouchableOpacity>
        </View>
      )}

      {/* Text send error bar */}
      {sendError && (
        <View
          style={[
            styles.errorBar,
            {
              backgroundColor: colors.destructive + '18',
              borderTopColor: colors.destructive + '30',
            },
          ]}
        >
          <Feather name="alert-circle" size={14} color={colors.destructive} />
          <Text
            style={[
              styles.errorText,
              { color: colors.destructive, fontFamily: 'Inter_400Regular' },
            ]}
            numberOfLines={2}
          >
            {sendError}
          </Text>
          <TouchableOpacity onPress={() => setSendError(null)}>
            <Feather name="x" size={14} color={colors.destructive} />
          </TouchableOpacity>
        </View>
      )}

      <AttachmentSheet
        visible={attachmentSheetOpen}
        expanded={attachmentSheetExpanded}
        recentAssets={recentAssets}
        recentLoading={recentAssetsLoading}
        recentLoadingMore={recentAssetsLoadingMore}
        recentHasMore={recentAssetsHasMore}
        recentMediaAccess={recentMediaAccess}
        contactsMode={contactsMode}
        contacts={deviceContacts}
        contactsLoading={contactsLoading}
        colors={colors}
        bottomInset={insets.bottom}
        onClose={closeAttachmentSheet}
        onExpand={() => setAttachmentSheetExpanded(true)}
        onCollapse={() => {
          setContactsMode(false);
          setAttachmentSheetExpanded(false);
        }}
        onGallery={handleGallery}
        onDocument={handlePickDocument}
        onLocation={handleLocation}
        onContact={handleContact}
        onBackFromContacts={() => {
          setContactsMode(false);
          setAttachmentSheetExpanded(false);
        }}
        onRetryRecents={() => void loadRecentAssets()}
        onOpenSettings={handleOpenMediaSettings}
        onLoadMoreRecents={() => void loadMoreRecentAssets()}
        onSelectRecent={handleSelectRecent}
        onSelectContact={handleSelectContact}
      />
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
  },
  iconButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitleContainer: { flex: 1, paddingHorizontal: 8, justifyContent: 'center' },
  headerTitle: { fontSize: 16 },
  presenceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  presenceDot: { width: 6, height: 6, borderRadius: 3 },
  headerSubtitle: { fontSize: 11 },
  disabledHeaderAction: {
    width: 32,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSafetyArea: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chatSafetyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    maxWidth: 340,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  chatSafetyCopy: { flexShrink: 1 },
  chatSafetyTitle: { fontSize: 11 },
  chatSafetyText: { fontSize: 10, marginTop: 1 },
  chatBody: { flex: 1, overflow: 'hidden' },
  wallpaperBase: { ...StyleSheet.absoluteFill, opacity: 0.72 },
  wallpaperMotif: { position: 'absolute' },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  stateText: { fontSize: 14 },
  noticeCard: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 420,
    width: '100%',
  },
  noticeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  noticeTitle: { fontSize: 17, marginBottom: 8 },
  noticeText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  safetyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  safetyText: { flexShrink: 1, fontSize: 11 },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
  },
  messageList: { paddingHorizontal: 11, paddingVertical: 10, flexGrow: 1 },
  bubbleRow: { marginVertical: 2 },
  bubbleRowMine: { alignItems: 'flex-end' },
  bubbleRowTheirs: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 2,
  },
  bubbleMine: { borderBottomRightRadius: 4 },
  bubbleTheirs: { borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  bubbleMedia: { padding: 6 },
  bubbleText: { fontSize: 14, lineHeight: 19 },
  bubbleFooter: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 3, marginTop: 1 },
  bubbleTime: { fontSize: 10 },
  deliveryTicks: { fontSize: 10, letterSpacing: -2 },
  dateSeparator: {
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  dateSeparatorText: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  deletedMsg: { fontSize: 12, fontStyle: 'italic', paddingVertical: 4 },
  imageAttachment: {
    width: 200,
    height: 200,
    borderRadius: 10,
    backgroundColor: '#222',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 160,
    maxWidth: 260,
  },
  fileRowName: { flex: 1, fontSize: 13 },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 180,
    maxWidth: 260,
    paddingVertical: 4,
  },
  audioPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioTrackArea: { flex: 1, gap: 4 },
  audioTrackBg: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  audioTrackFg: {
    height: '100%',
    borderRadius: 2,
  },
  audioDuration: { fontSize: 10 },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 10,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  recordingTimer: { fontSize: 16, minWidth: 52 },
  recordingLabel: { flex: 1, fontSize: 13 },
  recordingActions: { flexDirection: 'row', gap: 8 },
  recordingBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  attachmentPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  attachmentPreviewInfo: { flex: 1 },
  attachmentPreviewName: { fontSize: 13 },
  attachmentPreviewSize: { fontSize: 11, marginTop: 2 },
  attachSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachCancelBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingTop: 8,
    gap: 8,
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    paddingHorizontal: 4,
    minHeight: 48,
    borderWidth: 0,
  },
  inlineComposerAction: {
    width: 36,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  actionCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  errorText: { flex: 1, fontSize: 12 },
  attachmentSheetOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    zIndex: 20,
  },
  attachmentSheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 8, 23, 0.34)',
  },
  attachmentSheet: {
    height: 472,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#020817',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -5 },
    elevation: 18,
  },
  attachmentSheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    marginTop: 9,
    marginBottom: 3,
  },
  attachmentSheetHeader: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  attachmentSheetClose: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentSheetTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
  },
  attachmentSheetHeaderSpacer: { width: 38 },
  attachmentActionRow: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 12,
  },
  attachmentAction: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  attachmentActionIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentActionLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  attachmentRecentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 9,
  },
  attachmentRecentTitle: { fontSize: 14 },
  attachmentSeeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingLeft: 8,
  },
  attachmentSeeAllText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  attachmentStrip: { paddingHorizontal: 14, gap: 8 },
  attachmentRecentScroll: { flex: 1 },
  attachmentPermissionNote: {
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  attachmentPermissionText: { flex: 1, fontSize: 12, lineHeight: 16 },
  attachmentPermissionAction: { fontSize: 12, fontWeight: '700' },
  attachmentGrid: {
    paddingHorizontal: 12,
    gap: 7,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  attachmentStripItem: {
    width: 82,
    height: 82,
    borderRadius: 10,
    overflow: 'hidden',
  },
  attachmentGridItem: {
    width: '31.8%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  attachmentRecentImage: { width: '100%', height: '100%', backgroundColor: '#E2E8F0' },
  attachmentVideoBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 8, 23, 0.68)',
  },
  attachmentPageLoader: {
    width: '100%',
    paddingVertical: 20,
    alignItems: 'center',
  },
  attachmentEndText: {
    width: '100%',
    textAlign: 'center',
    fontSize: 12,
    paddingVertical: 18,
  },
  attachmentLoadingRow: {
    minHeight: 116,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  attachmentEmptyState: {
    minHeight: 116,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 24,
  },
  attachmentEmptyText: { fontSize: 12, textAlign: 'center' },
  attachmentEmptyButton: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  attachmentEmptyButtonText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  contactPickerList: { flex: 1 },
  contactPickerContent: { paddingHorizontal: 14 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  contactAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactCopy: { flex: 1 },
  contactName: { fontSize: 14 },
  contactPhone: { fontSize: 12, marginTop: 2 },
});
