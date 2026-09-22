import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

/** Centered spinner shown during the initial data fetch. */
export function DataLoadingState({ message = 'Loading shop data…' }: { message?: string }) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <AvarpusSpinner size={40} />
      <Text style={[styles.message, { color: colors.mutedForeground }]}>
        {message}
      </Text>
    </View>
  );
}

/** Friendly failure message with a Retry button. */
export function DataErrorState({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconCircle, { backgroundColor: colors.destructive + '15' }]}>
        <Feather name="wifi-off" size={26} color={colors.destructive} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>
        Couldn't load shop data
      </Text>
      <Text style={[styles.message, { color: colors.mutedForeground }]}>
        Please check your connection and try again.
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        activeOpacity={0.85}
        style={[styles.retryBtn, { backgroundColor: colors.primary }]}
      >
        <Feather name="refresh-cw" size={18} color="#FFFFFF" />
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Non-blocking banner shown when a refresh failed but stale data is still on
 * screen. Keeps content visible while making the failure and retry explicit.
 */
export function DataErrorBanner({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.banner, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '33' }]}>
      <Feather name="wifi-off" size={16} color={colors.destructive} />
      <Text style={[styles.bannerText, { color: colors.foreground }]} numberOfLines={2}>
        Couldn't refresh shop data. Showing last loaded data.
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        activeOpacity={0.85}
        style={[styles.bannerBtn, { backgroundColor: colors.destructive }]}
      >
        <Text style={styles.bannerBtnText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    marginHorizontal: layout.screenPadding, marginBottom: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderRadius: radius.md, borderWidth: 1,
  },
  bannerText: { flex: 1, ...font.captionStrong },
  bannerBtn: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.sm },
  bannerBtnText: { color: '#FFFFFF', ...font.smallStrong },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl, gap: space.md },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  title: font.heading,
  message: { ...font.caption, textAlign: 'center' },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: size.buttonSm, paddingHorizontal: space.xxl, borderRadius: radius.md, marginTop: space.sm },
  retryText: { color: '#FFFFFF', ...font.labelStrong },
});
