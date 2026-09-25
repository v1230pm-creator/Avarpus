import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { ChatSyncStatus } from '@/utils/chatSync';
import { font } from '@/constants/typography';
import { layout, space } from '@/constants/spacing';

/**
 * Subtle strip under a chat header describing the local-first state: the
 * device is offline (showing saved chats), a refresh is in progress on first
 * load, or the last refresh failed. Renders nothing when everything is fine.
 */
export function ChatSyncBanner({
  status,
  onRetry,
  hasLocalData,
}: {
  status: ChatSyncStatus;
  onRetry?: () => void;
  /** Rooms/messages are already on screen from the store. */
  hasLocalData: boolean;
}) {
  const colors = useColors();
  let text: string | null = null;
  let icon: React.ComponentProps<typeof Feather>['name'] = 'wifi-off';
  let retry = false;
  if (!status.online) {
    text = hasLocalData ? 'Offline — showing saved chats' : 'Offline — nothing saved yet';
  } else if (status.error) {
    text = 'Could not refresh';
    icon = 'alert-circle';
    retry = true;
  } else if (status.syncing && !status.bootstrapped) {
    text = 'Syncing…';
    icon = 'refresh-cw';
  }
  if (!text) return null;
  return (
    <View
      style={[styles.bar, { backgroundColor: colors.muted }]}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      testID="chat-sync-banner"
    >
      <Feather name={icon} size={13} color={colors.mutedForeground} />
      <Text style={[styles.text, { color: colors.mutedForeground }]} numberOfLines={1}>
        {text}
      </Text>
      {retry && onRetry ? (
        <TouchableOpacity onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry sync">
          <Text style={[styles.retry, { color: colors.primary }]}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.sm,
  },
  text: { flex: 1, ...font.captionStrong },
  retry: { ...font.labelStrong },
});
