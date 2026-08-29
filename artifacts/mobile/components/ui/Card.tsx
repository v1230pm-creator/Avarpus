import React from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useColors } from '@/hooks/useColors';
import { useIsDark } from '@/components/ui/Glass';

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
export function Card({ children, style, variant = 'default', padding = 16 }: CardProps) {
  const colors = useColors();
  const isDark = useIsDark();
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: variant === 'elevated' ? colors.surfaceElevated : colors.card,
          borderColor: variant === 'outline' ? colors.primary : colors.border,
          padding,
          shadowColor: colors.primary,
          shadowOpacity: variant === 'elevated' ? (isDark ? 0.16 : 0.08) : isDark ? 0.08 : 0.04,
          elevation: variant === 'elevated' ? 3 : 1,
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
    borderRadius: 15,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
  },
});
