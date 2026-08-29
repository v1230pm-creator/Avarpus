import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

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
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>{title}</Text>
        <View style={styles.headerRight} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + '15' }]}>
          <Feather name="tool" size={40} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{title}</Text>
        <Text style={[styles.desc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{description}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 8, 
    paddingBottom: 12,
  },
  backBtn: { padding: 8, marginRight: 8 },
  headerTitle: { fontSize: 20 },
  headerRight: { width: 40 },
  content: { 
    flexGrow: 1, 
    alignItems: 'center', 
    justifyContent: 'center',
    padding: 24,
    paddingBottom: 120,
  },
  iconWrap: { 
    width: 80, 
    height: 80, 
    borderRadius: 40, 
    alignItems: 'center', 
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: { fontSize: 20, marginBottom: 8, textAlign: 'center' },
  desc: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
});