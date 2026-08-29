import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

const COLORS = ['#075FEA', '#315BA6', '#0A8062', '#A87824', '#9C3B4A', '#246A91'];

function hashColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

interface AvatarProps {
  name: string;
  size?: number;
  style?: ViewStyle;
  /** 'glass' renders the spec's purple glass avatar (header profile chip). */
  variant?: 'solid' | 'glass';
}

export function Avatar({ name, size = 40, style, variant = 'solid' }: AvatarProps) {
  const colors = useColors();
  const initials = name.trim().split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const bg = hashColor(name);
  const isGlass = variant === 'glass';
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: isGlass ? 'rgba(139, 92, 246, 0.16)' : bg,
          borderWidth: isGlass ? 1 : 0,
          borderColor: isGlass ? 'rgba(139, 92, 246, 0.35)' : 'transparent',
        },
        style,
      ]}
    >
      <Text style={[styles.initials, { fontSize: size * 0.36, color: isGlass ? '#C4B5FD' : '#FFFFFF', fontFamily: 'Inter_600SemiBold' }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  initials: { letterSpacing: 0.5 },
});
