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
 * elsewhere. Matches the dashboard's visual language.
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
          borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
          backgroundColor: isDark ? 'rgba(17, 24, 39, 0.6)' : 'rgba(255, 255, 255, 0.8)',
          overflow: 'hidden',
          shadowColor: colors.foreground,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.2 : 0.05,
          shadowRadius: 12,
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
      {children}
    </Animated.View>
  );
}

/**
 * Full-screen ambient background: subtle top gradient wash + a soft
 * primary-colored orb, matching the dashboard. Place as the first child
 * of a screen container (renders absolutely, pointerEvents none).
 */
export function ScreenGlow() {
  const colors = useColors();
  const isDark = useIsDark();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={
          isDark
            ? ['rgba(59, 130, 246, 0.12)', 'transparent']
            : ['rgba(26, 86, 219, 0.06)', 'transparent']
        }
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.4 }}
      />
      <View
        style={{
          position: 'absolute',
          top: -100,
          right: -100,
          width: 300,
          height: 300,
          borderRadius: 150,
          backgroundColor: colors.primary,
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
