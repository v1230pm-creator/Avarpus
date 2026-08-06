import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

const COLORS = ['#1A56DB', '#7C3AED', '#059669', '#D97706', '#DC2626', '#0284C7'];

function hashColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

interface AvatarProps {
  name: string;
  size?: number;
  style?: ViewStyle;
}

export function Avatar({ name, size = 40, style }: AvatarProps) {
  const colors = useColors();
  const initials = name.trim().split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const bg = hashColor(name);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }, style]}>
      <Text style={[styles.initials, { fontSize: size * 0.36, color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  initials: { letterSpacing: 0.5 },
});
