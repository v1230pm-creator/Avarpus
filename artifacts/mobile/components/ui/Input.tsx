import React, { useState } from 'react';
import { StyleProp, StyleSheet, Text, TextInput, TextInputProps, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { onBlue } from '@/constants/brand';
import { font, fontFamily } from '@/constants/typography';
import { radius, size, space } from '@/constants/spacing';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: keyof typeof Feather.glyphMap;
  leftText?: string;
  rightIcon?: keyof typeof Feather.glyphMap;
  onRightIconPress?: () => void;
  rightIconAccessibilityLabel?: string;
  containerStyle?: ViewStyle;
  inputContainerStyle?: StyleProp<ViewStyle>;
  isPassword?: boolean;
  dark?: boolean;
  onBlue?: boolean;
}

// Forced-dark palette (auth screens) — mirrors the premium glass tokens.
const DARK = {
  foreground: '#A8B3C7',
  input: 'rgba(17, 27, 45, 0.68)',
  border: 'rgba(255,255,255,0.10)',
  primary: '#3A8FF7',
  mutedForeground: '#7F8BA3',
  destructive: '#F87171',
  text: '#F5F7FA',
  radius: radius.md,
};

export function Input({
  label, error, leftIcon, leftText, rightIcon, onRightIconPress, rightIconAccessibilityLabel,
  containerStyle, inputContainerStyle, isPassword = false, dark = false, onBlue: useOnBlue = false, ...props
}: InputProps) {
  const themeColors = useColors();
  const colors = useOnBlue
    ? {
        ...themeColors,
        foreground: onBlue.text,
        input: onBlue.inputBackground,
        border: onBlue.lineStrong,
        primary: onBlue.text,
        mutedForeground: onBlue.textMuted,
        destructive: onBlue.danger,
        text: onBlue.text,
      }
    : dark
      ? { ...themeColors, ...DARK }
      : { ...themeColors, text: themeColors.foreground };
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(false);

  const borderColor = error ? colors.destructive : focused ? colors.primary : colors.border;

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text style={[styles.label, { color: colors.foreground }]}>
          {label}
        </Text>
      )}
      <View collapsable={false} style={[styles.row, {
        backgroundColor: colors.input,
        borderColor,
        borderWidth: 1.5,
        borderRadius: colors.radius,
      }, inputContainerStyle]}>
        {leftIcon && (
          <Feather name={leftIcon} size={size.inlineIcon} color={focused ? colors.primary : colors.mutedForeground} style={styles.leftIcon} />
        )}
        {!!leftText && !leftIcon && (
          <Text style={[styles.leftIcon, styles.leftText, { color: focused ? colors.primary : colors.mutedForeground }]}>{leftText}</Text>
        )}
        <TextInput
          style={[styles.input, {
            color: colors.text,
            paddingLeft: (leftIcon || leftText) ? 0 : space.lg,
            paddingRight: (isPassword || rightIcon) ? 0 : space.lg,
          }]}
          placeholderTextColor={colors.mutedForeground}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          secureTextEntry={isPassword && !showPassword}
          {...props}
        />
        {isPassword && (
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.rightIcon}>
            <Feather name={showPassword ? 'eye-off' : 'eye'} size={size.inlineIcon} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
        {rightIcon && !isPassword && (
          <TouchableOpacity
            onPress={onRightIconPress}
            style={styles.rightIcon}
            accessibilityLabel={rightIconAccessibilityLabel}
          >
            <Feather name={rightIcon} size={size.inlineIcon} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>
      {error && (
        <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.sm, width: '100%' },
  label: font.captionStrong,
  row: { minHeight: size.input, flexDirection: 'row', alignItems: 'center' },
  leftIcon: { width: 48, textAlign: 'center' },
  leftText: { ...font.bodyStrong, fontFamily: fontFamily.semibold },
  rightIcon: { width: size.iconButton, height: size.input, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, height: size.input - 2, minWidth: 0, ...font.input, paddingVertical: 0 },
  error: { ...font.small, marginTop: -2 },
});
