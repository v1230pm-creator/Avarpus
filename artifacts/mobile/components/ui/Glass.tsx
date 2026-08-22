import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useColorScheme } from 'react-native';
import { useColors } from '@/hooks/useColors';

export { FlatCard } from './FlatCard';

/** Whether the app is currently rendering the dark palette. */
export function useIsDark() {
  return useColorScheme() === 'dark';
}

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Optional Animated.Value (0→1) driving a fade + rise entrance. */
  animValue?: Animated.Value;
}

/**
 * Premium glassmorphism card — frosted blur on iOS, translucent surface
 * elsewhere. Matches the app's visual language.
 */
export function GlassCard({ children, style, animValue }: GlassCardProps) {
  const colors = useColors();
  const isDark = useIsDark();

  const animatedStyle = animValue
    ? {
        opacity: animValue,
        transform: [
          {
            translateY: animValue.interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            }),
          },
        ],
      }
    : {};

  return (
    <Animated.View
      style={[
        animatedStyle,
        {
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.glassBorder,
          backgroundColor: colors.glass,
          overflow: 'hidden',
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: isDark ? 0.18 : 0.06,
          shadowRadius: 24,
          elevation: 4,
        },
        style,
      ]}
    >
      {Platform.OS === 'ios' && (
        <BlurView
          intensity={isDark ? 30 : 60}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}
      {/* Subtle inset top highlight (spec: inset 0 1px 0 rgba(255,255,255,0.035)) */}
      {isDark && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }}
        />
      )}
      {children}
    </Animated.View>
  );
}

/**
 * Full-screen ambient background: subtle top gradient wash + a soft
 * primary-colored orb, matching the app. Place as the first child
 * of a screen container (renders absolutely, pointerEvents none).
 */
export function ScreenGlow() {
  const colors = useColors();
  const isDark = useIsDark();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Spec background: linear #0B0F1A → #0E1422 with a soft blue radial at top-right */}
      {isDark && (
        <LinearGradient
          colors={['#0B0F1A', '#0E1422']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      )}
      <View
        style={{
          position: 'absolute',
          top: -120,
          right: -120,
          width: 320,
          height: 320,
          borderRadius: 160,
          backgroundColor: isDark ? '#2F80ED' : colors.primary,
          opacity: isDark ? 0.08 : 0.04,
          transform: [{ scale: 1.5 }],
        }}
      />
    </View>
  );
}

/**
 * Hook returning an array of Animated.Values that stagger from 0→1 on
 * mount — drive GlassCard `animValue` or your own entrance transforms.
 */
export function useStaggerAnim(count: number, stagger = 60, duration = 500) {
  const anims = useRef([...Array(count)].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(
      stagger,
      anims.map((anim) =>
        Animated.timing(anim, {
          toValue: 1,
          duration,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
      ),
    ).start();
  }, [anims, stagger, duration]);
  return anims;
}

/** Simple fade + rise entrance wrapper for non-card content. */
export function FadeInView({
  animValue,
  children,
  style,
}: {
  animValue: Animated.Value;
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  return (
    <Animated.View
      style={[
        {
          opacity: animValue,
          transform: [
            {
              translateY: animValue.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
