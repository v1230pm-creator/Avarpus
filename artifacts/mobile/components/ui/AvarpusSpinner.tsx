import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

/**
 * Avarpus loading mark.
 *
 * Twelve tapered blades sit on a circle; the brightest blade leads and the
 * trail fades behind it, so the ring reads as a clockwise sweep. The whole
 * ring turns at a constant speed on the native driver, which keeps it smooth
 * while JavaScript is busy — exactly when a loading indicator is on screen.
 *
 * This is the single loading motion for the product. Screens should not fall
 * back to the platform ActivityIndicator, whose look changes per OS.
 */

const BLADES = 12;
/** One full turn. Slow enough to look composed, fast enough to feel alive. */
const ROTATION_MS = 900;

export type AvarpusSpinnerProps = {
  /** Outer diameter in points. */
  size?: number;
  /** Blade colour. Defaults to the theme primary. */
  color?: string;
  style?: ViewStyle;
  /**
   * Screen-reader label. Pass `null` for a decorative spinner that sits inside
   * an already-labelled control, so it is not announced twice.
   */
  accessibilityLabel?: string | null;
};

export function AvarpusSpinner({
  size = 24,
  color,
  style,
  accessibilityLabel = 'Loading',
}: AvarpusSpinnerProps) {
  const colors = useColors();
  const tint = color ?? colors.primary;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: ROTATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
        // Motion here communicates "still working"; honouring reduce-motion
        // would freeze the only progress signal on the screen.
        isInteraction: false,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const bladeWidth = Math.max(1.5, size * 0.11);
  const bladeHeight = Math.max(4, size * 0.28);
  const radius = size / 2 - bladeHeight / 2;

  const blades = useMemo(
    () =>
      Array.from({ length: BLADES }, (_, index) => ({
        index,
        // Trail runs anti-clockwise from the leading blade, so the bright head
        // points the way the ring is turning.
        angle: -index * (360 / BLADES),
        opacity: Math.max(0.14, 1 - index * 0.08),
      })),
    [],
  );

  return (
    <View
      style={[{ width: size, height: size }, style]}
      {...(accessibilityLabel === null
        ? { accessible: false, importantForAccessibility: 'no-hide-descendants' as const }
        : { accessibilityRole: 'progressbar' as const, accessibilityLabel })}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        {blades.map((blade) => (
          <View
            key={blade.index}
            style={{
              position: 'absolute',
              left: (size - bladeWidth) / 2,
              top: (size - bladeHeight) / 2,
              width: bladeWidth,
              height: bladeHeight,
              borderRadius: bladeWidth / 2,
              backgroundColor: tint,
              opacity: blade.opacity,
              transform: [{ rotate: `${blade.angle}deg` }, { translateY: -radius }],
            }}
          />
        ))}
      </Animated.View>
    </View>
  );
}

/**
 * Full-screen loading state used when a route has nothing else to show yet.
 * Paints the app background so no half-built layout shows through.
 */
export function AvarpusLoadingScreen({
  message,
  color,
  background,
  size = 44,
}: {
  message?: string;
  color?: string;
  background?: string;
  size?: number;
}) {
  const colors = useColors();
  return (
    <View style={[styles.screen, { backgroundColor: background ?? colors.background }]}>
      <AvarpusSpinner size={size} color={color} />
      {!!message && (
        <Text
          style={[
            styles.message,
            { color: color ?? colors.mutedForeground, fontFamily: 'Inter_500Medium' },
          ]}
        >
          {message}
        </Text>
      )}
    </View>
  );
}

/**
 * Blocking overlay for work started from a screen that is already populated
 * (bulk actions, uploads, sign-out). Sits above content and swallows taps.
 */
export function AvarpusLoadingOverlay({
  visible,
  message,
}: {
  visible: boolean;
  message?: string;
}) {
  const colors = useColors();
  if (!visible) return null;
  return (
    <View style={[styles.overlay, { backgroundColor: colors.background + 'E6' }]} pointerEvents="auto">
      <View style={[styles.overlayCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <AvarpusSpinner size={34} />
        {!!message && (
          <Text
            style={[styles.overlayText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}
          >
            {message}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  message: { fontSize: 13, textAlign: 'center' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  overlayCard: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 28,
    paddingVertical: 24,
    borderRadius: 18,
    borderWidth: 1,
    minWidth: 150,
  },
  overlayText: { fontSize: 13, textAlign: 'center' },
});
