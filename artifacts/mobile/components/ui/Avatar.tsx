import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { KEYS, storage } from '@/utils/storage';
import { fontFamily } from '@/constants/typography';

const COLORS = ['#075FEA', '#315BA6', '#0A8062', '#A87824', '#9C3B4A', '#246A91'];

// A failed load is retried this many times (spaced out) before the avatar
// settles on initials for the rest of its mount. Enough to ride out a brief
// network blip; short enough that a permanent 404 stops hitting the server.
const MAX_LOAD_ATTEMPTS = 2;
const RETRY_DELAY_MS = 4000;

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

/**
 * Server entity paths (`/objects/…`) are served through the authenticated
 * storage route. Any other URI with a scheme (http(s), file, content, ph,
 * data) is handed to the image loader as-is. A relative path that is not an
 * entity path — e.g. a legacy raw bucket path — can never render, so the
 * avatar shows initials instead of an empty circle.
 */
function isServerEntityPath(url: string): boolean {
  return url.startsWith('/objects/');
}

/**
 * A final profile photo lives at a unique, never-rewritten key, so the URL
 * fully identifies the bytes and the device may keep a copy: the avatar then
 * survives a weak network or a slow server instead of dropping to initials.
 * Everything else (device contact photos, staging keys, external URLs) can
 * change behind a stable URL and is fetched fresh.
 */
const FINAL_PROFILE_PATH_RE = /^\/objects\/uploads\/profiles\/[0-9a-f-]{36}\/final\/[0-9a-f-]{36}$/i;

function isImmutableProfilePhoto(url: string): boolean {
  return FINAL_PROFILE_PATH_RE.test(url);
}

function isLoadableAvatarUrl(url: string | null | undefined): url is string {
  return !!url && (isServerEntityPath(url) || /^[a-z][a-z0-9+.-]*:/i.test(url));
}

interface ResolvedToken {
  url: string;
  token: string | null;
}

interface LoadFailure {
  url: string;
  attempts: number;
  /** How many of those attempts have already been followed by a retry. */
  retriesFired: number;
}

export function Avatar({ name, url, size = 40, style, variant = 'solid' }: AvatarProps) {
  const colors = useColors();
  // Token state is scoped to the url it was read for, so a url change never
  // renders with credentials (or readiness) left over from the previous one.
  const [resolved, setResolved] = useState<ResolvedToken | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const initials = name
    .trim()
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const bg = hashColor(name);
  const isGlass = variant === 'glass';
  const loadable = isLoadableAvatarUrl(url);
  const needsToken = loadable && isServerEntityPath(url);
  const imageUrl = useMemo(() => {
    if (!loadable || !isServerEntityPath(url)) return url;
    const path = `/api/storage${url}`;
    if (Platform.OS === 'web') return path;
    return process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}${path}` : path;
  }, [url, loadable]);

  useEffect(() => {
    if (!needsToken) return;
    let cancelled = false;
    storage
      .get<string>(KEYS.AUTH_TOKEN)
      .then((value) => {
        if (!cancelled) setResolved({ url, token: value ?? null });
      })
      .catch(() => {
        if (!cancelled) setResolved({ url, token: null });
      });
    return () => {
      cancelled = true;
    };
  }, [url, needsToken]);

  const token = needsToken && resolved?.url === url ? resolved.token : null;
  const tokenPending = needsToken && resolved?.url !== url;
  // A protected path with no stored token (signed out) is not requested at all.
  const signedOut = needsToken && !tokenPending && token === null;
  const current = failure?.url === url ? failure : null;
  const failedAttempts = current?.attempts ?? 0;
  const retriesFired = current?.retriesFired ?? 0;
  const gaveUp = failedAttempts >= MAX_LOAD_ATTEMPTS;
  const retryPending = !gaveUp && failedAttempts > retriesFired;

  useEffect(() => {
    if (!retryPending) return;
    const timer = setTimeout(() => {
      setFailure((prev) => (prev && prev.url === url ? { ...prev, retriesFired: prev.attempts } : prev));
    }, RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [retryPending, url]);

  const showImage = loadable && !tokenPending && !signedOut && !gaveUp && !retryPending;
  // Hold a neutral circle while the token is read or a retry is scheduled,
  // rather than flashing initials that an image is about to replace.
  const holdPlaceholder = loadable && !signedOut && !gaveUp && (tokenPending || retryPending);

  if (showImage || holdPlaceholder) {
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
        {showImage ? (
          <Image
            key={`${url}:${retriesFired}`}
            source={{
              uri: imageUrl ?? url,
              // Credentials only ever accompany requests to our own storage route.
              ...(needsToken && token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
            }}
            style={{ width: size, height: size }}
            contentFit="cover"
            cachePolicy={isImmutableProfilePhoto(url) ? 'memory-disk' : 'none'}
            onError={() =>
              setFailure((prev) =>
                prev && prev.url === url
                  ? { ...prev, attempts: prev.attempts + 1 }
                  : { url, attempts: 1, retriesFired: 0 },
              )
            }
          />
        ) : (
          <View style={{ width: size, height: size, backgroundColor: colors.backgroundSecondary }} />
        )}
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
      <Text
        style={[
          styles.initials,
          {
            fontSize: size * 0.36,
            color: isGlass ? '#C4B5FD' : '#FFFFFF',
            fontFamily: fontFamily.semibold,
          },
        ]}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  initials: { letterSpacing: 0.5 },
});
