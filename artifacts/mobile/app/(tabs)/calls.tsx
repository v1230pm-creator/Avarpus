import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export default function CallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Calls</Text>
      </View>
      <View style={styles.empty}>
        <View style={[styles.icon, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Feather name="phone" size={32} color={colors.primary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No recent calls</Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Voice and video calls with your Avarpus contacts will appear here.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 60, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  icon: { width: 80, height: 80, borderRadius: 40, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyTitle: { fontSize: 20, fontFamily: 'Inter_600SemiBold', marginBottom: 8 },
  emptyText: { fontSize: 14, lineHeight: 22, textAlign: 'center', maxWidth: 300, fontFamily: 'Inter_400Regular' },
});