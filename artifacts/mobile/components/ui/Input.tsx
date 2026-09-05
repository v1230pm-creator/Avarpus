import React, { useState } from 'react';
import { StyleProp, StyleSheet, Text, TextInput, TextInputProps, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

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
  radius: 14,
};

export function Input({
  label, error, leftIcon, leftText, rightIcon, onRightIconPress, rightIconAccessibilityLabel,
  containerStyle, inputContainerStyle, isPassword = false, dark = false, ...props
}: InputProps) {
  const themeColors = useColors();
  const colors = dark
    ? { ...themeColors, ...DARK }
    : { ...themeColors, text: themeColors.foreground };
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(false);

  const borderColor = error ? colors.destructive : focused ? colors.primary : colors.border;

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
          {label}
        </Text>
      )}
      <View collapsable={false} style={[styles.row, {
        backgroundColor: colors.input,
        borderColor,
        borderWidth: 1.5,
        borderRadius: colors.radius - 2,
      }, inputContainerStyle]}>
        {leftIcon && (
          <Feather name={leftIcon} size={18} color={focused ? colors.primary : colors.mutedForeground} style={styles.leftIcon} />
        )}
        {!!leftText && !leftIcon && (
          <Text style={[styles.leftIcon, { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: focused ? colors.primary : colors.mutedForeground }]}>{leftText}</Text>
        )}
        <TextInput
          style={[styles.input, {
            color: colors.text,
            fontFamily: 'Inter_400Regular',
            paddingLeft: (leftIcon || leftText) ? 0 : 14,
            paddingRight: (isPassword || rightIcon) ? 0 : 14,
          }]}
          placeholderTextColor={colors.mutedForeground}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          secureTextEntry={isPassword && !showPassword}
          {...props}
        />
        {isPassword && (
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.rightIcon}>
            <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
        {rightIcon && !isPassword && (
          <TouchableOpacity
            onPress={onRightIconPress}
            style={styles.rightIcon}
            accessibilityLabel={rightIconAccessibilityLabel}
          >
            <Feather name={rightIcon} size={18} color={colors.mutedForeground} />
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
  container: { gap: 7, width: '100%' },
  label: { fontSize: 12, lineHeight: 16, letterSpacing: 0.1 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center' },
  leftIcon: { width: 42, textAlign: 'center' },
  rightIcon: { width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, height: 50, minWidth: 0, fontSize: 15, lineHeight: 20, paddingVertical: 0 },
  error: { fontSize: 12, lineHeight: 16, marginTop: -1 },
});
