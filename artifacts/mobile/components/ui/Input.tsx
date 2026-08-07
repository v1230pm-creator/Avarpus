import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: keyof typeof Feather.glyphMap;
  rightIcon?: keyof typeof Feather.glyphMap;
  onRightIconPress?: () => void;
  containerStyle?: ViewStyle;
  isPassword?: boolean;
  dark?: boolean;
}

const DARK = {
  foreground: '#94A3B8',
  input: '#0A1628',
  border: '#1E3A5F66',
  primary: '#3B82F6',
  mutedForeground: '#475569',
  destructive: '#F87171',
  text: '#F1F5F9',
  radius: 14,
};

export function Input({
  label, error, leftIcon, rightIcon, onRightIconPress,
  containerStyle, isPassword = false, dark = false, ...props
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
      <View style={[styles.row, {
        backgroundColor: colors.input,
        borderColor,
        borderWidth: 1.5,
        borderRadius: colors.radius - 2,
      }]}>
        {leftIcon && (
          <Feather name={leftIcon} size={18} color={focused ? colors.primary : colors.mutedForeground} style={styles.leftIcon} />
        )}
        <TextInput
          style={[styles.input, {
            color: colors.text,
            fontFamily: 'Inter_400Regular',
            paddingLeft: leftIcon ? 0 : 14,
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
          <TouchableOpacity onPress={onRightIconPress} style={styles.rightIcon}>
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
  container: { gap: 6 },
  label: { fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center' },
  leftIcon: { paddingLeft: 14, paddingRight: 10 },
  rightIcon: { paddingHorizontal: 14 },
  input: { flex: 1, height: 50, fontSize: 15 },
  error: { fontSize: 12 },
});
