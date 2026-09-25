import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

export default function CallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + space.lg, backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Calls</Text>
      </View>
      <View style={styles.empty}>
        <View style={[styles.icon, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Feather name="phone" size={size.fabIcon} color={colors.primary} />
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
  header: { minHeight: layout.headerHeight, paddingLeft: layout.titleInset, paddingRight: layout.screenPadding, justifyContent: 'center' },
  title: { ...font.display },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl },
  icon: { width: size.fab, height: size.fab, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
  emptyTitle: { ...font.heading, marginBottom: space.sm },
  emptyText: { ...font.body, textAlign: 'center', maxWidth: 300 },
});