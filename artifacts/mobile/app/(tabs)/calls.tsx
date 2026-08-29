import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export default function CallsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Calls</Text>
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/more')}
          style={[styles.headerAction, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityLabel="Open menu"
        >
          <Feather name="menu" size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>
      <View style={styles.empty}>
        <View style={[styles.iconWrap, { backgroundColor: colors.accent, borderColor: colors.primary + '44' }]}>
          <Feather name="phone-call" size={28} color={colors.primary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          Secure calls
        </Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Start voice or video calls from an existing Avarpus conversation.
        </Text>
        <TouchableOpacity
          onPress={() => router.navigate('/(tabs)')}
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
        >
          <Feather name="message-circle" size={17} color={colors.primaryForeground} />
          <Text style={[styles.primaryButtonText, { fontFamily: 'Inter_600SemiBold' }]}>Open Chats</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 92,
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 24 },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 18, marginTop: 18 },
  emptyText: { fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 290, marginTop: 8 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 22,
    borderRadius: 13,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13 },
});