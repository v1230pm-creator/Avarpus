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
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
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
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
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
            ? [styles.bubbleMine, { backgroundColor: colors.successLight }]
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
              { color: colors.foreground, fontFamily: 'Inter_400Regular' },
            ]}
          >
            {msg.body}
          </Text>
        )}

        <View style={styles.bubbleFooter}>
          <Text
            style={[
              styles.bubbleTime,
              { color: colors.mutedForeground },
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
  const colors = useColors();
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
  const [sendError, setSendError] = useState<string | null>(null);
  const [optimisticMsgs, setOptimisticMsgs] = useState<ChatMessage[]>([]);
  const clientRequestIdRef = useRef(makeClientRequestId('room'));
  const pendingSendRef = useRef<{ body: string; clientRequestId: string } | null>(null);

  // ── Shared upload/send state (file attachments + voice notes) ──────────
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSendingUpload, setIsSendingUpload] = useState(false);

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
    query: { enabled: !!resolvedRoomId, queryKey: getChatRoomsGetQueryKey(resolvedRoomId ?? '') },
  });
  const room = roomData?.room;
  const roomName = room?.name ?? name;
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
    if (room?.scope !== 'global_direct') {
      Alert.alert('Chat options', 'Avarpus chat is for communication only.');
      return;
    }
    const options: any[] = [
      { text: 'Report', onPress: openReportReasons },
    ];
    if (!isBlocked || blockedByMe) {
      options.push({
        text: blockedByMe ? 'Unblock' : 'Block',
        style: blockedByMe ? 'default' : 'destructive',
        onPress: toggleBlock,
      });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Chat options', undefined, options);
  }, [blockedByMe, isBlocked, openReportReasons, room?.scope, toggleBlock]);

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

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
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
        },
        onError: (err: any) => {
          setOptimisticMsgs((prev) => prev.filter((m) => m.id !== optimistic.id));
          setSendError(err?.data?.message ?? err?.message ?? 'Message failed to send.');
          setText(trimmed);
        },
      },
    );
  }, [text, resolvedRoomId, isBlocked, user, sendMutation, msgsRefetch]);

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
    } catch (err: any) {
      setUploadProgress(null);
      setIsSendingUpload(false);
      setUploadError(
        err?.data?.message ?? err?.message ?? 'Failed to send. Tap Retry.',
      );
    }
  }, [pendingUpload, resolvedRoomId, uploadUrlMutation, sendMutation, msgsRefetch]);

  // ── Pick file attachment ─────────────────────────────────────────────────
  const handlePickAttachment = useCallback(async () => {
    if (!providerAvailable || !resolvedRoomId) return;
    if (uploadProgress !== null || isSendingUpload || recordingPhase !== 'idle') return;

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

      // Resolve content type: never fall back to octet-stream
      const contentType = resolveContentType(asset.mimeType, asset.name);
      if (!contentType) {
        setUploadError(
          `Unsupported file type "${asset.mimeType ?? asset.name.split('.').pop()}". ` +
          'Allowed: images (JPEG/PNG/GIF/WebP/HEIC), video (MP4/MOV), PDF.',
        );
        return;
      }

      // Size — try asset.size first; fall back to FileSystem on native
      let size = asset.size;
      if ((size === undefined || size === null) && Platform.OS !== 'web') {
        const info = await FileSystem.getInfoAsync(asset.uri);
        size = info.exists && 'size' in info ? (info as any).size : 0;
      }
      size = size ?? 0;

      if (size > MAX_FILE_BYTES) {
        setUploadError(`File is too large (${formatBytes(size)}). Maximum is 50 MB.`);
        return;
      }

      setPendingUpload({
        uri: asset.uri,
        name: asset.name,
        size,
        contentType,
        clientRequestId: makeClientRequestId('attach'),
      });
      setUploadError(null);
    } catch {
      // User cancelled or picker error — silently ignore
    }
  }, [providerAvailable, resolvedRoomId, uploadProgress, isSendingUpload, recordingPhase]);

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
      await recorder.stop();

      // recorder.uri may be populated after stop()
      const uri = recorder.uri ?? (recorderState as any).url ?? null;
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
  const attachEnabled =
    providerAvailable &&
    !isBlocked &&
    !!resolvedRoomId &&
    uploadProgress === null &&
    !isSendingUpload &&
    recordingPhase === 'idle';

  const micEnabled =
    providerAvailable &&
    !isBlocked &&
    !!resolvedRoomId &&
    uploadProgress === null &&
    !isSendingUpload &&
    recordingPhase === 'idle' &&
    !pendingUpload;

  const isRecording = recordingPhase === 'recording';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPadding, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          onPress={handleBack}
          style={styles.iconButton}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Avatar name={roomName} size={38} />
        <View style={styles.headerTitleContainer}>
          <Text
            style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}
            numberOfLines={1}
          >
            {roomName}
          </Text>
          <View style={styles.presenceRow}>
            <View style={[styles.presenceDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.headerSubtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {room?.kind === 'dealer' || targetType === 'dealer' ? 'Dealer' : 'Customer'} · Active
            </Text>
          </View>
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
            size={20}
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
            size={20}
            color={callEnabled ? colors.primary : colors.mutedForeground}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.disabledHeaderAction}
          accessibilityLabel="Open chat menu"
          onPress={openChatMenu}
        >
          <Feather name="more-vertical" size={21} color={colors.foreground} />
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
            styles.recordingBar,
            { backgroundColor: colors.card, borderTopColor: colors.border },
          ]}
        >
          <View style={styles.recordingDot} />
          <Text
            style={[styles.recordingTimer, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}
            accessibilityLabel="Recording elapsed time"
          >
            {formatDuration(recorderState.durationMillis)}
          </Text>
          <Text style={[styles.recordingLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Recording…
          </Text>
          <View style={styles.recordingActions}>
            <TouchableOpacity
              onPress={handleCancelRecording}
              style={[styles.recordingBtn, { backgroundColor: colors.border }]}
              accessibilityLabel="Cancel recording"
            >
              <Text style={{ color: colors.foreground, fontFamily: 'Inter_500Medium', fontSize: 13 }}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleStopAndSendRecording}
              style={[styles.recordingBtn, { backgroundColor: colors.primary }]}
              accessibilityLabel="Stop and send recording"
            >
              <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>
                Stop · Send
              </Text>
            </TouchableOpacity>
          </View>
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
              paddingBottom: Math.max(insets.bottom, 16),
              backgroundColor: colors.card,
              borderTopColor: colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.inputContainer,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <TouchableOpacity
              style={styles.inlineComposerAction}
              accessibilityLabel="Open emoji and stickers"
              onPress={() => Alert.alert('Emoji and stickers', 'Sticker support will appear here when enabled.')}
            >
              <Feather name="smile" size={21} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TextInput
              style={[styles.input, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
              placeholder={providerAvailable ? 'Message…' : 'Messaging is not available yet'}
              placeholderTextColor={colors.mutedForeground}
              value={text}
              onChangeText={setText}
              editable={providerAvailable && !!resolvedRoomId && !isBlocked}
              multiline
              returnKeyType="send"
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              onPress={handlePickAttachment}
              disabled={!attachEnabled}
              style={[styles.inlineComposerAction, { opacity: attachEnabled ? 1 : 0.4 }]}
              accessibilityLabel={attachEnabled ? 'Add attachment' : 'Attachments not available'}
            >
              <Feather
                name="paperclip"
                size={20}
                color={attachEnabled ? colors.mutedForeground : colors.textDisabled ?? colors.mutedForeground}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handlePickAttachment}
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
              styles.sendBtn,
              {
                backgroundColor:
                  text.trim() && resolvedRoomId && providerAvailable && !isBlocked
                    ? colors.primary
                    : micEnabled
                    ? colors.success
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
              size={19}
              color={text.trim() || micEnabled ? colors.primaryForeground : colors.mutedForeground}
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
  wallpaperBase: { ...StyleSheet.absoluteFillObject, opacity: 0.72 },
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
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingTop: 7,
    paddingBottom: 5,
    gap: 2,
  },
  bubbleMine: { borderTopRightRadius: 3 },
  bubbleTheirs: { borderTopLeftRadius: 3, borderWidth: StyleSheet.hairlineWidth },
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
    paddingHorizontal: 10,
    paddingTop: 8,
    gap: 8,
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    paddingHorizontal: 4,
    minHeight: 44,
    borderWidth: 1,
  },
  inlineComposerAction: {
    width: 32,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontSize: 14,
    maxHeight: 120,
    paddingVertical: 8,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
});
