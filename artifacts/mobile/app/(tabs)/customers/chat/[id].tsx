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
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
import { VideoViewer } from '@/components/chat/VideoViewer';
import {
  fileExtension,
  fileTypeVisual,
  isViewableImageMime,
  messageKindFor,
  receivedMimeType,
  resolveContentType,
} from '@/components/chat/attachments';
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
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { useColors } from '@/hooks/useColors';
import { useReachHoldOff } from '@/components/ui/ReachDown';
import { useDeviceContactNames } from '@/hooks/useDeviceContactNames';
import { useConfirmDialog, type ConfirmAction } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/context/AuthContext';
import { Avatar } from '@/components/ui/Avatar';
import { storage, KEYS } from '@/utils/storage';
import { dismissChatNotifications, setActiveChatRoom } from '@/utils/pushNotifications';
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
import { useChatStore } from '@/context/ChatStoreContext';
import { useLocalMessages, useLocalOutbox, useLocalRoom } from '@/hooks/useLocalChat';
import { localMediaPathOf, useChatMediaSource, type ChatMediaState } from '@/hooks/useChatMedia';
import { LOST_MEDIA_ACTION, LOST_MEDIA_TITLE, MediaPlaceholder, placeholderStateFor } from '@/components/chat/MediaPlaceholder';
import { discardOutboxMedia, finalizeSentMedia, keepSentMedia, mediaExtensionFor, relayAvailable } from '@/utils/chatMedia';
import { ChatSyncBanner } from '@/components/chat/ChatSyncBanner';
import { makeTextOutboxItem, outboxToMessage } from '@/utils/chatOutbox';
import type { ChatDeliveryStatus, OutboxItem } from '@/utils/chatStore';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB — matches the API's per-attachment cap
const MAX_RECORDING_MS = 10 * 60 * 1000; // 10 minutes
const DELETE_FOR_EVERYONE_WINDOW_MS = 24 * 60 * 60 * 1000; // sender may retract from everyone only within 24 hours

/** Optimistic (`opt-`) and outbox (`out-`) rows have no server id yet: not selectable/forwardable/deletable. */
function isLocalOnlyId(id: string): boolean {
  return id.startsWith('opt-') || id.startsWith('out-');
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp']);
/** Keep the original image extension when saving so the gallery classifies it correctly. */
function imageExtensionFor(filename: string | null | undefined): string {
  const ext = fileExtension(filename);
  return IMAGE_EXTENSIONS.has(ext) ? ext : 'jpg';
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

/**
 * Photo bubble. Renders the device copy when there is one; otherwise, in
 * device-owned mode, a download tile (auto downloads start on their own when
 * the policy allows), and only on web / without a store the relay stream.
 */
function ImageAttachment({
  msg,
  token,
  media,
}: {
  msg: ChatMessage;
  token: string | null;
  media: ChatMediaState;
}) {
  const { source, download, requestDownload } = media;
  if (source.kind === 'local' || source.kind === 'remote') {
    return (
      <Image
        source={source.kind === 'local' ? { uri: source.uri } : { uri: source.uri, headers: source.headers }}
        style={styles.imageAttachment}
        contentFit="cover"
        accessibilityLabel="Image attachment"
        testID={`image-attachment-${msg.id}`}
      />
    );
  }
  const state = placeholderStateFor(source, download);
  return (
    <MediaPlaceholder
      state={state}
      noun="photo"
      detail={state === 'failed' ? download?.error ?? null : msg.sizeBytes ? formatBytes(msg.sizeBytes) : 'Photo'}
      onPress={requestDownload}
      style={styles.imageAttachment}
      testID={`image-placeholder-${msg.id}`}
    />
  );
}

function FileAttachment({
  msg,
  token,
  colors,
  isMine,
  opening,
  onOpen,
  media,
}: {
  msg: ChatMessage;
  token: string | null;
  colors: any;
  isMine: boolean;
  opening: boolean;
  onOpen: (msg: ChatMessage, token: string | null) => void;
  media: ChatMediaState;
}) {
  const mime = receivedMimeType(msg);
  const visual = fileTypeVisual(mime, msg.body);
  const { source, download, requestDownload } = media;
  const unavailable = source.kind === 'unavailable';
  const pending = source.kind === 'pending';
  const failed = pending && download?.state === 'failed';
  const lost = pending && download?.state === 'lost';
  const downloading = pending && !!download && !failed && !lost;
  const meta = unavailable
    ? source.reason === 'expired'
      ? 'Expired before it was downloaded'
      : 'No longer available'
    : failed
      ? download?.error ?? 'Download failed. Tap to retry.'
      : lost
        ? `${LOST_MEDIA_TITLE} · ${LOST_MEDIA_ACTION}`
        : [visual.label, msg.sizeBytes ? formatBytes(msg.sizeBytes) : null].filter(Boolean).join(' · ');
  const handlePress = () => {
    if (unavailable || downloading) return;
    if (pending) requestDownload();
    else onOpen(msg, token);
  };
  return (
    <TouchableOpacity
      style={[styles.fileRow, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
      onPress={handlePress}
      disabled={opening || unavailable}
      accessibilityLabel={
        unavailable
          ? `${msg.body} is no longer available`
          : lost
            ? `${msg.body} is not on this phone any more. Save it again from the server`
            : pending
              ? `Download ${msg.body}`
              : `Open ${msg.body}`
      }
      testID={`file-attachment-${msg.id}`}
    >
      <View style={[styles.fileIconBadge, { backgroundColor: colors.primary + '1A' }]}>
        <Feather name={unavailable ? 'slash' : visual.icon} size={18} color={unavailable ? colors.mutedForeground : colors.primary} />
      </View>
      <View style={styles.fileRowCopy}>
        <Text
          style={[styles.fileRowName, { color: colors.foreground, fontFamily: fontFamily.medium }]}
          numberOfLines={2}
        >
          {msg.body}
        </Text>
        <Text
          style={[styles.fileRowMeta, { color: failed ? colors.destructive : colors.mutedForeground, fontFamily: fontFamily.regular }]}
          numberOfLines={2}
        >
          {meta}
        </Text>
      </View>
      {opening || downloading ? (
        <AvarpusSpinner size={16} />
      ) : unavailable ? null : (
        <Feather
          name={failed ? 'refresh-cw' : lost ? 'download-cloud' : pending ? 'download' : 'external-link'}
          size={16}
          color={isMine ? colors.primary : colors.mutedForeground}
        />
      )}
    </TouchableOpacity>
  );
}

/**
 * Video bubble: dark tile with a play badge once the clip is on the device
 * (or streamable in network-only mode); otherwise a download tile.
 */
function VideoAttachment({
  msg,
  onOpen,
  media,
}: {
  msg: ChatMessage;
  onOpen: (msg: ChatMessage) => void;
  media: ChatMediaState;
}) {
  const { source, download, requestDownload } = media;
  if (source.kind === 'pending' || source.kind === 'unavailable') {
    const state = placeholderStateFor(source, download);
    return (
      <MediaPlaceholder
        state={state}
        noun="video"
        detail={
          state === 'failed'
            ? download?.error ?? null
            : [msg.durationMs ? formatDuration(msg.durationMs) : null, msg.sizeBytes ? formatBytes(msg.sizeBytes) : 'Video']
                .filter(Boolean)
                .join(' · ')
        }
        onPress={requestDownload}
        style={styles.videoAttachment}
        testID={`video-placeholder-${msg.id}`}
      />
    );
  }
  return (
    <TouchableOpacity
      style={styles.videoAttachment}
      onPress={() => onOpen(msg)}
      accessibilityLabel={`Play video ${msg.body}`}
      testID={`video-attachment-${msg.id}`}
    >
      <View style={styles.videoPlayBadge}>
        <Feather name="play" size={size.headerIcon} color="#FFFFFF" />
      </View>
      <View style={styles.videoMetaRow}>
        <Feather name="video" size={12} color="#FFFFFF" />
        <Text style={styles.videoMetaText} numberOfLines={1}>
          {[msg.durationMs ? formatDuration(msg.durationMs) : null, msg.sizeBytes ? formatBytes(msg.sizeBytes) : 'Video']
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Voice note that is not on the device yet: same row shape as the player,
 * with the play button standing in for download / retry / unavailable.
 */
function AudioPendingRow({
  messageId,
  durationMs,
  colors,
  isMine,
  media,
}: {
  messageId: string;
  durationMs: number | undefined;
  colors: any;
  isMine: boolean;
  media: ChatMediaState;
}) {
  const { source, download, requestDownload } = media;
  const state = placeholderStateFor(source.kind === 'unavailable' ? source : { kind: 'pending' }, download);
  const gone = state === 'unavailable' || state === 'expired';
  const mutedColor = isMine ? 'rgba(255,255,255,0.65)' : colors.mutedForeground;
  const trackBg = isMine ? 'rgba(255,255,255,0.3)' : colors.border;
  const label =
    state === 'expired'
      ? 'Expired'
      : state === 'unavailable'
      ? 'No longer available'
      : state === 'failed'
        ? 'Tap to retry'
        : state === 'lost'
          ? LOST_MEDIA_ACTION
          : state === 'downloading'
            ? 'Downloading…'
            : durationMs
              ? formatDuration(durationMs)
              : 'Voice message';
  return (
    <TouchableOpacity
      onPress={state === 'download' || state === 'failed' || state === 'lost' ? requestDownload : undefined}
      disabled={gone || state === 'downloading'}
      style={styles.audioRow}
      accessibilityLabel={
        state === 'expired'
          ? 'Voice note expired before it was downloaded'
          : state === 'unavailable'
          ? 'Voice note no longer available'
          : state === 'lost'
            ? 'Voice note is not on this phone any more. Save it again from the server'
            : state === 'downloading'
              ? 'Downloading voice note'
              : 'Download voice note'
      }
      testID={`audio-attachment-${messageId}`}
    >
      <View style={[styles.audioPlayBtn, { backgroundColor: isMine ? 'rgba(255,255,255,0.25)' : colors.primary + '20' }]}>
        {state === 'downloading' ? (
          <AvarpusSpinner size={16} />
        ) : (
          <Feather
            name={
              state === 'unavailable'
                ? 'slash'
                : state === 'expired'
                  ? 'clock'
                  : state === 'failed'
                    ? 'refresh-cw'
                    : state === 'lost'
                      ? 'download-cloud'
                      : 'arrow-down'
            }
            size={18}
            color={isMine ? '#FFFFFF' : colors.primary}
          />
        )}
      </View>
      <View style={styles.audioTrackArea}>
        <View style={[styles.audioTrackBg, { backgroundColor: trackBg }]} />
        <Text style={[styles.audioDuration, { color: mutedColor }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/** Compact audio player bubble — WhatsApp-like. Plays from the device copy when there is one. */
function AudioAttachment({
  messageId,
  durationMs,
  source,
  colors,
  isMine,
}: {
  messageId: string;
  durationMs: number | undefined;
  source: { uri: string; headers?: Record<string, string> };
  colors: any;
  isMine: boolean;
}) {
  const player = useAudioPlayer(
    { uri: source.uri, headers: source.headers },
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
  onOpenFile,
  openingFile = false,
  selectable = true,
  selected = false,
  selectionMode = false,
  onSelectStart,
  onToggleSelect,
  onOpenImage,
  onOpenVideo,
  onOpenQuote,
  quoteSenderLabel,
}: {
  msg: ChatMessage;
  isMine: boolean;
  colors: any;
  token: string | null;
  onOpenFile: (msg: ChatMessage, token: string | null) => void;
  /** True while this file's bytes are being fetched for opening. */
  openingFile?: boolean;
  /** Optimistic (not yet persisted) rows cannot be selected. */
  selectable?: boolean;
  selected?: boolean;
  selectionMode?: boolean;
  /** Long-press entry into selection mode. */
  onSelectStart?: (msg: ChatMessage) => void;
  onToggleSelect?: (msg: ChatMessage) => void;
  onOpenImage?: (msg: ChatMessage) => void;
  onOpenVideo?: (msg: ChatMessage) => void;
  onOpenQuote?: (quoteId: string) => void;
  quoteSenderLabel?: string;
}) {
  const media = useChatMediaSource(msg, token);
  const holdOff = useReachHoldOff();
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
  const isVideo = msg.kind === 'video';
  const isFile = msg.kind === 'file';
  const isAudio = msg.kind === 'audio';
  const canSelect = selectable && !!onSelectStart;

  const handlePress = () => {
    if (selectionMode) {
      if (canSelect) onToggleSelect?.(msg);
      return;
    }
    if (media.source.kind === 'unavailable') return;
    if (media.source.kind === 'pending') {
      // Not on the device yet: a tap fetches it (or retries); a running
      // download is left alone. The viewer opens from disk afterwards.
      if (!media.download || media.download.state === 'failed') media.requestDownload();
      return;
    }
    if (isImage) onOpenImage?.(msg);
    else if (isVideo) onOpenVideo?.(msg);
  };

  const onPress = selectionMode || isImage || isVideo ? handlePress : undefined;

  // The long press that starts selecting lives on the bubble itself, not on the
  // whole row: a finger resting on the margin beside a bubble takes the page
  // for one-hand reach, like everywhere else. In selection mode the row around
  // the bubble still toggles it with a tap.
  return (
    <Pressable
      onPress={onPress}
      style={styles.selectableRow}
      accessibilityLabel={selected ? 'Selected message' : undefined}
      accessibilityState={selectionMode ? { selected } : undefined}
      testID={`message-row-${msg.id}`}
    >
      <View style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
        <Pressable
          onLongPress={canSelect ? () => onSelectStart?.(msg) : undefined}
          onPress={onPress}
          onPressIn={holdOff}
          delayLongPress={450}
          style={[
            styles.bubble,
            isMine
              ? [styles.bubbleMine, { backgroundColor: colors.primary }]
              : [styles.bubbleTheirs, { backgroundColor: colors.card, borderColor: colors.border }],
            (isImage || isVideo || isFile || isAudio) && styles.bubbleMedia,
          ]}
          testID={`message-bubble-${msg.id}`}
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
            <ImageAttachment msg={msg} token={token} media={media} />
          ) : isVideo ? (
            <VideoAttachment msg={msg} media={media} onOpen={(m) => (selectionMode ? handlePress() : onOpenVideo?.(m))} />
          ) : isFile ? (
            <FileAttachment
              msg={msg}
              token={token}
              colors={colors}
              isMine={isMine}
              opening={openingFile}
              media={media}
              onOpen={(m, t) => (selectionMode ? handlePress() : onOpenFile(m, t))}
            />
          ) : isAudio ? (
            media.source.kind === 'local' || media.source.kind === 'remote' ? (
              <AudioAttachment
                messageId={msg.id}
                durationMs={msg.durationMs}
                source={media.source}
                colors={colors}
                isMine={isMine}
              />
            ) : (
              <AudioPendingRow
                messageId={msg.id}
                durationMs={msg.durationMs}
                colors={colors}
                isMine={isMine}
                media={media}
              />
            )
          ) : (
            <Text
              style={[
                styles.bubbleText,
                { color: isMine ? colors.primaryForeground : colors.foreground, fontFamily: fontFamily.regular },
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
            {isMine && <DeliveryTicks msg={msg} colors={colors} />}
          </View>
        </Pressable>
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

/**
 * Per-message state for the viewer's own bubbles: queued (clock) while the
 * outbox holds it, a single tick once the server accepted it, double ticks
 * when the peer's device acknowledged delivery, and green double ticks once
 * the peer read it. Falls back to the server's own delivery field when the
 * row did not come through the local store.
 */
function DeliveryTicks({ msg, colors }: { msg: ChatMessage; colors: any }) {
  const status =
    (msg as ChatMessage & { localStatus?: ChatDeliveryStatus }).localStatus ??
    msg.delivery?.status ??
    'sent';
  const muted = 'rgba(255,255,255,0.72)';
  if (status === 'failed') {
    return (
      <Feather name="alert-circle" size={12} color={colors.destructive} testID={`delivery-${msg.id}`} accessibilityLabel="Failed" />
    );
  }
  if (status === 'queued' || status === 'sending') {
    return <Feather name="clock" size={11} color={muted} testID={`delivery-${msg.id}`} accessibilityLabel="Queued" />;
  }
  return (
    <Text
      style={[styles.deliveryTicks, { color: status === 'read' ? colors.success : muted }]}
      testID={`delivery-${msg.id}`}
      accessibilityLabel={status === 'read' ? 'Read' : status === 'delivered' ? 'Delivered' : 'Sent'}
    >
      {status === 'sent' ? '✓' : '✓✓'}
    </Text>
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
  /** Ids of recents the user has ticked; tapping toggles membership. */
  selectedRecentIds: ReadonlyMap<string, unknown>;
  onToggleRecent: (asset: MediaLibrary.Asset) => void;
  /** Send every ticked recent. Only rendered while at least one is ticked. */
  onSendSelectedRecents: () => void;
  onClearSelectedRecents: () => void;
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
  selectedRecentIds,
  onToggleRecent,
  onSendSelectedRecents,
  onClearSelectedRecents,
  onSelectContact,
}: AttachmentSheetProps) {
  const selectedCount = selectedRecentIds.size;
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
                { color: colors.foreground, fontFamily: fontFamily.bold },
              ]}
            >
              {contactsMode
                ? 'Choose contact'
                : selectedCount > 0
                ? `${selectedCount} selected`
                : expanded
                ? 'Recents'
                : 'Attach'}
            </Text>
            {!contactsMode && selectedCount > 0 ? (
              <TouchableOpacity
                onPress={onClearSelectedRecents}
                style={styles.attachmentSheetClose}
                accessibilityLabel="Clear selection"
              >
                <Text style={[styles.attachmentSeeAllText, { color: colors.primary }]}>Clear</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.attachmentSheetHeaderSpacer} />
            )}
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
                <Feather name="users" size={size.headerIcon} color={colors.mutedForeground} />
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
                          { color: colors.foreground, fontFamily: fontFamily.semibold },
                        ]}
                        numberOfLines={1}
                      >
                        {contact.name}
                      </Text>
                      {phone ? (
                        <Text
                          style={[
                            styles.contactPhone,
                            { color: colors.mutedForeground, fontFamily: fontFamily.regular },
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
                  { color: colors.foreground, fontFamily: fontFamily.semibold },
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
                <Feather name="image" size={size.headerIcon} color={colors.mutedForeground} />
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
                {recentAssets.map((asset) => {
                  const isSelected = selectedRecentIds.has(asset.id);
                  return (
                    <TouchableOpacity
                      key={asset.id}
                      onPress={() => onToggleRecent(asset)}
                      style={expanded ? styles.attachmentGridItem : styles.attachmentStripItem}
                      accessibilityLabel={`${isSelected ? 'Deselect' : 'Select'} ${asset.filename}`}
                      accessibilityState={{ selected: isSelected }}
                      testID={`attachment-recent-${asset.id}`}
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
                      {isSelected ? (
                        <View
                          pointerEvents="none"
                          style={[styles.attachmentSelectedOverlay, { borderColor: colors.primary }]}
                          testID={`attachment-recent-selected-${asset.id}`}
                        >
                          <View style={[styles.attachmentSelectedCheck, { backgroundColor: colors.primary }]}>
                            <Feather name="check" size={13} color="#FFFFFF" />
                          </View>
                        </View>
                      ) : (
                        <View pointerEvents="none" style={styles.attachmentSelectCircle} />
                      )}
                    </TouchableOpacity>
                  );
                })}
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
            {selectedCount > 0 ? (
              <TouchableOpacity
                onPress={onSendSelectedRecents}
                style={[styles.attachmentSendFab, { backgroundColor: colors.primary }]}
                accessibilityRole="button"
                accessibilityLabel={`Send ${selectedCount} selected`}
                testID="attachment-send-selected"
              >
                <Feather name="send" size={18} color="#FFFFFF" />
                <View style={styles.attachmentSendFabBadge}>
                  <Text style={[styles.attachmentSendFabBadgeText, { color: colors.primary }]}>{selectedCount}</Text>
                </View>
              </TouchableOpacity>
            ) : null}
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

  // ── Local store ─────────────────────────────────────────────────────────
  // With a device store open the conversation renders from local rows and
  // sends through the durable outbox; without one (store failed to open) it
  // falls back to the network queries and direct sends below.
  const {
    store: chatStore,
    engine: chatEngine,
    outbox: chatOutbox,
    ready: storeReady,
    status: syncStatus,
    requestSync,
    mediaFiles,
  } = useChatStore();
  const localFirst = !!chatStore;
  const networkOnly = storeReady && !localFirst;

  // ── Shared upload/send state (file attachments + voice notes) ──────────
  /**
   * Outgoing attachment queue. Items are sent strictly in order; the head is
   * the one currently previewed / uploading. A failure stops the queue with
   * the failed item still at the head so Retry resumes exactly there.
   */
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  // The ref is the single queue authority: every queue operation writes it
  // first and mirrors into state for rendering. It is never re-derived from
  // state, so an in-flight render cannot roll back an imperative update.
  const pendingUploadsRef = useRef<PendingUpload[]>([]);
  const queueUploadsRef = useRef<((items: PendingUpload[], options?: { sendNow?: boolean }) => void) | null>(null);
  const pendingUpload = pendingUploads[0] ?? null;
  /** Total size of the batch when it was queued, for "n of N" progress. */
  const [pendingBatchTotal, setPendingBatchTotal] = useState(0);
  /** Single exit for pending attachments: disposes app-owned temp files. */
  const clearPendingUpload = useCallback(() => {
    for (const item of pendingUploadsRef.current) {
      if (item.ownedTempFile) deleteVoiceTempFile(item.uri);
      void chatStore?.removeOutbox(item.clientRequestId);
      // The kept app-private copy has no message to belong to any more.
      if (chatStore) void discardOutboxMedia(chatStore, mediaFiles, item.clientRequestId).catch(() => {});
    }
    pendingUploadsRef.current = [];
    setPendingUploads([]);
    setPendingBatchTotal(0);
  }, [chatStore, mediaFiles]);
  const chatStoreRef = useRef(chatStore);
  chatStoreRef.current = chatStore;
  useEffect(() => {
    return () => {
      // With a store, the outbox row keeps the file until it is sent or
      // discarded (retry survives leaving the screen); without one the temp
      // file would leak, so dispose of it here.
      if (chatStoreRef.current) return;
      for (const item of pendingUploadsRef.current) {
        if (item.ownedTempFile) deleteVoiceTempFile(item.uri);
      }
    };
  }, []);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSendingUpload, setIsSendingUpload] = useState(false);
  /** Message id whose file bytes are currently being fetched for opening. */
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [videoMessage, setVideoMessage] = useState<ChatMessage | null>(null);
  /** Recents ticked in the attachment sheet, keyed by MediaLibrary asset id. */
  const [selectedRecents, setSelectedRecents] = useState<Map<string, MediaLibrary.Asset>>(new Map());

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
  // Local row renders the header instantly (and offline); the poll above
  // keeps presence fresh and its result is written back to the store.
  const localRoom = useLocalRoom(localFirst ? resolvedRoomId : null);
  const room = roomData?.room ?? localRoom.data ?? undefined;
  useEffect(() => {
    if (!roomData?.room || !chatEngine) return;
    void chatEngine.recordRoom(roomData.room);
  }, [chatEngine, roomData]);
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
      await chatStore?.setRoomPreference(resolvedRoomId, { isArchived: nextArchived });
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
  }, [chatStore, preferencesUpdate, queryClient, resolvedRoomId, room]);

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
      enabled: !!resolvedRoomId && providerAvailable && networkOnly,
      queryKey: getChatMessagesListQueryKey(resolvedRoomId ?? ''),
      refetchInterval: providerAvailable && networkOnly ? 4_000 : false,
    },
  });

  // Local-first timeline: rows come from the device store, the outbox
  // contributes queued/failed bubbles, and the sync engine keeps both fresh.
  const localTimeline = useLocalMessages(localFirst ? resolvedRoomId : null, providerAvailable);
  const localOutbox = useLocalOutbox(localFirst ? resolvedRoomId : null);
  useEffect(() => {
    if (!localFirst || !resolvedRoomId || !providerAvailable) return;
    void chatEngine?.ensureRoom(resolvedRoomId);
    void requestSync('conversation');
  }, [chatEngine, localFirst, providerAvailable, requestSync, resolvedRoomId]);

  const serverMessages = useMemo<ChatMessage[]>(
    () => (localFirst ? localTimeline.messages ?? [] : msgsData?.messages ?? []),
    [localFirst, localTimeline.messages, msgsData],
  );

  const outboxMessages = useMemo<ChatMessage[]>(() => {
    if (!localFirst || !localOutbox.data) return [];
    const viewer = { id: user?.id ?? 'me', name: user?.name ?? 'Me' };
    // Rows the on-screen attachment queue still owns render in its own bar.
    const owned = new Set(pendingUploads.map((item) => item.clientRequestId));
    return localOutbox.data
      .filter((item) => item.state !== 'pending_upload' && !owned.has(item.clientRequestId))
      .map((item) => outboxToMessage(item, viewer))
      .reverse();
  }, [localFirst, localOutbox.data, pendingUploads, user?.id, user?.name]);

  const timelineLoading = localFirst
    ? !storeReady || localTimeline.loading || ((localTimeline.messages?.length ?? 0) === 0 && localTimeline.loadingOlder)
    : !storeReady || msgsLoading;
  const timelineError = localFirst
    ? (localTimeline.messages?.length ?? 0) === 0 && !!syncStatus.error && syncStatus.online && !syncStatus.syncing
    : msgsError;

  const allMessages = useMemo(() => {
    const serverIds = new Set(serverMessages.map((m) => m.id));
    const serverRequestIds = new Set(serverMessages.map((m) => m.clientRequestId).filter(Boolean));
    const pending = optimisticMsgs.filter((m) => !serverIds.has(m.id));
    const queued = outboxMessages.filter((m) => !serverRequestIds.has(m.clientRequestId));
    return [...pending, ...queued, ...serverMessages];
  }, [serverMessages, optimisticMsgs, outboxMessages]);

  // ── Push suppression while this room is on screen ───────────────────────
  // A message push for the open conversation would duplicate what the list
  // already shows; the foreground handler checks this before presenting.
  useFocusEffect(
    useCallback(() => {
      setActiveChatRoom(resolvedRoomId ?? null);
      return () => setActiveChatRoom(null);
    }, [resolvedRoomId]),
  );

  // ── Mark read ───────────────────────────────────────────────────────────
  const markReadMutation = useChatMarkRead();
  useEffect(() => {
    if (!resolvedRoomId || serverMessages.length === 0) return;
    const newestIncoming = serverMessages.find((m) => m.senderId !== user?.id);
    if (!newestIncoming) return;
    markReadMutation.mutate({ roomId: resolvedRoomId, data: { messageId: newestIncoming.id } });
    // Mirror the read marker locally so the inbox badge clears at once, even
    // offline; the server's own marker replaces it on the next delta.
    if (chatStore && user?.id) {
      void chatStore.applyReadStates([
        {
          roomId: resolvedRoomId,
          userId: user.id,
          lastReadMessageId: newestIncoming.id,
          lastReadAt: new Date().toISOString(),
        },
      ]);
    }
    // Reading here clears the room's delivered notifications from the tray.
    void dismissChatNotifications(resolvedRoomId);
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

    if (chatStore && chatOutbox) {
      // Durable path: the outbox row is the optimistic bubble. It survives an
      // app restart and is flushed in order once the device is online.
      pendingSendRef.current = null;
      void chatStore
        .enqueueOutbox(
          makeTextOutboxItem({ clientRequestId, roomId: resolvedRoomId, body: trimmed, replyTo: quoted }),
        )
        .then(() => chatOutbox.flush())
        .catch(() => {
          setSendError('Message could not be queued.');
          setText(trimmed);
          if (quoted) setReplyTo(quoted);
        });
      return;
    }

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
  }, [resolvedRoomId, isBlocked, user, sendMutation, msgsRefetch, queryClient, replyTo, chatStore, chatOutbox]);

  // Failed outbox rows: retry re-queues in place; discard drops the row.
  const outboxItemFor = useCallback(
    (msg: ChatMessage): OutboxItem | null =>
      localOutbox.data?.find((item) => `out-${item.clientRequestId}` === msg.id) ?? null,
    [localOutbox.data],
  );

  const handleOutboxRetry = useCallback(
    (msg: ChatMessage) => {
      const item = outboxItemFor(msg);
      if (!item || !chatOutbox) return;
      if (item.kind !== 'text' && !item.objectPath) {
        // Upload never finished: hand it back to the attachment queue.
        if (!item.localUri) return;
        queueUploadsRef.current?.(
          [
            {
              uri: item.localUri,
              name: item.body,
              size: item.sizeBytes ?? 0,
              contentType: item.contentType ?? 'application/octet-stream',
              clientRequestId: item.clientRequestId,
              ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
              ...(item.ownedTempFile ? { ownedTempFile: true } : {}),
            },
          ],
          { sendNow: true },
        );
        return;
      }
      void chatOutbox.retry(item.clientRequestId);
    },
    [chatOutbox, outboxItemFor],
  );

  const handleOutboxDiscard = useCallback(
    (msg: ChatMessage) => {
      const item = outboxItemFor(msg);
      if (!item || !chatOutbox) return;
      void chatOutbox.discard(item.clientRequestId);
    },
    [chatOutbox, outboxItemFor],
  );

  const handleSend = useCallback(() => {
    sendTextValue(text);
  }, [sendTextValue, text]);

  // ── Upload URL mutation ─────────────────────────────────────────────────
  const uploadUrlMutation = useChatUploadUrl();

  // ── Shared upload → send ────────────────────────────────────────────────
  /** Upload one queued item (unless already uploaded) and send its message. */
  const uploadAndSendOne = useCallback(async (target: PendingUpload) => {
    if (!resolvedRoomId) throw new Error('Chat is not ready yet.');
    // queueUploads resolves this before presenting Send, but do not ever ask
    // the API for a presigned URL with an invalid content length.
    if (!Number.isFinite(target.size) || target.size <= 0) {
      throw new Error('Could not read the selected file. Please choose it again.');
    }
    setUploadProgress(target.uploadedObjectPath ? 1 : 0);

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
      const uploaded = objectPath;
      const persist = (items: PendingUpload[]) =>
        items.map((item) =>
          item.clientRequestId === target.clientRequestId ? { ...item, uploadedObjectPath: uploaded } : item,
        );
      pendingUploadsRef.current = persist(pendingUploadsRef.current);
      setPendingUploads(persist);
      // The upload is the unrecoverable part; once it is done the outbox row
      // holds everything needed to resend after a restart.
      await chatStore?.updateOutbox(target.clientRequestId, { objectPath: uploaded, state: 'sending' });
    }

    // 3) Send the chat message (no optimistic — wait for server)
    setIsSendingUpload(true);
    try {
      const kind = messageKindFor(target.contentType, target.durationMs !== undefined);
      const sent = await new Promise<ChatMessage | null>((resolve, reject) => {
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
          { onSuccess: (res) => resolve(res?.message ?? null), onError: reject },
        );
      });
      if (chatStore) {
        await chatStore.batch(async () => {
          if (sent) await chatStore.upsertMessages([sent]);
          await chatStore.removeOutbox(target.clientRequestId);
          // The kept original now belongs to the server message id.
          if (sent) await finalizeSentMedia(chatStore, target.clientRequestId, sent.id);
        });
      }
    } catch (err) {
      await chatStore?.updateOutbox(target.clientRequestId, {
        state: 'failed',
        lastError: (err as any)?.data?.message ?? (err as any)?.message ?? 'Failed to send.',
      });
      throw err;
    } finally {
      setIsSendingUpload(false);
    }

    // Done — drop this item from the queue
    if (target.ownedTempFile) deleteVoiceTempFile(target.uri);
    const remaining = pendingUploadsRef.current.filter(
      (item) => item.clientRequestId !== target.clientRequestId,
    );
    pendingUploadsRef.current = remaining;
    setPendingUploads(remaining);
    setUploadProgress(null);
  }, [resolvedRoomId, uploadUrlMutation, sendMutation, chatStore]);

  const sendingQueueRef = useRef(false);
  /**
   * Send the queue head-first. Stops at the first failure and leaves the
   * failed item (and everything behind it) queued so Retry resumes there.
   */
  const handleSendUpload = useCallback(async () => {
    if (sendingQueueRef.current || !resolvedRoomId) return;
    sendingQueueRef.current = true;
    setUploadError(null);
    let sentAny = false;
    try {
      while (pendingUploadsRef.current.length > 0) {
        const target = pendingUploadsRef.current[0];
        await uploadAndSendOne(target);
        sentAny = true;
        // Show each sent item as soon as it lands rather than after the batch.
        if (pendingUploadsRef.current.length > 0) msgsRefetch();
      }
      setPendingBatchTotal(0);
    } catch (err: any) {
      setUploadProgress(null);
      const message = err?.data?.message ?? err?.message ?? 'Failed to send. Tap Retry.';
      setUploadError(message);
      // Keep the durable copy honest: after leaving this screen the item
      // shows as a failed bubble with Retry/Discard instead of vanishing.
      const head = pendingUploadsRef.current[0];
      if (head) void chatStore?.updateOutbox(head.clientRequestId, { state: 'failed', lastError: message });
    } finally {
      sendingQueueRef.current = false;
    }
    if (sentAny) {
      if (!localFirst) msgsRefetch();
      void queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getChatRoomsGetQueryKey(resolvedRoomId) });
    }
  }, [resolvedRoomId, uploadAndSendOne, msgsRefetch, queryClient, chatStore, localFirst]);

  /** Append prepared items to the queue; optionally start sending at once. */
  const queueUploads = useCallback(
    (items: PendingUpload[], options?: { sendNow?: boolean }) => {
      if (items.length === 0) return;
      const next = [...pendingUploadsRef.current, ...items];
      pendingUploadsRef.current = next;
      setPendingUploads(next);
      setPendingBatchTotal((total) => Math.max(total, 0) + items.length);
      setUploadError(null);
      if (chatStore && resolvedRoomId) {
        // Durable metadata for each attachment so a retry survives a restart
        // (bytes still upload through this screen's flow).
        const now = new Date().toISOString();
        for (const item of items) {
          void chatStore.enqueueOutbox({
            clientRequestId: item.clientRequestId,
            roomId: resolvedRoomId,
            kind: messageKindFor(item.contentType, item.durationMs !== undefined),
            body: item.name,
            localUri: item.uri,
            contentType: item.contentType,
            sizeBytes: item.size,
            ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
            ...(item.ownedTempFile ? { ownedTempFile: true } : {}),
            ...(item.uploadedObjectPath ? { objectPath: item.uploadedObjectPath } : {}),
            state: 'pending_upload',
            attempts: 0,
            lastError: null,
            nextAttemptAt: now,
            createdAt: now,
          });
        }
      }
      if (options?.sendNow) void handleSendUpload();
    },
    [handleSendUpload, chatStore, resolvedRoomId],
  );
  queueUploadsRef.current = queueUploads;

  const attachEnabled =
    providerAvailable &&
    !isBlocked &&
    !!resolvedRoomId &&
    uploadProgress === null &&
    !isSendingUpload &&
    recordingPhase === 'idle';

  /**
   * Sender-side original: copy (or move, when the file is already ours) the
   * outgoing attachment into app-private storage and index it under the
   * outbox key. The upload reads from that copy, the bubble renders from it
   * straight away, and once the server accepts the message the row is
   * re-keyed to the server id — the sender never downloads its own media.
   * Falls back to the original URI when the copy fails.
   */
  const keepForSend = useCallback(
    async (upload: PendingUpload): Promise<PendingUpload> => {
      if (Platform.OS === 'web' || !chatStore || !mediaFiles || !resolvedRoomId) return upload;
      const kept = await keepSentMedia(chatStore, mediaFiles, {
        clientRequestId: upload.clientRequestId,
        roomId: resolvedRoomId,
        sourceUri: upload.uri,
        mimeType: upload.contentType,
        ext: mediaExtensionFor(upload.contentType, upload.name),
        move: !!upload.ownedTempFile,
      });
      if (!kept) return upload;
      const { ownedTempFile: _owned, ...rest } = upload;
      return { ...rest, uri: kept.localPath };
    },
    [chatStore, mediaFiles, resolvedRoomId],
  );

  // ── Attachment sheet and native pickers ──────────────────────────────────
  /**
   * Materialise a picked file into something createUploadTask can read and
   * verify its size. Never rejects a file for its type — the server accepts
   * any MIME and re-derives the real one from the stored bytes.
   */
  const prepareUpload = useCallback(
    async (
      uri: string,
      name: string,
      mimeType: string | null | undefined,
      fileSize?: number | null,
      mediaClass?: 'image' | 'video' | null,
    ): Promise<PendingUpload> => {
      const contentType = resolveContentType(mimeType, name, mediaClass);

      let uploadUri = uri;
      let ownedTempFile = false;
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
          if (!cacheDirectory) throw new Error(`Could not read ${name}.`);
          const cachedName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${sanitiseFilename(name)}`;
          uploadUri = `${cacheDirectory}${cachedName}`;
          try {
            await FileSystem.copyAsync({ from: uri, to: uploadUri });
            ownedTempFile = true;
          } catch {
            throw new Error(`Could not read ${name}.`);
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
                ownedTempFile = true;
                size = await readSize(uploadUri);
              } catch {
                // Surface the single useful error below.
              }
            }
          }
        }
      }

      if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
        if (ownedTempFile) deleteVoiceTempFile(uploadUri);
        throw new Error(
          size > MAX_FILE_BYTES
            ? `${name} is too large (${formatBytes(size)}). Maximum is 100 MB.`
            : `Could not read ${name}.`,
        );
      }

      return keepForSend({
        uri: uploadUri,
        name,
        size,
        contentType,
        clientRequestId: makeClientRequestId('attach'),
        ...(ownedTempFile ? { ownedTempFile: true } : {}),
      });
    },
    [keepForSend],
  );

  /** Prepare a batch; if any file cannot be read, nothing is queued. */
  const prepareAll = useCallback(
    async (
      picks: Array<{
        uri: string;
        name: string;
        mimeType?: string | null;
        size?: number | null;
        mediaClass?: 'image' | 'video' | null;
      }>,
    ): Promise<PendingUpload[] | null> => {
      const prepared: PendingUpload[] = [];
      try {
        for (const pick of picks) {
          prepared.push(await prepareUpload(pick.uri, pick.name, pick.mimeType, pick.size, pick.mediaClass));
        }
        return prepared;
      } catch (error: any) {
        for (const item of prepared) {
          if (item.ownedTempFile) deleteVoiceTempFile(item.uri);
          if (chatStore) void discardOutboxMedia(chatStore, mediaFiles, item.clientRequestId).catch(() => {});
        }
        setUploadError(error?.message ?? 'Could not read the selected file.');
        return null;
      }
    },
    [prepareUpload, chatStore, mediaFiles],
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
    setSelectedRecents(new Map());
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
    setSelectedRecents(new Map());
    setAttachmentSheetOpen(true);
    void loadRecentAssets();
  }, [attachEnabled, loadRecentAssets]);

  const handleGallery = useCallback(async () => {
    if (!attachEnabled) return;
    closeAttachmentSheet();
    try {
      // WhatsApp-style: the photo picker shows photos and videos only.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.9,
        allowsMultipleSelection: true,
        selectionLimit: 30,
        orderedSelection: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const prepared = await prepareAll(
        result.assets.map((asset) => {
          const isVideo = asset.type === 'video';
          return {
            uri: asset.uri,
            name: asset.fileName ?? `${isVideo ? 'video' : 'photo'}-${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`,
            mimeType: asset.mimeType,
            size: asset.fileSize,
            mediaClass: isVideo ? 'video' : 'image',
          } as const;
        }),
      );
      if (prepared) queueUploads(prepared);
    } catch (error: any) {
      setUploadError(error?.message ?? 'Could not open the photo gallery.');
    }
  }, [attachEnabled, closeAttachmentSheet, prepareAll, queueUploads]);

  const handlePickDocument = useCallback(async () => {
    if (!attachEnabled) return;
    closeAttachmentSheet();
    try {
      // Every file type is allowed here: photos, videos, PDFs, ZIP/RAR, APK…
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const prepared = await prepareAll(
        result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType,
          size: asset.size,
        })),
      );
      if (prepared) queueUploads(prepared);
    } catch (error: any) {
      setUploadError(error?.message ?? 'Could not open the document picker.');
    }
  }, [attachEnabled, closeAttachmentSheet, prepareAll, queueUploads]);

  /** Tapping a recent toggles its tick; nothing is sent until Send. */
  const handleToggleRecent = useCallback((asset: MediaLibrary.Asset) => {
    setSelectedRecents((current) => {
      const next = new Map(current);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.set(asset.id, asset);
      return next;
    });
  }, []);

  const handleClearSelectedRecents = useCallback(() => {
    setSelectedRecents(new Map());
  }, []);

  /** Resolve a MediaLibrary asset to a readable URI + size. */
  const resolveRecentAsset = useCallback(async (asset: MediaLibrary.Asset) => {
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
      if (!selectedUri) throw new Error(`Could not prepare ${asset.filename || 'that item'}.`);
    }
    const isVideo = asset.mediaType === 'video';
    const name = asset.filename || `${isVideo ? 'video' : 'photo'}-${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`;
    return {
      uri: selectedUri,
      name,
      mimeType: null,
      size: selectedSize,
      mediaClass: isVideo ? ('video' as const) : ('image' as const),
    };
  }, []);

  /** Send every ticked recent, in the order they were ticked. */
  const handleSendSelectedRecents = useCallback(async () => {
    if (!attachEnabled) return;
    const picked = Array.from(selectedRecents.values());
    closeAttachmentSheet();
    if (picked.length === 0) return;
    try {
      const resolved = [];
      for (const asset of picked) resolved.push(await resolveRecentAsset(asset));
      const prepared = await prepareAll(resolved);
      if (prepared) queueUploads(prepared, { sendNow: true });
    } catch (error: any) {
      setUploadError(error?.message ?? 'Could not prepare the selected items.');
    }
  }, [attachEnabled, selectedRecents, closeAttachmentSheet, resolveRecentAsset, prepareAll, queueUploads]);

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
      const upload: PendingUpload = await keepForSend({
        uri: recording.uri,
        name: recording.name,
        size: recording.size,
        contentType: recording.contentType,
        clientRequestId: makeClientRequestId('voice'),
        durationMs: recording.durationMs,
        ownedTempFile: true,
      });
      queueUploads([upload]);
      await handleSendUpload();
    } finally {
      setVoiceSending(false);
    }
  }, [voice, voiceSending, queueUploads, handleSendUpload, keepForSend]);

  // ── Download / open / share ─────────────────────────────────────────────
  /**
   * Bytes for save/share/open actions: the device copy when the message has
   * one (no network, works offline), otherwise a one-off fetch from the relay
   * into the cache while the server still holds it. `temp` tells the caller
   * whether the file is theirs to delete afterwards.
   */
  const materialiseMedia = useCallback(
    async (message: ChatMessage, dest: string, authToken: string | null): Promise<{ uri: string; temp: boolean }> => {
      const local = localMediaPathOf(message);
      if (local) {
        const info = await FileSystem.getInfoAsync(local).catch(() => ({ exists: false }));
        if (info.exists) return { uri: local, temp: false };
      }
      if (!relayAvailable(message)) throw new Error('This attachment is no longer available.');
      const result = await FileSystem.downloadAsync(chatMediaUri(message.roomId, message.id), dest, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (result.status && result.status !== 200) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
        throw new Error(`Download failed (HTTP ${result.status})`);
      }
      return { uri: result.uri, temp: true };
    },
    [],
  );

  /**
   * Fetch a file message's bytes to the private cache, then hand it to the
   * OS: Android opens it in the app registered for its type (PDF reader,
   * package installer, archive manager…); elsewhere the share sheet offers
   * the same choice.
   */
  const handleOpenFile = useCallback(
    async (message: ChatMessage, authToken: string | null) => {
      if (openingFileId) return;
      const mime = receivedMimeType(message);
      const safe = sanitiseFilename(message.body);
      const filename = fileExtension(safe) ? safe : `${safe}.${fileExtension(message.body) || 'bin'}`;
      setOpeningFileId(message.id);
      try {
        if (Platform.OS === 'web') {
          const resp = await fetch(chatMediaUri(message.roomId, message.id), {
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          });
          if (!resp.ok) throw new Error(`Download failed (HTTP ${resp.status})`);
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          return;
        }
        const dest = `${FileSystem.cacheDirectory}chat_media_${message.id}_${filename}`;
        const dlResult = await materialiseMedia(message, dest, authToken);
        if (Platform.OS === 'android') {
          try {
            const contentUri = await FileSystem.getContentUriAsync(dlResult.uri);
            await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
              data: contentUri,
              flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
              type: mime,
            });
            return;
          } catch {
            // No app handles this type — fall through to the share sheet so
            // the user can still save or pass it to another app.
          }
        }
        if (await Sharing.isAvailableAsync()) {
          try {
            await Sharing.shareAsync(dlResult.uri, { dialogTitle: message.body, mimeType: mime, UTI: undefined });
          } finally {
            // The share sheet has copied or handed off the bytes by now. (The
            // Android VIEW path above keeps its copy because the target app
            // may still be reading the content URI; its deterministic name
            // means a re-open overwrites rather than accumulates.) The
            // device's own copy is never deleted here.
            if (dlResult.temp) deleteVoiceTempFile(dlResult.uri);
          }
        } else {
          if (dlResult.temp) deleteVoiceTempFile(dlResult.uri);
          throw new Error('No app on this device can open this file.');
        }
      } catch (err: any) {
        setSendError(err?.message ?? 'Could not open attachment.');
      } finally {
        setOpeningFileId(null);
      }
    },
    [openingFileId, materialiseMedia],
  );

  const handleDownloadAttachment = useCallback(
    async (message: ChatMessage, filename: string, authToken: string | null) => {
      const { roomId, id: messageId } = message;
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
          const dlResult = await materialiseMedia(message, dest, authToken);
          const sharingAvailable = await Sharing.isAvailableAsync();
          if (sharingAvailable) {
            await Sharing.shareAsync(dlResult.uri, { dialogTitle: safe });
          }
        }
      } catch (err: any) {
        setSendError(err?.message ?? 'Could not download attachment.');
      }
    },
    [materialiseMedia],
  );

  // ── Save a photo to the device gallery (image viewer download) ──────────
  const handleSaveToGallery = useCallback(async (message: ChatMessage) => {
    const extension = imageExtensionFor(message.body);
    if (Platform.OS === 'web') {
      await handleDownloadAttachment(message, `photo-${message.id}.${extension}`, token);
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
    const result = await materialiseMedia(message, dest, token);
    try {
      await MediaLibrary.saveToLibraryAsync(result.uri);
    } finally {
      if (result.temp) await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    }
  }, [handleDownloadAttachment, materialiseMedia, token]);

  // ── Save a video to the device gallery (video viewer download) ──────────
  const handleSaveVideo = useCallback(async (message: ChatMessage) => {
    const extension = fileExtension(message.body) || 'mp4';
    if (Platform.OS === 'web') {
      await handleDownloadAttachment(message, `video-${message.id}.${extension}`, token);
      return;
    }
    const current = await MediaLibrary.getPermissionsAsync(true, ['video']);
    const permission = current.granted || !current.canAskAgain
      ? current
      : await MediaLibrary.requestPermissionsAsync(true, ['video']);
    if (!permission.granted) {
      throw new Error('Allow media access to save this video.');
    }
    const dest = `${FileSystem.cacheDirectory}chat_video_${message.id}.${extension}`;
    const result = await materialiseMedia(message, dest, token);
    try {
      await MediaLibrary.saveToLibraryAsync(result.uri);
    } finally {
      if (result.temp) await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    }
  }, [handleDownloadAttachment, materialiseMedia, token]);

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
    if (isLocalOnlyId(msg.id) || msg.deletedAt) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(msg.id);
      return next;
    });
  }, []);

  const handleToggleSelect = useCallback((msg: ChatMessage) => {
    if (isLocalOnlyId(msg.id) || msg.deletedAt) return;
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
    const ids = messages.filter((m) => !m.deletedAt && !isLocalOnlyId(m.id)).map((m) => m.id);
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
      if (chatStore) {
        // Local echo; the delta feed confirms it (hidden / tombstone rows).
        if (scope === 'me') await chatStore.hideMessages(result.deletedIds);
        else await chatStore.tombstoneMessages(result.deletedIds, nowIso);
      }
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
      if (localFirst) void requestSync('manual');
      else void msgsRefetch();
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
      if (localFirst) void requestSync('manual');
      else void msgsRefetch();
      Alert.alert('Delete failed', message);
    }
  }, [chatStore, clearSelection, deleteMutation, localFirst, msgsRefetch, queryClient, replyTo, requestSync, resolvedRoomId, viewerMessage]);

  const confirmDelete = useCallback((messages: ChatMessage[]) => {
    const live = messages.filter((m) => !m.deletedAt && !isLocalOnlyId(m.id));
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
  const liveVideoMessage = videoMessage ? serverMessageById.get(videoMessage.id) ?? null : null;
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
    pendingUploads.length === 0;

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
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <Avatar name={roomName} size={size.avatarSm} url={room?.profilePhoto} />
        <View style={styles.headerTitleContainer}>
          <Text
            style={[styles.headerTitle, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {roomName}
          </Text>
          {!!presenceText && (
            <View style={styles.presenceRow}>
              {room?.peerOnline && (
                <View style={[styles.presenceDot, { backgroundColor: colors.success }]} />
              )}
              <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
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
              `/(tabs)/customers/chat/call/${resolvedRoomId}?mode=audio&name=${encodeURIComponent(roomName)}${room?.profilePhoto ? `&photo=${encodeURIComponent(room.profilePhoto)}` : ''}`,
            )
          }
        >
          <Feather
            name="phone"
            size={size.headerIcon}
            color={callEnabled ? colors.primary : colors.mutedForeground}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.disabledHeaderAction, { opacity: callEnabled ? 1 : 0.4 }]}
          accessibilityLabel={callEnabled ? 'Start or join video call' : 'Video calls unavailable'}
          disabled={!callEnabled}
          onPress={() =>
            router.push(
              `/(tabs)/customers/chat/call/${resolvedRoomId}?mode=video&name=${encodeURIComponent(roomName)}${room?.profilePhoto ? `&photo=${encodeURIComponent(room.profilePhoto)}` : ''}`,
            )
          }
        >
          <Feather
            name="video"
            size={size.headerIcon}
            color={callEnabled ? colors.primary : colors.mutedForeground}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.disabledHeaderAction}
          accessibilityLabel="Open chat menu"
          onPress={openChatMenu}
        >
          <Feather name="more-vertical" size={size.headerIcon} color={colors.foreground} />
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
            <Text style={[styles.chatSafetyTitle, { color: colors.foreground, fontFamily: fontFamily.semibold }]}>
              Avarpus private conversation
            </Text>
            <Text style={[styles.chatSafetyText, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
              Communication only.
            </Text>
            <Text style={[styles.chatSafetyText, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
              End-to-end encryption is not enabled
            </Text>
          </View>
        </View>
      </View>

      {localFirst && providerAvailable && resolvedRoomId ? (
        <ChatSyncBanner
          status={syncStatus}
          hasLocalData={(localTimeline.messages?.length ?? 0) > 0}
          onRetry={() => void requestSync('manual')}
        />
      ) : null}

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
                  { color: colors.foreground, fontFamily: fontFamily.bold },
                ]}
              >
                Chat setup pending
              </Text>
              <Text
                style={[
                  styles.noticeText,
                  { color: colors.mutedForeground, fontFamily: fontFamily.regular },
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
                    { color: colors.mutedForeground, fontFamily: fontFamily.medium },
                  ]}
                >
                  Nothing is sent or stored from this screen.
                </Text>
              </View>
            </View>
          </View>
        ) : roomCreateError ? (
          <View style={styles.centeredState}>
            <Feather name="alert-circle" size={size.headerIcon} color={colors.destructive} />
            <Text
              style={[
                styles.noticeTitle,
                { color: colors.foreground, fontFamily: fontFamily.bold, marginTop: 12 },
              ]}
            >
              Could not open chat
            </Text>
            <Text
              style={[
                styles.noticeText,
                {
                  color: colors.mutedForeground,
                  fontFamily: fontFamily.regular,
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
              <Text style={{ color: '#fff', ...font.smallStrong }}>
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        ) : !resolvedRoomId || timelineLoading ? (
          <View style={styles.centeredState}>
            <AvarpusSpinner size={20} />
            <Text
              style={[
                styles.stateText,
                { color: colors.mutedForeground, fontFamily: fontFamily.regular },
              ]}
            >
              {!resolvedRoomId ? 'Opening chat room…' : 'Loading messages…'}
            </Text>
          </View>
        ) : timelineError ? (
          <View style={styles.centeredState}>
            <Feather name="alert-circle" size={size.headerIcon} color={colors.destructive} />
            <Text
              style={[
                styles.noticeTitle,
                { color: colors.foreground, fontFamily: fontFamily.bold, marginTop: 10 },
              ]}
            >
              Could not load messages
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: colors.primary }]}
              onPress={() => (localFirst ? void requestSync('manual') : msgsRefetch())}
            >
              <Text style={{ color: '#fff', ...font.smallStrong }}>
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
            onEndReachedThreshold={0.6}
            onEndReached={localFirst ? () => void localTimeline.loadOlder() : undefined}
            ListFooterComponent={
              localFirst && localTimeline.loadingOlder ? (
                <View style={styles.historyLoading}>
                  <AvarpusSpinner size={16} />
                </View>
              ) : null
            }
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
                    onOpenFile={handleOpenFile}
                    openingFile={openingFileId === item.id}
                    selectable={!isLocalOnlyId(item.id)}
                    selected={selectedIds.has(item.id)}
                    selectionMode={selectionMode}
                    onSelectStart={handleLongPressMessage}
                    onToggleSelect={handleToggleSelect}
                    onOpenImage={setViewerMessage}
                    onOpenVideo={setVideoMessage}
                    onOpenQuote={openQuotedMessage}
                    quoteSenderLabel={
                      item.replyTo ? senderLabelFor(item.replyTo.senderId, item.replyTo.senderName) : undefined
                    }
                  />
                  {item.id.startsWith('out-') &&
                    (item as ChatMessage & { localStatus?: ChatDeliveryStatus }).localStatus === 'failed' && (
                      <View style={styles.outboxActions} testID={`outbox-failed-${item.id}`}>
                        <Text style={[styles.outboxFailedText, { color: colors.destructive }]} numberOfLines={1}>
                          Not sent
                        </Text>
                        <TouchableOpacity
                          onPress={() => handleOutboxRetry(item)}
                          accessibilityRole="button"
                          accessibilityLabel="Retry sending"
                          hitSlop={8}
                        >
                          <Text style={[styles.outboxActionText, { color: colors.primary }]}>Retry</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleOutboxDiscard(item)}
                          accessibilityRole="button"
                          accessibilityLabel="Discard message"
                          hitSlop={8}
                        >
                          <Text style={[styles.outboxActionText, { color: colors.mutedForeground }]}>Discard</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  {showDateSeparator && <DateSeparator date={item.createdAt} colors={colors} />}
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.centeredState}>
                <Text
                  style={[
                    styles.stateText,
                    { color: colors.mutedForeground, fontFamily: fontFamily.regular },
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
      {!isRecording && pendingUpload && (() => {
        const busy = uploadProgress !== null || isSendingUpload;
        const isImagePreview = isViewableImageMime(pendingUpload.contentType);
        const isVideoPreview = pendingUpload.contentType.startsWith('video/');
        const visual = fileTypeVisual(pendingUpload.contentType, pendingUpload.name);
        const queuedCount = pendingUploads.length;
        const batchTotal = Math.max(pendingBatchTotal, queuedCount);
        const positionLabel =
          batchTotal > 1 ? `${batchTotal - queuedCount + 1} of ${batchTotal}` : null;
        const statusLabel =
          uploadProgress !== null && uploadProgress < 1
            ? `Uploading ${Math.round(uploadProgress * 100)}%`
            : isSendingUpload || uploadProgress !== null
            ? 'Sending…'
            : null;
        const metaLabel = [
          pendingUpload.durationMs ? formatDuration(pendingUpload.durationMs) : formatBytes(pendingUpload.size),
          !busy && queuedCount > 1 ? `${queuedCount} items` : null,
          busy && positionLabel ? `Sending ${positionLabel}` : null,
          statusLabel,
        ]
          .filter(Boolean)
          .join('  ·  ');
        const controls = !busy ? (
          <>
            <TouchableOpacity
              onPress={() => void handleSendUpload()}
              style={[styles.attachSendBtn, { backgroundColor: colors.primary }]}
              accessibilityLabel={queuedCount > 1 ? `Send ${queuedCount} attachments` : 'Send attachment'}
              testID="pending-upload-send"
            >
              <Feather name="send" size={15} color="#fff" />
              {queuedCount > 1 ? (
                <View style={styles.attachSendCount}>
                  <Text style={[styles.attachSendCountText, { color: colors.primary }]}>{queuedCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                clearPendingUpload();
                setUploadError(null);
              }}
              style={styles.attachCancelBtn}
              accessibilityLabel="Cancel attachment"
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </>
        ) : (
          <AvarpusSpinner size={20} />
        );
        const info = (
          <View style={styles.attachmentPreviewInfo}>
            <Text
              style={[styles.attachmentPreviewName, { color: colors.foreground, fontFamily: fontFamily.medium }]}
              numberOfLines={1}
            >
              {pendingUpload.name}
            </Text>
            <Text
              style={[styles.attachmentPreviewSize, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}
              numberOfLines={1}
              testID="pending-upload-meta"
            >
              {metaLabel}
            </Text>
          </View>
        );
        return (
          <View
            style={[
              styles.attachmentPreview,
              isImagePreview && styles.imageAttachmentPreview,
              { backgroundColor: colors.card, borderTopColor: colors.border },
            ]}
            testID="pending-upload-preview"
          >
            {isImagePreview ? (
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
                  {info}
                  {controls}
                </View>
              </>
            ) : (
              <>
                <View style={[styles.attachmentIcon, { backgroundColor: colors.primary + '1A' }]}>
                  <Feather
                    name={
                      pendingUpload.durationMs
                        ? 'mic'
                        : isVideoPreview
                        ? 'video'
                        : visual.icon
                    }
                    size={18}
                    color={colors.primary}
                  />
                </View>
                {info}
                {controls}
              </>
            )}
            {queuedCount > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.attachmentQueueRow}
                style={styles.attachmentQueueScroll}
              >
                {pendingUploads.slice(1).map((item) => {
                  const itemVisual = fileTypeVisual(item.contentType, item.name);
                  return (
                    <View
                      key={item.clientRequestId}
                      style={[styles.attachmentQueueChip, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                      testID={`pending-upload-queued-${item.clientRequestId}`}
                    >
                      {isViewableImageMime(item.contentType) ? (
                        <Image source={{ uri: item.uri }} style={styles.attachmentQueueThumb} contentFit="cover" />
                      ) : (
                        <Feather name={itemVisual.icon} size={13} color={colors.primary} />
                      )}
                      <Text
                        style={[styles.attachmentQueueName, { color: colors.foreground, fontFamily: fontFamily.regular }]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>
        );
      })()}

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
              style={[styles.input, { color: colors.foreground, fontFamily: fontFamily.regular }]}
              placeholder={providerAvailable ? 'Message…' : 'Messaging is not available yet'}
              placeholderTextColor={colors.placeholder}
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
                size={size.headerIcon}
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
                size={size.headerIcon}
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
              size={size.headerIcon}
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
            style={[styles.errorText, { color: colors.destructive, fontFamily: fontFamily.regular }]}
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
            style={[styles.errorText, { color: colors.destructive, fontFamily: fontFamily.regular }]}
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
              { color: colors.destructive, fontFamily: fontFamily.regular },
            ]}
            numberOfLines={2}
          >
            {uploadError}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setUploadError(null);
              if (pendingUploadsRef.current.length > 0) void handleSendUpload();
            }}
          >
            <Text
              style={{
                color: colors.destructive,
                ...font.smallStrong,
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
              { color: colors.destructive, fontFamily: fontFamily.regular },
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
        selectedRecentIds={selectedRecents}
        onToggleRecent={handleToggleRecent}
        onSendSelectedRecents={() => void handleSendSelectedRecents()}
        onClearSelectedRecents={handleClearSelectedRecents}
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

      {/* Full-screen video player */}
      {resolvedRoomId && (
        <VideoViewer
          visible={!!liveVideoMessage}
          message={liveVideoMessage}
          token={token}
          senderLabel={liveVideoMessage ? senderLabelFor(liveVideoMessage.senderId, liveVideoMessage.senderName) : ''}
          onClose={() => setVideoMessage(null)}
          onForward={(message) => {
            setVideoMessage(null);
            openForward([message]);
          }}
          onDownload={handleSaveVideo}
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
    minHeight: layout.headerHeight,
    paddingHorizontal: space.sm,
    borderBottomWidth: 1,
  },
  iconButton: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  headerTitleContainer: { flex: 1, paddingHorizontal: space.sm, justifyContent: 'center' },
  headerTitle: { ...font.itemTitle },
  presenceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  presenceDot: { width: 6, height: 6, borderRadius: 3 },
  headerSubtitle: { ...font.caption },
  disabledHeaderAction: {
    width: size.iconButton,
    height: size.iconButton,
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
  chatSafetyTitle: { ...font.smallStrong },
  chatSafetyText: { ...font.small, marginTop: 1 },
  chatBody: { flex: 1, overflow: 'hidden' },
  wallpaperBase: { ...StyleSheet.absoluteFill, opacity: 0.72 },
  wallpaperMotif: { position: 'absolute' },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.sm,
  },
  stateText: { ...font.small },
  noticeCard: {
    alignItems: 'center',
    padding: space.lg,
    borderRadius: radius.md,
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
  noticeTitle: { ...font.bodyStrong, marginBottom: 8 },
  noticeText: { ...font.small, textAlign: 'center' },
  safetyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  safetyText: { flexShrink: 1, ...font.small },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: space.xxl,
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
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    gap: 2,
  },
  bubbleMine: { borderBottomRightRadius: 4 },
  bubbleTheirs: { borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  bubbleMedia: { padding: 6 },
  bubbleText: { ...font.message },
  bubbleFooter: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 3, marginTop: 1 },
  bubbleTime: { ...font.small },
  deliveryTicks: { ...font.small, letterSpacing: -2 },
  historyLoading: { paddingVertical: 12, alignItems: 'center' },
  outboxActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  outboxFailedText: { ...font.smallStrong },
  outboxActionText: { ...font.smallStrong },
  dateSeparator: {
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  dateSeparatorText: { ...font.smallStrong },
  deletedMsg: { ...font.small, fontStyle: 'italic' },
  deletedBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
  },
  selectableRow: { position: 'relative' },
  forwardedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2, paddingHorizontal: 2 },
  forwardedText: { ...font.small, fontStyle: 'italic' },
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
  fileRowCopy: { flex: 1, minWidth: 0 },
  fileRowName: { ...font.smallStrong },
  fileRowMeta: { ...font.small, marginTop: 2 },
  fileIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoAttachment: {
    width: 220,
    height: 160,
    borderRadius: 10,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  videoPlayBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 4,
  },
  videoMetaRow: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  videoMetaText: { color: '#FFFFFF', ...font.smallStrong },
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
  audioDuration: { ...font.small },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: 1,
    gap: 10,
  },
  attachmentPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: space.lg,
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
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachSendCount: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachSendCountText: { ...font.badge },
  attachmentQueueScroll: { width: '100%', marginTop: 2 },
  attachmentQueueRow: { flexDirection: 'row', gap: 6, paddingRight: 8 },
  attachmentQueueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: 160,
  },
  attachmentQueueThumb: { width: 20, height: 20, borderRadius: 4 },
  attachmentQueueName: { ...font.small, flexShrink: 1 },
  attachmentPreviewInfo: { flex: 1 },
  attachmentPreviewName: { ...font.smallStrong },
  attachmentPreviewSize: { ...font.small, marginTop: 2 },
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
    borderRadius: size.input / 2,
    paddingHorizontal: 4,
    minHeight: size.input,
    borderWidth: 0,
  },
  inlineComposerAction: {
    width: size.iconButton,
    height: size.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    ...font.input,
    maxHeight: 120,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  actionCircle: {
    width: size.input,
    height: size.input,
    borderRadius: size.input / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  errorText: { flex: 1, ...font.small },
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
    minHeight: size.input,
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
    ...font.body,
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
  attachmentActionLabel: { ...font.smallStrong },
  attachmentRecentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: 9,
  },
  attachmentRecentTitle: { ...font.smallStrong },
  attachmentSeeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingLeft: 8,
  },
  attachmentSeeAllText: { ...font.smallStrong },
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
  attachmentPermissionText: { flex: 1, ...font.small },
  attachmentPermissionAction: { ...font.smallStrong },
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
  attachmentSelectedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  attachmentSelectedCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  attachmentSelectCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  attachmentSendFab: {
    position: 'absolute',
    right: layout.listInsetEnd,
    bottom: space.lg,
    width: size.fab,
    height: size.fab,
    borderRadius: size.fabRadius,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  attachmentSendFabBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentSendFabBadgeText: { ...font.badge },
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
    ...font.small,
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
    paddingHorizontal: space.xxl,
  },
  attachmentEmptyText: { ...font.small, textAlign: 'center' },
  attachmentEmptyButton: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  attachmentEmptyButtonText: { ...font.smallStrong },
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
  contactName: { ...font.smallStrong },
  contactPhone: { ...font.small, marginTop: 2 },
});
