import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  ViewStyle,
  TextStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  textStyle,
  fullWidth = false,
}: ButtonProps) {
  const colors = useColors();
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    if (disabled || loading) return;
    scale.value = withSpring(0.96, { damping: 15 }, () => {
      scale.value = withSpring(1, { damping: 15 });
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const bgColor = {
    primary: colors.primary,
    secondary: colors.secondary,
    outline: 'transparent',
    ghost: 'transparent',
    destructive: colors.destructive,
  }[variant];

  const txtColor = {
    primary: colors.primaryForeground,
    secondary: colors.secondaryForeground,
    outline: colors.primary,
    ghost: colors.foreground,
    destructive: colors.destructiveForeground,
  }[variant];

  const padV = { sm: 8, md: 13, lg: 17 }[size];
  const padH = { sm: 14, md: 20, lg: 26 }[size];
  const fontSize = { sm: 13, md: 15, lg: 17 }[size];
  const minHeight = { sm: 40, md: 48, lg: 56 }[size];

  // Layout styles (flex, width, margins…) must apply to the outer wrapper.
  // If they only reach the inner TouchableOpacity, the auto-sized wrapper
  // collapses and the button renders with no visible label.
  const {
    flex,
    flexGrow,
    flexShrink,
    flexBasis,
    width,
    minWidth,
    maxWidth,
    alignSelf,
    margin,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    marginHorizontal,
    marginVertical,
    ...innerStyle
  } = style ?? {};
  const layoutStyle: ViewStyle = {
    flex,
    flexGrow,
    flexShrink,
    flexBasis,
    width,
    minWidth,
    maxWidth,
    alignSelf,
    margin,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    marginHorizontal,
    marginVertical,
  };

  return (
    <Animated.View style={[animStyle, fullWidth && { width: '100%' }, layoutStyle]}>
      <TouchableOpacity
        onPress={handlePress}
        disabled={disabled || loading}
        activeOpacity={0.85}
        style={[
          styles.btn,
          {
            backgroundColor: bgColor,
            borderColor: variant === 'outline' ? colors.primary : 'transparent',
            borderWidth: variant === 'outline' ? 1.5 : 0,
             minHeight,
             paddingVertical: 0,
            paddingHorizontal: padH,
            borderRadius: colors.radius,
            opacity: disabled ? 0.5 : 1,
          },
          fullWidth && { width: '100%' },
          (flex !== undefined || flexGrow !== undefined || width !== undefined) && { width: '100%' },
          innerStyle,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={txtColor} size="small" />
        ) : (
          <Text numberOfLines={1} style={[styles.text, { color: txtColor, fontSize, fontFamily: 'Inter_600SemiBold' }, textStyle]}>
            {title}
          </Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  text: { fontWeight: '600', lineHeight: 20, textAlign: 'center' },
});
