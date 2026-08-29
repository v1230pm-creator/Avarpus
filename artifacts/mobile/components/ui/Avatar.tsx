import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { KEYS, storage } from '@/utils/storage';

const COLORS = ['#075FEA', '#315BA6', '#0A8062', '#A87824', '#9C3B4A', '#246A91'];

function hashColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

interface AvatarProps {
  name: string;
  url?: string | null;
  size?: number;
  style?: ViewStyle;
  /** 'glass' renders the spec's purple glass avatar (header profile chip). */
  variant?: 'solid' | 'glass';
}

export function Avatar({ name, url, size = 40, style, variant = 'solid' }: AvatarProps) {
  const colors = useColors();
  const [token, setToken] = useState<string | null>(null);
  const initials = name.trim().split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const bg = hashColor(name);
  const isGlass = variant === 'glass';
  const imageUrl = useMemo(() => {
    if (!url || !url.startsWith('/objects/')) return url;
    const path = `/api/storage${url}`;
    if (Platform.OS === 'web') return path;
    return process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}${path}`
      : path;
  }, [url]);

  useEffect(() => {
    if (!url?.startsWith('/objects/')) return;
    storage.get<string>(KEYS.AUTH_TOKEN).then(setToken).catch(() => setToken(null));
  }, [url]);

  if (url) {
    return (
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: isGlass ? 1 : 0,
            borderColor: isGlass ? 'rgba(139, 92, 246, 0.35)' : 'transparent',
            overflow: 'hidden',
          },
          style,
        ]}
      >
        <Image
          source={{
            uri: imageUrl ?? url,
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          }}
          style={{ width: size, height: size }}
          contentFit="cover"
        />
      </View>
    );
  }

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
