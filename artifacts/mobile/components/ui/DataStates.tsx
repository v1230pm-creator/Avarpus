import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/** Centered spinner shown during the initial data fetch. */
export function DataLoadingState({ message = 'Loading shop data…' }: { message?: string }) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.message, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
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
      <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
        Couldn't load shop data
      </Text>
      <Text style={[styles.message, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        Please check your connection and try again.
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        activeOpacity={0.85}
        style={[styles.retryBtn, { backgroundColor: colors.primary }]}
      >
        <Feather name="refresh-cw" size={16} color="#FFFFFF" />
        <Text style={[styles.retryText, { fontFamily: 'Inter_600SemiBold' }]}>Retry</Text>
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
      <Text style={[styles.bannerText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]} numberOfLines={2}>
        Couldn't refresh shop data. Showing last loaded data.
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        activeOpacity={0.85}
        style={[styles.bannerBtn, { backgroundColor: colors.destructive }]}
      >
        <Text style={[styles.bannerBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 12, lineHeight: 16 },
  bannerBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  bannerBtnText: { color: '#FFFFFF', fontSize: 12 },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontSize: 17 },
  message: { fontSize: 13, textAlign: 'center' },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  retryText: { color: '#FFFFFF', fontSize: 14 },
});
