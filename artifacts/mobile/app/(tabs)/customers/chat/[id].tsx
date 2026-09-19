import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import * as Contacts from 'expo-contacts/legacy';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { useVoiceRecorder, deleteVoiceTempFile } from '@/hooks/useVoiceRecorder';
import { VoiceRecorderPanel } from '@/components/chat/VoiceRecorderPanel';
import { ImageViewer } from '@/components/chat/ImageViewer';
import {
  MessageSelectionHeader,
  QuotedMessage,
  ReplyComposerStrip,
  SELECTION_OVERLAY_COLOR,
  chatMediaUri,
} from '@/components/chat/messageActions';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { useColors } from '@/hooks/useColors';
import { useDeviceContactNames } from '@/hooks/useDeviceContactNames';
import { useConfirmDialog, type ConfirmAction } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/context/AuthContext';
import { Avatar } from '@/components/ui/Avatar';
import { storage, KEYS } from '@/utils/storage';
import {
  useChatCapabilities,
  useChatRoomsCreate,
  useChatRoomsGet,
  getChatRoomsGetQueryKey,
  getChatRoomsListQueryKey,
  getChatRoomsArchivedListQueryKey,
  useChatRoomsPreferencesUpdate,
  useChatRoomsBlock,
  useChatRoomsUnblock,
  useChatReportsCreate,
  useChatMessagesList,
  getChatMessagesListQueryKey,
  useChatMessagesSend,
  useChatMessagesDelete,
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
const DELETE_FOR_EVERYONE_WINDOW_MS = 24 * 60 * 60 * 1000; // sender may retract from everyone only within 24 hours

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

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp']);
/** Keep the original image extension when saving so the gallery classifies it correctly. */
function imageExtensionFor(filename: string | null | undefined): string {
  const ext = (filename ?? '').split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext) ? ext : 'jpg';
}

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
  selectable = true,
  selected = false,
  selectionMode = false,
  onSelectStart,
  onToggleSelect,
  onOpenImage,
  onOpenQuote,
  quoteSenderLabel,
}: {
  msg: ChatMessage;
  isMine: boolean;
  colors: any;
  token: string | null;
  onDownload: (roomId: string, messageId: string, filename: string, token: string | null) => void;
  /** Optimistic (not yet persisted) rows cannot be selected. */
  selectable?: boolean;
  selected?: boolean;
  selectionMode?: boolean;
  /** Long-press entry into selection mode. */
  onSelectStart?: (msg: ChatMessage) => void;
  onToggleSelect?: (msg: ChatMessage) => void;
  onOpenImage?: (msg: ChatMessage) => void;
  onOpenQuote?: (quoteId: string) => void;
  quoteSenderLabel?: string;
}) {
  if (msg.deletedAt) {
    return (
      <View style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
        <View
          style={[
            styles.bubble,
            styles.deletedBubble,
            isMine
              ? [styles.bubbleMine, { backgroundColor: colors.card, borderColor: colors.border }]
              : [styles.bubbleTheirs, { backgroundColor: colors.card, borderColor: colors.border }],
          ]}
        >
          <Feather name="slash" size={12} color={colors.mutedForeground} />
          <Text style={[styles.deletedMsg, { color: colors.mutedForeground }]} testID={`deleted-message-${msg.id}`}>
            {isMine ? 'You deleted this message' : 'This message was deleted'}
          </Text>
        </View>
      </View>
    );
  }

  const isImage = msg.kind === 'image';
  const isFile = msg.kind === 'file';
  const isAudio = msg.kind === 'audio';
  const canSelect = selectable && !!onSelectStart;

  const handlePress = () => {
    if (selectionMode) {
      if (canSelect) onToggleSelect?.(msg);
      return;
    }
    if (isImage) onOpenImage?.(msg);
  };

  return (
    <Pressable
      onLongPress={canSelect ? () => onSelectStart?.(msg) : undefined}
      onPress={selectionMode || isImage ? handlePress : undefined}
      delayLongPress={450}
      style={styles.selectableRow}
      accessibilityLabel={selected ? 'Selected message' : undefined}
      accessibilityState={selectionMode ? { selected } : undefined}
      testID={`message-row-${msg.id}`}
    >
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
          {msg.forwarded && (
            <View style={styles.forwardedRow} testID={`forwarded-label-${msg.id}`}>
              <MaterialCommunityIcons
                name="share"
                size={12}
                color={isMine ? 'rgba(255,255,255,0.72)' : colors.mutedForeground}
              />
              <Text style={[styles.forwardedText, { color: isMine ? 'rgba(255,255,255,0.72)' : colors.mutedForeground }]}>
                Forwarded
              </Text>
            </View>
          )}
          {msg.replyTo && (
            <View style={styles.quoteInBubble}>
              <QuotedMessage
                quote={msg.replyTo}
                roomId={msg.roomId}
                token={token}
                colors={colors}
                senderLabel={quoteSenderLabel ?? msg.replyTo.senderName}
                onDark={isMine}
                onPress={
                  !selectionMode && onOpenQuote && !msg.replyTo.deleted
                    ? () => onOpenQuote(msg.replyTo!.id)
                    : undefined
                }
                testID={`quote-${msg.id}`}
              />
            </View>
          )}
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
      {selected && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: SELECTION_OVERLAY_COLOR }]}
          testID={`message-selected-${msg.id}`}
        />
      )}
    </Pressable>
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
  /** The app created this cache file itself and must delete it once done. */
  ownedTempFile?: boolean;
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
                <AvarpusSpinner size={20} />
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
                <AvarpusSpinner size={20} />
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
                    <AvarpusSpinner size={20} />
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

// ── Main Screen ───────────────────────────────────────────────────────────

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const rawColors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  
  const colors = useMemo(() => ({
    ...rawColors,
    primary: isDark ? '#2563EB' : rawColors.primary,
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
    /** Optional composer prefill (e.g. a dealer transaction reference). */
    draft?: string;
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
  const [text, setText] = useState(() => (typeof params.draft === 'string' ? params.draft : ''));
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

  const [sendError, setSendError] = useState<string | null>(null);
  const [optimisticMsgs, setOptimisticMsgs] = useState<ChatMessage[]>([]);

  // ── Message actions (select / reply / forward / delete / view) ──────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [viewerMessage, setViewerMessage] = useState<ChatMessage | null>(null);
  const composerInputRef = useRef<TextInput>(null);
  const clientRequestIdRef = useRef(makeClientRequestId('room'));
  const pendingSendRef = useRef<{ body: string; replyToId: string | null; clientRequestId: string } | null>(null);

  // ── Shared upload/send state (file attachments + voice notes) ──────────
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const pendingUploadRef = useRef<PendingUpload | null>(null);
  pendingUploadRef.current = pendingUpload;
  /** Single exit for a pending attachment: disposes app-owned temp files. */
  const clearPendingUpload = useCallback(() => {
    const current = pendingUploadRef.current;
    if (current?.ownedTempFile) deleteVoiceTempFile(current.uri);
    pendingUploadRef.current = null;
    setPendingUpload(null);
  }, []);
  useEffect(() => {
    return () => {
      const current = pendingUploadRef.current;
      if (current?.ownedTempFile) deleteVoiceTempFile(current.uri);
    };
  }, []);
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

  // ── Voice recording ─────────────────────────────────────────────────────
  const voice = useVoiceRecorder({ maxDurationMs: MAX_RECORDING_MS });
  const recordingPhase = voice.phase;
  // Panel replaces the composer once a note is actually in progress; while
  // the permission prompt is up the composer stays with a disabled mic.
  const isRecording = voice.isActive && voice.phase !== 'requesting';
  const permissionDenied = voice.permissionDenied;
  const recorderError = voice.error;
  const [voiceSending, setVoiceSending] = useState(false);

  // ── Capabilities ────────────────────────────────────────────────────────
  const { data: capData, isLoading: capLoading } = useChatCapabilities();
  const providerAvailable = capData?.matrixAvailable === true;
  const voiceAvailable = capData?.livekitAvailable === true;

  // ── Room resolution ─────────────────────────────────────────────────────
  const looksLikeRoomId = routeId && !targetId;

  const createRoomMutation = useChatRoomsCreate();
  const [createdRoomId, setCreatedRoomId] = useState<string | null>(null);
  const resolvedRoomId = looksLikeRoomId ? routeId : createdRoomId;
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
          setCreatedRoomId(res.room.id);
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
  const deviceContactNames = useDeviceContactNames();
  const roomName = deviceContactNames.nameFor(room?.peerMobile, room?.name ?? name);
  const presenceText = room?.peerOnline ? 'online' : formatLastSeen(room?.peerLastSeenAt);
  const isBlocked = room?.isBlocked === true;
  const blockedByMe = room?.blockedByMe === true;
  const callEnabled =
    voiceAvailable && !!resolvedRoomId && Platform.OS !== 'web' && !isBlocked;
  const blockMutation = useChatRoomsBlock();
  const unblockMutation = useChatRoomsUnblock();
  const reportMutation = useChatReportsCreate();
  const preferencesUpdate = useChatRoomsPreferencesUpdate();
  const archivePreferenceInFlightRef = useRef(false);
  const blockPreferenceInFlightRef = useRef(false);
  const pendingReportsRef = useRef(
    new Map<string, { reason: ChatReportReason; id: string }>(),
  );
  const reportInFlightRef = useRef(new Map<string, string>());
  const activeReportRoomRef = useRef(resolvedRoomId);
  activeReportRoomRef.current = resolvedRoomId;

  const refreshRoomSafetyState = useCallback(async () => {
    if (!resolvedRoomId) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getChatRoomsGetQueryKey(resolvedRoomId),
      }),
      queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() }),
    ]);
  }, [queryClient, resolvedRoomId]);

  const updateArchivePreference = useCallback(async () => {
    if (
      archivePreferenceInFlightRef.current ||
      !resolvedRoomId ||
      !room ||
      (room.kind !== 'customer' && room.kind !== 'direct')
    ) return;
    archivePreferenceInFlightRef.current = true;
    const nextArchived = room.isArchived !== true;
    try {
      await preferencesUpdate.mutateAsync({
        roomId: resolvedRoomId,
        data: { isArchived: nextArchived },
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getChatRoomsGetQueryKey(resolvedRoomId),
        }),
        queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getChatRoomsArchivedListQueryKey() }),
      ]);
    } catch (err: any) {
      Alert.alert(
        nextArchived ? 'Could not archive chat' : 'Could not restore chat',
        err?.data?.message ?? err?.message ?? 'Please check your connection and try again.',
      );
    } finally {
      archivePreferenceInFlightRef.current = false;
    }
  }, [preferencesUpdate, queryClient, resolvedRoomId, room]);

  const submitReport = useCallback(
    (reason: ChatReportReason) => {
      if (!resolvedRoomId || reportInFlightRef.current.has(resolvedRoomId)) return;
      const pendingReport = pendingReportsRef.current.get(resolvedRoomId);
      const clientRequestId =
        pendingReport?.reason === reason
          ? pendingReport.id
          : makeClientRequestId('report');
      pendingReportsRef.current.set(resolvedRoomId, { reason, id: clientRequestId });
      reportInFlightRef.current.set(resolvedRoomId, clientRequestId);
      const reportRoomId = resolvedRoomId;
      reportMutation.mutate(
        {
          roomId: reportRoomId,
          data: { reason, clientRequestId },
        },
        {
          onSuccess: () => {
            if (reportInFlightRef.current.get(reportRoomId) !== clientRequestId) return;
            reportInFlightRef.current.delete(reportRoomId);
            if (pendingReportsRef.current.get(reportRoomId)?.id === clientRequestId) {
              pendingReportsRef.current.delete(reportRoomId);
            }
            if (activeReportRoomRef.current === reportRoomId) {
              Alert.alert('Report submitted', 'Thank you. The report has been saved for review.');
            }
          },
          onError: (err: any) => {
            if (reportInFlightRef.current.get(reportRoomId) !== clientRequestId) return;
            reportInFlightRef.current.delete(reportRoomId);
            if (activeReportRoomRef.current === reportRoomId) {
              Alert.alert(
                'Could not submit report',
                err?.data?.message ?? err?.message ?? 'Please try again.',
              );
            }
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
          onPress: () => {
            if (blockPreferenceInFlightRef.current) return;
            blockPreferenceInFlightRef.current = true;
            mutation.mutate(
              { roomId: resolvedRoomId },
              {
                onSuccess: () => {
                  blockPreferenceInFlightRef.current = false;
                  void refreshRoomSafetyState();
                },
                onError: (err: any) => {
                  blockPreferenceInFlightRef.current = false;
                  Alert.alert(
                    `${action} failed`,
                    err?.data?.message ?? err?.message ?? 'Please try again.',
                  );
                },
              },
            );
          },
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
    if (room?.kind === 'customer' || room?.kind === 'direct') {
      options.push({
        text: room.isArchived ? 'Restore' : 'Archive',
        onPress: () => void updateArchivePreference(),
      });
    }
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
  }, [
    blockedByMe,
    isBlocked,
    openReportReasons,
    room?.isArchived,
    room?.kind,
    room?.scope,
    router,
    toggleBlock,
    updateArchivePreference,
  ]);

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

  const sendTextValue = useCallback((value: string, quoted: ChatMessage | null = replyTo) => {
    const trimmed = value.trim();
    if (!trimmed || !resolvedRoomId || isBlocked) return;
    const replyToId = quoted?.id ?? null;
    // Retry of the *same* payload (text + quote) reuses its idempotency key so
    // the server dedupes it; any change to the quote is a new message.
    const clientRequestId =
      pendingSendRef.current?.body === trimmed && pendingSendRef.current.replyToId === replyToId
        ? pendingSendRef.current.clientRequestId
        : makeClientRequestId('message');
    pendingSendRef.current = { body: trimmed, replyToId, clientRequestId };
    setSendError(null);
    setText('');
    setReplyTo(null);

    const optimistic: ChatMessage = {
      id: `opt-${clientRequestId}`,
      roomId: resolvedRoomId,
      shopId: '',
      senderId: user?.id ?? 'me',
      senderName: user?.name ?? 'Me',
      kind: 'text',
      body: trimmed,
      createdAt: new Date().toISOString(),
      replyTo: quoted
        ? {
            id: quoted.id,
            senderId: quoted.senderId,
            senderName: quoted.senderName,
            kind: quoted.kind,
            body: quoted.body,
            deleted: !!quoted.deletedAt,
          }
        : undefined,
    };
    setOptimisticMsgs((prev) => [optimistic, ...prev]);

    sendMutation.mutate(
      {
        roomId: resolvedRoomId,
        data: {
          kind: 'text',
          body: trimmed,
          clientRequestId,
          ...(quoted ? { replyToMessageId: quoted.id } : {}),
        },
      },
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
          if (quoted) setReplyTo(quoted);
        },
      },
    );
  }, [resolvedRoomId, isBlocked, user, sendMutation, msgsRefetch, queryClient, replyTo]);

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
    // queueUpload resolves this before presenting Send, but do not ever ask
    // the API for a presigned URL with an invalid content length.
    if (!Number.isFinite(target.size) || target.size <= 0) {
      setUploadError('Could not read the selected file. Please choose it again.');
      return;
    }

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
      if (target.ownedTempFile) deleteVoiceTempFile(target.uri);
      pendingUploadRef.current = null;
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

      let uploadUri = uri;
      let size = Number.isFinite(fileSize) && (fileSize ?? 0) > 0 ? fileSize! : 0;

      if (Platform.OS === 'web') {
        if (size <= 0) {
          const response = await fetch(uri);
          const blob = await response.blob();
          size = blob.size;
        }
      } else {
        const readSize = async (path: string): Promise<number> => {
          try {
            const info = await FileSystem.getInfoAsync(path);
            const resolvedSize = info.exists && 'size' in info ? Number((info as any).size) : 0;
            return Number.isFinite(resolvedSize) && resolvedSize > 0 ? resolvedSize : 0;
          } catch {
            return 0;
          }
        };

        // Android document and media providers commonly expose content://
        // URIs. createUploadTask cannot reliably read them, so materialise a
        // private cache copy and use that same path for preview and upload.
        if (!uri.startsWith('file://')) {
          const cacheDirectory = FileSystem.cacheDirectory;
          if (!cacheDirectory) throw new Error('Could not read the selected file.');
          const cachedName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${sanitiseFilename(name)}`;
          uploadUri = `${cacheDirectory}${cachedName}`;
          try {
            await FileSystem.copyAsync({ from: uri, to: uploadUri });
          } catch {
            throw new Error('Could not read the selected file.');
          }
          size = await readSize(uploadUri);
        } else if (size <= 0) {
          size = await readSize(uri);
          if (size <= 0) {
            const cacheDirectory = FileSystem.cacheDirectory;
            if (cacheDirectory) {
              uploadUri = `${cacheDirectory}${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${sanitiseFilename(name)}`;
              try {
                await FileSystem.copyAsync({ from: uri, to: uploadUri });
                size = await readSize(uploadUri);
              } catch {
                // Surface the single useful error below.
              }
            }
          }
        }
      }

      if (!Number.isFinite(size) || size <= 0) {
        throw new Error('Could not read the selected file.');
      }
      if (size > MAX_FILE_BYTES) {
        setUploadError(`File is too large (${formatBytes(size)}). Maximum is 50 MB.`);
        return;
      }

      setPendingUpload({
        uri: uploadUri,
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
        let selectedSize: number | null | undefined = (asset as any).fileSize ?? (asset as any).size;
        try {
          const info = await MediaLibrary.getAssetInfoAsync(asset.id);
          selectedUri = info.localUri ?? info.uri ?? asset.uri;
          selectedSize = (info as any).fileSize ?? (info as any).size ?? (asset as any).fileSize;
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
          selectedSize,
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

  // ── Voice recording handlers ─────────────────────────────────────────────

  const handleMicPress = useCallback(() => {
    if (!providerAvailable || !resolvedRoomId) return;
    if (uploadProgress !== null || isSendingUpload) return;
    void voice.start();
  }, [providerAvailable, resolvedRoomId, uploadProgress, isSendingUpload, voice]);

  const handleSendVoiceNote = useCallback(async () => {
    if (voiceSending) return;
    setVoiceSending(true);
    try {
      const recording = await voice.finish();
      if (!recording) return;
      const upload: PendingUpload = {
        uri: recording.uri,
        name: recording.name,
        size: recording.size,
        contentType: recording.contentType,
        clientRequestId: makeClientRequestId('voice'),
        durationMs: recording.durationMs,
        ownedTempFile: true,
      };
      setPendingUpload(upload);
      setUploadError(null);
      await handleSendUpload(upload);
    } finally {
      setVoiceSending(false);
    }
  }, [voice, voiceSending, handleSendUpload]);

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

  // ── Save a photo to the device gallery (image viewer download) ──────────
  const handleSaveToGallery = useCallback(async (message: ChatMessage) => {
    const extension = imageExtensionFor(message.body);
    if (Platform.OS === 'web') {
      await handleDownloadAttachment(message.roomId, message.id, `photo-${message.id}.${extension}`, token);
      return;
    }
    const current = await MediaLibrary.getPermissionsAsync(true);
    const permission = current.granted || !current.canAskAgain
      ? current
      : await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) {
      throw new Error('Allow photo access to save this image.');
    }
    const dest = `${FileSystem.cacheDirectory}chat_photo_${message.id}.${extension}`;
    const result = await FileSystem.downloadAsync(chatMediaUri(message.roomId, message.id), dest, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (result.status && result.status !== 200) {
      throw new Error(`Download failed (HTTP ${result.status})`);
    }
    try {
      await MediaLibrary.saveToLibraryAsync(result.uri);
    } finally {
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    }
  }, [handleDownloadAttachment, token]);

  // ── Selection / reply / forward / delete ────────────────────────────────
  const selectionMode = selectedIds.size > 0;
  const serverMessageById = useMemo(
    () => new Map(serverMessages.map((m) => [m.id, m])),
    [serverMessages],
  );
  const selectedMessages = useMemo(
    () => [...selectedIds].map((id) => serverMessageById.get(id)).filter((m): m is ChatMessage => !!m),
    [selectedIds, serverMessageById],
  );

  // Drop selections for rows that disappeared (deleted elsewhere / hidden).
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const alive = [...selectedIds].filter((id) => {
      const row = serverMessageById.get(id);
      return !!row && !row.deletedAt;
    });
    if (alive.length !== selectedIds.size) setSelectedIds(new Set(alive));
  }, [selectedIds, serverMessageById]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleLongPressMessage = useCallback((msg: ChatMessage) => {
    if (msg.id.startsWith('opt-') || msg.deletedAt) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(msg.id);
      return next;
    });
  }, []);

  const handleToggleSelect = useCallback((msg: ChatMessage) => {
    if (msg.id.startsWith('opt-') || msg.deletedAt) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(msg.id)) next.delete(msg.id);
      else next.add(msg.id);
      return next;
    });
  }, []);

  const senderLabelFor = useCallback(
    (senderId: string, senderName: string) => (senderId === user?.id ? 'You' : senderName),
    [user?.id],
  );

  const startReply = useCallback((msg: ChatMessage) => {
    if (msg.deletedAt) return;
    setReplyTo(msg);
    clearSelection();
    setViewerMessage(null);
    setTimeout(() => composerInputRef.current?.focus(), 50);
  }, [clearSelection]);

  const openForward = useCallback((messages: ChatMessage[]) => {
    const ids = messages.filter((m) => !m.deletedAt && !m.id.startsWith('opt-')).map((m) => m.id);
    if (!resolvedRoomId || ids.length === 0) return;
    clearSelection();
    setViewerMessage(null);
    router.push(
      `/(tabs)/customers/chat/forward?roomId=${encodeURIComponent(resolvedRoomId)}&messageIds=${encodeURIComponent(ids.join(','))}`,
    );
  }, [clearSelection, resolvedRoomId, router]);

  const deleteMutation = useChatMessagesDelete();
  const { confirm } = useConfirmDialog();

  const performDelete = useCallback(async (messages: ChatMessage[], scope: 'me' | 'everyone') => {
    if (!resolvedRoomId || messages.length === 0) return;
    const messageIds = messages.map((m) => m.id);
    try {
      const result = await deleteMutation.mutateAsync({
        roomId: resolvedRoomId,
        data: { messageIds, scope },
      });
      const deletedIds = new Set(result.deletedIds);
      const nowIso = new Date().toISOString();
      queryClient.setQueryData(
        getChatMessagesListQueryKey(resolvedRoomId),
        (previous: { messages: ChatMessage[] } | undefined) => {
          if (!previous) return previous;
          const messagesNext =
            scope === 'me'
              ? previous.messages.filter((m) => !deletedIds.has(m.id))
              : previous.messages.map((m) =>
                  deletedIds.has(m.id)
                    ? { ...m, deletedAt: nowIso, body: '', objectPath: undefined, durationMs: undefined, replyTo: undefined }
                    : m,
                );
          return { ...previous, messages: messagesNext };
        },
      );
      if (replyTo && deletedIds.has(replyTo.id)) setReplyTo(null);
      if (viewerMessage && deletedIds.has(viewerMessage.id)) setViewerMessage(null);
      clearSelection();
      void msgsRefetch();
      void queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() });
    } catch (err: any) {
      const code = err?.data?.code ?? err?.data?.error;
      const message =
        code === 'MATRIX_UNAVAILABLE' || code === 'MATRIX_REDACT_FAILED'
          ? 'Could not delete for everyone right now. Please try again.'
          : code === 'CHAT_DELETE_WINDOW_EXPIRED'
            ? 'Messages older than 24 hours can only be deleted for you.'
            : err?.data?.message ?? err?.message ?? 'Could not delete these messages.';
      // A batch can fail part-way (items redacted before the failure stay
      // deleted), so always resync rather than trusting the local rows.
      void msgsRefetch();
      Alert.alert('Delete failed', message);
    }
  }, [clearSelection, deleteMutation, msgsRefetch, queryClient, replyTo, resolvedRoomId, viewerMessage]);

  const confirmDelete = useCallback((messages: ChatMessage[]) => {
    const live = messages.filter((m) => !m.deletedAt && !m.id.startsWith('opt-'));
    if (live.length === 0) return;
    const allMine = live.every((m) => m.senderId === user?.id);
    // Mirrors the server rule: a sender can retract from everyone only within
    // 24 hours of sending; after that the only option left is "for me".
    const cutoff = Date.now() - DELETE_FOR_EVERYONE_WINDOW_MS;
    const allWithinWindow = live.every((m) => new Date(m.createdAt).getTime() >= cutoff);
    const count = live.length;
    const title = count === 1 ? 'Delete message?' : `Delete ${count} messages?`;
    const actions: ConfirmAction[] = [];
    if (allMine && allWithinWindow) {
      actions.push({
        label: 'Delete for everyone',
        description: 'Remove for all participants',
        tone: 'destructive',
        onPress: () => performDelete(live, 'everyone'),
      });
    }
    actions.push({
      label: 'Delete for me',
      description: 'Remove only from this device',
      tone: actions.length === 0 ? 'destructive' : 'neutral',
      onPress: () => performDelete(live, 'me'),
    });
    confirm({ title, actions });
  }, [confirm, performDelete, user?.id]);

  const openSelectionMenu = useCallback(() => {
    const options: Parameters<typeof Alert.alert>[2] = [];
    if (selectedMessages.length === 1 && selectedMessages[0].kind === 'image') {
      options.push({ text: 'Open photo', onPress: () => {
        setViewerMessage(selectedMessages[0]);
        clearSelection();
      } });
    }
    options.push({ text: 'Clear selection', onPress: clearSelection });
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(`${selectedMessages.length} selected`, undefined, options);
  }, [clearSelection, selectedMessages]);

  const openQuotedMessage = useCallback((quoteId: string) => {
    const original = serverMessageById.get(quoteId);
    if (!original || original.deletedAt) return;
    if (original.kind === 'image') setViewerMessage(original);
  }, [serverMessageById]);

  // Keep the viewer and reply target pointed at the freshest server row.
  // A row that vanished (deleted for me elsewhere) or was tombstoned closes
  // the viewer and drops the quote instead of lingering on stale data.
  const liveViewerMessage = viewerMessage ? serverMessageById.get(viewerMessage.id) ?? null : null;
  const viewerGone = !!viewerMessage && (!liveViewerMessage || !!liveViewerMessage.deletedAt);
  useEffect(() => {
    if (viewerGone) setViewerMessage(null);
  }, [viewerGone]);
  const replyTarget = replyTo ? serverMessageById.get(replyTo.id) : undefined;
  const replyGone = !!replyTo && (!replyTarget || !!replyTarget.deletedAt);
  useEffect(() => {
    if (replyGone) setReplyTo(null);
  }, [replyGone]);

  // ── Derived flags ───────────────────────────────────────────────────────
  const micEnabled =
    providerAvailable &&
    !isBlocked &&
    !!resolvedRoomId &&
    uploadProgress === null &&
    !isSendingUpload &&
    recordingPhase === 'idle' &&
    !pendingUpload;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* Header (selection mode swaps in the action bar) */}
      {selectionMode ? (
        <MessageSelectionHeader
          count={selectedIds.size}
          canReply={selectedMessages.length === 1}
          colors={colors}
          topPadding={topPadding}
          onClose={clearSelection}
          onReply={() => selectedMessages[0] && startReply(selectedMessages[0])}
          onDelete={() => confirmDelete(selectedMessages)}
          onForward={() => openForward(selectedMessages)}
          onMore={openSelectionMenu}
        />
      ) : (
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
      )}

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
            <AvarpusSpinner size={20} />
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
            <AvarpusSpinner size={20} />
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
            extraData={selectedIds}
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
                    selectable={!item.id.startsWith('opt-')}
                    selected={selectedIds.has(item.id)}
                    selectionMode={selectionMode}
                    onSelectStart={handleLongPressMessage}
                    onToggleSelect={handleToggleSelect}
                    onOpenImage={setViewerMessage}
                    onOpenQuote={openQuotedMessage}
                    quoteSenderLabel={
                      item.replyTo ? senderLabelFor(item.replyTo.senderId, item.replyTo.senderName) : undefined
                    }
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

      {/* Reply strip (quoted message above the composer) */}
      {!isRecording && replyTo && resolvedRoomId && (
        <ReplyComposerStrip
          message={replyTo}
          roomId={resolvedRoomId}
          token={token}
          colors={colors}
          senderLabel={senderLabelFor(replyTo.senderId, replyTo.senderName)}
          onClose={() => setReplyTo(null)}
          onPressQuote={replyTo.kind === 'image' ? () => setViewerMessage(replyTo) : undefined}
        />
      )}

      {/* Pending upload preview (file attachments + voice notes after stop) */}
      {!isRecording && pendingUpload && (
        <View
          style={[
            styles.attachmentPreview,
            pendingUpload.contentType.startsWith('image/') && styles.imageAttachmentPreview,
            { backgroundColor: colors.card, borderTopColor: colors.border },
          ]}
        >
          {pendingUpload.contentType.startsWith('image/') ? (
            <>
              <View style={[styles.attachmentImageFrame, { backgroundColor: colors.backgroundSecondary }]}>
                <Image
                  source={{ uri: pendingUpload.uri }}
                  contentFit="contain"
                  style={styles.attachmentImagePreviewImage}
                  accessibilityLabel={`Attachment preview: ${pendingUpload.name}`}
                />
              </View>
              <View style={styles.attachmentImageFooter}>
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
                    {formatBytes(pendingUpload.size)}
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
                      disabled={uploadProgress !== null || isSendingUpload}
                    >
                      <Feather name="send" size={15} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        clearPendingUpload();
                        setUploadError(null);
                      }}
                      style={styles.attachCancelBtn}
                      accessibilityLabel="Cancel attachment"
                      disabled={uploadProgress !== null || isSendingUpload}
                    >
                      <Feather name="x" size={18} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <AvarpusSpinner size={20} />
                )}
              </View>
            </>
          ) : (
            <>
              <View style={styles.attachmentIcon}>
                <Feather
                  name={pendingUpload.contentType.startsWith('audio/') ? 'mic' : 'file'}
                  size={18}
                  color={colors.primary}
                />
              </View>
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
                    disabled={uploadProgress !== null || isSendingUpload}
                  >
                    <Feather name="send" size={15} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      clearPendingUpload();
                      setUploadError(null);
                    }}
                    style={styles.attachCancelBtn}
                    accessibilityLabel="Cancel attachment"
                    disabled={uploadProgress !== null || isSendingUpload}
                  >
                    <Feather name="x" size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </>
              ) : (
                <AvarpusSpinner size={20} />
              )}
            </>
          )}
        </View>
      )}

      {/* Voice recorder panel replaces the composer while a note is in progress */}
      {isRecording && (
        <VoiceRecorderPanel
          recorder={voice.recorder}
          phase={voice.phase}
          committedMs={voice.committedMs}
          maxDurationMs={voice.maxDurationMs}
          previewUri={voice.previewUri}
          canResume={voice.canResume}
          isSending={voiceSending}
          colors={colors}
          bottomInset={isKeyboardVisible ? 6 : insets.bottom}
          onPause={() => void voice.pause()}
          onResume={() => void voice.resume()}
          onDiscard={() => void voice.discard()}
          onSend={() => void handleSendVoiceNote()}
        />
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
              ref={composerInputRef}
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
          <TouchableOpacity onPress={voice.clearPermissionDenied}>
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
          <TouchableOpacity onPress={voice.clearError}>
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
              clearPendingUpload();
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss upload error"
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

      {/* Full-screen photo viewer */}
      {resolvedRoomId && (
        <ImageViewer
          visible={!!liveViewerMessage}
          message={liveViewerMessage}
          roomId={resolvedRoomId}
          token={token}
          senderLabel={liveViewerMessage ? senderLabelFor(liveViewerMessage.senderId, liveViewerMessage.senderName) : ''}
          onClose={() => setViewerMessage(null)}
          onReply={(message, replyText) => sendTextValue(replyText, message)}
          onForward={(message) => openForward([message])}
          onDelete={(message) => confirmDelete([message])}
          onDownload={handleSaveToGallery}
        />
      )}
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
  deletedMsg: { fontSize: 12, fontStyle: 'italic', fontFamily: 'Inter_400Regular' },
  deletedBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
  },
  selectableRow: { position: 'relative' },
  forwardedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2, paddingHorizontal: 2 },
  forwardedText: { fontSize: 11, fontStyle: 'italic', fontFamily: 'Inter_400Regular' },
  quoteInBubble: { marginBottom: 4, minWidth: 160 },
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
  attachmentPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  imageAttachmentPreview: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  attachmentImageFrame: {
    width: '100%',
    maxWidth: 320,
    aspectRatio: 1,
    alignSelf: 'center',
    borderRadius: 6,
    overflow: 'hidden',
  },
  attachmentImagePreviewImage: { width: '100%', height: '100%' },
  attachmentImageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  attachmentIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
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
