import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  ViewStyle,
  TextStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { onBlue } from '@/constants/brand';
import { fontFamily } from '@/constants/typography';
import { size as controlSize, space } from '@/constants/spacing';

interface ButtonProps {
  title: string;
  onPress: () => void;
  /**
   * `onBlue` is for controls sitting on the brand blue auth surface. It carries
   * its own disabled colours instead of dimming, because a dimmed control is
   * effectively invisible against that background.
   */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'onBlue';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
  testID?: string;
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
  testID,
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
    onBlue: disabled ? onBlue.controlBackgroundDisabled : onBlue.controlBackground,
  }[variant];

  const txtColor = {
    primary: colors.primaryForeground,
    secondary: colors.secondaryForeground,
    outline: colors.primary,
    ghost: colors.foreground,
    destructive: colors.destructiveForeground,
    onBlue: disabled ? onBlue.controlTextDisabled : onBlue.controlText,
  }[variant];

  const padH = { sm: space.lg, md: space.xxl, lg: space.xxxl }[size];
  const fontSize = { sm: 15, md: 17, lg: 18 }[size];
  const lineHeight = { sm: 20, md: 22, lg: 24 }[size];
  const minHeight = { sm: controlSize.buttonSm, md: controlSize.button, lg: controlSize.buttonLg }[size];

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
        testID={testID}
        onPress={handlePress}
        disabled={disabled || loading}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
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
            opacity: disabled && variant !== 'onBlue' ? 0.5 : 1,
          },
          variant === 'onBlue' && !disabled && styles.onBlueElevation,
          fullWidth && { width: '100%' },
          (flex !== undefined || flexGrow !== undefined || width !== undefined) && { width: '100%' },
          innerStyle,
        ]}
      >
        {loading ? (
          <AvarpusSpinner color={txtColor} size={Math.max(16, fontSize + 2)} accessibilityLabel={null} />
        ) : (
          <Text numberOfLines={1} style={[styles.text, { color: txtColor, fontSize, lineHeight }, textStyle]}>
            {title}
          </Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space.sm },
  text: { fontFamily: fontFamily.semibold, textAlign: 'center' },
  onBlueElevation: {
    shadowColor: '#012B41',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 4,
  },
});
