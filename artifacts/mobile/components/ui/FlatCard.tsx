import React from 'react';
import { StyleSheet, View, ViewProps, Platform, Animated, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface FlatCardProps extends ViewProps {
  animValue?: Animated.Value;
}

export function FlatCard({ style, children, animValue, ...props }: FlatCardProps) {
  const colors = useColors();

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

  const Comp = animValue ? Animated.View : View;

  return (
    <Comp
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
        Platform.select({
          ios: {
            shadowColor: colors.foreground,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.05,
            shadowRadius: 4,
          },
          android: {
            elevation: 2,
          },
          web: {
            boxShadow: `0 2px 8px ${colors.foreground}0A`,
          },
        }),
        animatedStyle,
        style,
      ]}
      {...props}
    >
      {children}
    </Comp>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
});
