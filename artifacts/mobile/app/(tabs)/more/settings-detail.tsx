import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

export default function SettingsDetailScreen() {
  const params = useLocalSearchParams();
  const title = (params.title as string) || 'Settings';
  const description = (params.description as string) || 'This feature is currently under development.';
  
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
        <View style={styles.headerRight} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + '15' }]}>
          <Feather name="tool" size={40} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.desc, { color: colors.mutedForeground }]}>{description}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: layout.screenPadding,
    minHeight: layout.headerHeight,
  },
  backBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center', marginRight: space.sm },
  headerTitle: { ...font.title },
  headerRight: { width: size.iconButton },
  content: { 
    flexGrow: 1, 
    alignItems: 'center', 
    justifyContent: 'center',
    padding: layout.screenPadding,
    paddingBottom: 120,
  },
  iconWrap: { 
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center', 
    justifyContent: 'center',
    marginBottom: space.xxl,
  },
  title: { ...font.heading, marginBottom: space.sm, textAlign: 'center' },
  desc: { ...font.body, textAlign: 'center' },
});