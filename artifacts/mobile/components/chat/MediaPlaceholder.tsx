import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { font } from '@/constants/typography';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import type { MediaDownloadStatus } from '@/utils/chatMedia';

/**
 * `lost`: this device had a copy that is now missing or damaged while the
 * server still holds the bytes — the tile offers to save it again.
 */
export type MediaPlaceholderState = 'unavailable' | 'expired' | 'download' | 'downloading' | 'failed' | 'lost';

export function placeholderStateFor(
  source: { kind: 'pending' } | { kind: 'unavailable'; reason: 'purged' | 'expired' },
  download: MediaDownloadStatus | undefined,
): MediaPlaceholderState {
  if (source.kind === 'unavailable') return source.reason === 'expired' ? 'expired' : 'unavailable';
  if (download?.state === 'failed') return 'failed';
  if (download?.state === 'lost') return 'lost';
  if (download) return 'downloading';
  return 'download';
}

/** Copy for a bubble whose saved copy went missing while the server still has it. */
export const LOST_MEDIA_TITLE = 'Not on this phone any more';
export const LOST_MEDIA_ACTION = 'Save again from server';

interface MediaPlaceholderProps {
  state: MediaPlaceholderState;
  /** Shown under the icon: file size, duration, or the failure reason. */
  detail?: string | null;
  /** What the media is, for the unavailable copy and accessibility ("photo", "video"). */
  noun: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Tile shown in place of a photo or video that is not on the device: a
 * download affordance, a real in-flight download, a retryable failure, or —
 * once the server has dropped its relay copy — an explicit "no longer
 * available" notice (or "expired" when nobody downloaded it in time). Never a
 * broken image, never a spinner with nothing behind it.
 */
export function unavailableCaption(state: MediaPlaceholderState, noun: string): string {
  return state === 'expired'
    ? `This ${noun} expired before it was downloaded`
    : `This ${noun} is no longer available`;
}
export function MediaPlaceholder({ state, detail, noun, onPress, style, testID }: MediaPlaceholderProps) {
  const interactive = state === 'download' || state === 'failed' || state === 'lost';
  const gone = state === 'unavailable' || state === 'expired';
  const label =
    gone
      ? unavailableCaption(state, noun)
      : state === 'downloading'
        ? `Downloading ${noun}`
        : state === 'failed'
          ? `Download failed. Tap to retry`
          : state === 'lost'
            ? `This ${noun} is not on this phone any more. Tap to save it again from the server`
            : `Tap to download ${noun}`;
  return (
    <TouchableOpacity
      style={[styles.tile, style]}
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityLabel={label}
      testID={testID}
    >
      {state === 'downloading' ? (
        <View style={styles.badge}>
          <AvarpusSpinner size={22} />
        </View>
      ) : (
        <View style={[styles.badge, gone && styles.badgeMuted]}>
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
            size={22}
            color="#FFFFFF"
          />
        </View>
      )}
      <Text style={styles.caption} numberOfLines={2}>
        {state === 'unavailable'
          ? 'No longer available'
          : state === 'expired'
            ? 'Expired'
            : state === 'failed'
              ? 'Tap to retry'
              : state === 'lost'
                ? LOST_MEDIA_ACTION
                : detail || ''}
      </Text>
      {state === 'failed' && detail ? (
        <Text style={styles.error} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
      {state === 'lost' ? (
        <Text style={styles.error} numberOfLines={2}>
          {LOST_MEDIA_TITLE}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 220,
    height: 160,
    borderRadius: 12,
    backgroundColor: '#1F2933',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeMuted: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  caption: {
    color: '#FFFFFF',
    ...font.smallStrong,
    textAlign: 'center',
  },
  error: {
    color: 'rgba(255,255,255,0.7)',
    ...font.small,
    textAlign: 'center',
  },
});
