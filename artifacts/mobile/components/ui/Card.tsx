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
 * Glass-style card matching the dashboard's premium look.
 * Backwards compatible: `variant` tweaks shadow/border strength.
 */
export function Card({ children, style, variant = 'default', padding = 16 }: CardProps) {
  const colors = useColors();
  const isDark = useIsDark();
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: variant === 'elevated' ? colors.glassStrong : colors.glass,
          borderColor: variant === 'outline' ? colors.glassBorderActive : colors.glassBorder,
          padding,
          shadowColor: '#000000',
          shadowOpacity:
            variant === 'elevated' ? (isDark ? 0.22 : 0.08) : isDark ? 0.18 : 0.05,
          elevation: variant === 'elevated' ? 6 : 4,
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
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
  },
});
