import React, { useEffect, useMemo } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { StatusItem } from '@workspace/api-client-react';
import { font } from '@/constants/typography';
import { space } from '@/constants/spacing';
import { useColors } from '@/hooks/useColors';

function absoluteMediaUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (Platform.OS === 'web') return path;
  return process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}${path}`
    : path;
}

export function StatusMedia({
  item,
  token,
  autoPlay = false,
}: {
  item: StatusItem;
  token: string | null;
  autoPlay?: boolean;
}) {
  const colors = useColors();
  const uri = absoluteMediaUrl(item.mediaUrl);
  const source = useMemo(
    () => item.kind === 'video' && uri
      ? { uri, headers: token ? { Authorization: `Bearer ${token}` } : undefined }
      : null,
    [item.kind, token, uri],
  );
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    if (autoPlay) instance.play();
  });
  useEffect(() => {
    if (item.kind !== 'video') return;
    if (autoPlay && AppState.currentState === 'active') player.play();
    else player.pause();
    const subscription = AppState.addEventListener('change', (state) => {
      if (autoPlay && state === 'active') player.play();
      else player.pause();
    });
    return () => {
      subscription.remove();
      player.pause();
    };
  }, [autoPlay, item.kind, item.id, player]);

  if (item.kind === 'text') {
    return (
      <View style={[styles.textStatus, { backgroundColor: colors.primary }]}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.55}
          numberOfLines={12}
          style={[styles.textBody, { color: colors.primaryForeground }]}
        >
          {item.body}
        </Text>
      </View>
    );
  }

  if (!uri) {
    return (
      <View style={[styles.unavailable, { backgroundColor: colors.background }]}>
        <Text style={[styles.unavailableText, { color: colors.primaryForeground }]}>Media unavailable</Text>
      </View>
    );
  }

  if (item.kind === 'video') {
    return (
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls
      />
    );
  }

  return (
    <Image
      source={{ uri, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      transition={150}
    />
  );
}

const styles = StyleSheet.create({
  textStatus: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxxl,
  },
  textBody: {
    color: '#FFFFFF',
    ...font.display,
    textAlign: 'center',
  },
  unavailable: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableText: {
    color: '#FFFFFF',
    ...font.bodyStrong,
  },
});