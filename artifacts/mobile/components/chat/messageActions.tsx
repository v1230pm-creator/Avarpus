import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { getChatMessageMediaUrl } from '@workspace/api-client-react';
import type { ChatMessage, ChatMessageQuote } from '@workspace/api-client-react';
import { AVARPUS_BLUE } from '@/constants/brand';
import { font } from '@/constants/typography';
import { useMediaThumbnailSource } from '@/hooks/useChatMedia';

/**
 * Translucent brand-blue wash laid over a selected message. Deliberately the
 * splash/brand blue rather than the theme primary so selection reads the same
 * in light and dark chat themes.
 */
export const SELECTION_OVERLAY_COLOR = 'rgba(0, 109, 168, 0.28)';
export const SELECTION_ACCENT = AVARPUS_BLUE;

export type MessageActionColors = {
  background: string;
  card: string;
  border: string;
  foreground: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  backgroundSecondary: string;
  destructive: string;
  success: string;
};

export type QuoteLike = Pick<ChatMessageQuote, 'id' | 'senderId' | 'senderName' | 'kind' | 'body' | 'deleted'>;

/** Absolute media URL for a chat message (auth header supplied by the caller). */
export function chatMediaUri(roomId: string, messageId: string): string {
  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
  return `${baseUrl}${getChatMessageMediaUrl(roomId, messageId)}`;
}

/** Short, WhatsApp-style description of a message for quotes and previews. */
export function describeMessage(kind: string, body: string): string {
  switch (kind) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Voice message';
    case 'file':
      return body || 'File';
    default:
      return body;
  }
}

export function quoteFromMessage(message: ChatMessage): QuoteLike {
  return {
    id: message.id,
    senderId: message.senderId,
    senderName: message.senderName,
    kind: message.kind,
    body: message.body,
    deleted: !!message.deletedAt,
  };
}

/** "43 minutes ago" style label for the image viewer header. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Quoted message block ───────────────────────────────────────────────────

export function QuotedMessage({
  quote,
  roomId,
  token,
  colors,
  senderLabel,
  onPress,
  onDark,
  testID,
}: {
  quote: QuoteLike;
  roomId: string;
  token: string | null;
  colors: MessageActionColors;
  /** Display name for the quoted sender ("You" for the viewer's own). */
  senderLabel: string;
  onPress?: () => void;
  /** Rendered inside the viewer's own (blue) bubble. */
  onDark?: boolean;
  testID?: string;
}) {
  const showThumb = quote.kind === 'image' && !quote.deleted;
  // Quoted photo thumbnail: device copy first; the relay only outside
  // device-owned mode so a quote never bypasses the auto-download rules.
  const thumbSource = useMediaThumbnailSource(
    showThumb ? { id: quote.id, roomId } : null,
    token,
  );
  const bodyText = quote.deleted ? 'Message deleted' : describeMessage(quote.kind, quote.body);
  const surface = onDark ? 'rgba(255,255,255,0.16)' : colors.backgroundSecondary;
  const nameColor = onDark ? '#FFFFFF' : SELECTION_ACCENT;
  const textColor = onDark ? 'rgba(255,255,255,0.85)' : colors.mutedForeground;

  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.7 : 1}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.quote, { backgroundColor: surface }]}
      accessibilityLabel={`Quoted ${bodyText} from ${senderLabel}`}
      testID={testID}
    >
      <View style={[styles.quoteBar, { backgroundColor: onDark ? '#FFFFFF' : SELECTION_ACCENT }]} />
      <View style={styles.quoteBody}>
        <Text style={[styles.quoteName, { color: nameColor }]} numberOfLines={1}>
          {senderLabel}
        </Text>
        <View style={styles.quoteLine}>
          {quote.kind === 'image' && !quote.deleted && (
            <Feather name="camera" size={12} color={textColor} />
          )}
          {quote.kind === 'video' && !quote.deleted && (
            <Feather name="video" size={12} color={textColor} />
          )}
          {quote.kind === 'audio' && !quote.deleted && (
            <Feather name="mic" size={12} color={textColor} />
          )}
          {quote.kind === 'file' && !quote.deleted && (
            <Feather name="file" size={12} color={textColor} />
          )}
          <Text style={[styles.quoteText, { color: textColor }, quote.deleted && styles.quoteDeleted]} numberOfLines={2}>
            {bodyText}
          </Text>
        </View>
      </View>
      {showThumb && thumbSource && (
        <Image
          source={thumbSource}
          style={styles.quoteThumb}
          contentFit="cover"
          accessibilityLabel="Quoted photo"
        />
      )}
    </TouchableOpacity>
  );
}

// ── Reply strip above the composer ─────────────────────────────────────────

export function ReplyComposerStrip({
  message,
  roomId,
  token,
  colors,
  senderLabel,
  onClose,
  onPressQuote,
}: {
  message: ChatMessage;
  roomId: string;
  token: string | null;
  colors: MessageActionColors;
  senderLabel: string;
  onClose: () => void;
  onPressQuote?: () => void;
}) {
  return (
    <View
      style={[styles.replyStrip, { backgroundColor: colors.card, borderTopColor: colors.border }]}
      testID="reply-composer-strip"
    >
      <View style={styles.replyStripQuote}>
        <QuotedMessage
          quote={quoteFromMessage(message)}
          roomId={roomId}
          token={token}
          colors={colors}
          senderLabel={senderLabel}
          onPress={onPressQuote}
          testID="reply-strip-quote"
        />
      </View>
      <TouchableOpacity
        onPress={onClose}
        style={styles.replyClose}
        accessibilityLabel="Cancel reply"
        testID="reply-strip-close"
      >
        <Feather name="x" size={18} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}

// ── Selection-mode header ──────────────────────────────────────────────────

export function MessageSelectionHeader({
  count,
  canReply,
  colors,
  topPadding,
  onClose,
  onReply,
  onDelete,
  onForward,
  onMore,
}: {
  count: number;
  canReply: boolean;
  colors: MessageActionColors;
  topPadding: number;
  onClose: () => void;
  onReply: () => void;
  onDelete: () => void;
  onForward: () => void;
  onMore: () => void;
}) {
  return (
    <View
      style={[
        styles.selectionHeader,
        { paddingTop: topPadding, backgroundColor: colors.card, borderBottomColor: colors.border },
      ]}
      testID="message-selection-header"
    >
      <TouchableOpacity onPress={onClose} style={styles.selectionIcon} accessibilityLabel="Clear selection">
        <Feather name="arrow-left" size={20} color={colors.foreground} />
      </TouchableOpacity>
      <Text style={[styles.selectionCount, { color: colors.foreground }]} testID="message-selection-count">
        {count}
      </Text>
      {canReply && (
        <TouchableOpacity onPress={onReply} style={styles.selectionIcon} accessibilityLabel="Reply" testID="selection-reply">
          <MaterialCommunityIcons name="reply" size={22} color={colors.foreground} />
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={onDelete} style={styles.selectionIcon} accessibilityLabel="Delete" testID="selection-delete">
        <Feather name="trash-2" size={20} color={colors.foreground} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onForward} style={styles.selectionIcon} accessibilityLabel="Forward" testID="selection-forward">
        <MaterialCommunityIcons name="share-all" size={22} color={colors.foreground} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onMore} style={styles.selectionIcon} accessibilityLabel="More options" testID="selection-more">
        <Feather name="more-vertical" size={20} color={colors.foreground} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  quote: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 8,
    overflow: 'hidden',
    minHeight: 44,
  },
  quoteBar: { width: 4 },
  quoteBody: { flex: 1, paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center' },
  quoteName: { ...font.smallStrong, marginBottom: 2 },
  quoteLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  quoteText: { ...font.small, flexShrink: 1 },
  quoteDeleted: { fontStyle: 'italic' },
  quoteThumb: { width: 48, height: 48, backgroundColor: '#222' },
  replyStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  replyStripQuote: { flex: 1 },
  replyClose: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  selectionIcon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  selectionCount: { flex: 1, ...font.itemTitle, paddingHorizontal: 8 },
});
