import React from 'react';
import { Platform, StyleSheet, View, ViewStyle, useColorScheme } from 'react-native';
import { BlurView } from 'expo-blur';
import { useColors } from '@/hooks/useColors';
import { radius, space } from '@/constants/spacing';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'default' | 'elevated' | 'outline';
  padding?: number;
}

/**
 * Premium surface card. Kept intentionally restrained so the app reads as
 * secure and operational rather than overly glassy.
 */
export function Card({ children, style, variant = 'default', padding = space.xl }: CardProps) {
  const colors = useColors();
  const isDark = useColorScheme() === 'dark';
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: variant === 'elevated' ? colors.surfaceElevated : colors.card,
          borderColor: variant === 'outline' ? colors.primary : colors.border,
          padding,
          shadowColor: colors.primary,
          // Dark surfaces separate by tone; shadows only lift the light theme.
          shadowOpacity: variant === 'elevated' ? (isDark ? 0.1 : 0.08) : isDark ? 0 : 0.04,
          elevation: variant === 'elevated' ? 2 : 0,
        },
        style,
      ]}
    >
      {Platform.OS === 'ios' && (
        <BlurView
          intensity={isDark ? 12 : 20}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
  },
});
