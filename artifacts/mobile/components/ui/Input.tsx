import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleProp, StyleSheet, Text, TextInput, TextInputProps, TouchableOpacity, View, ViewStyle } from 'react-native';
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
  /** Compact field for dense cards: caption label, 44dp box, 14sp text. */
  dense?: boolean;
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
  containerStyle, inputContainerStyle, isPassword = false, dark = false, onBlue: useOnBlue = false, dense = false,
  style, multiline = false, ...props
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
        // On the saturated blue the hint must stay at the on-blue minimum alpha; the dimmed app grey would vanish.
        placeholder: onBlue.textMuted,
        destructive: onBlue.danger,
        text: onBlue.text,
      }
    : dark
      ? { ...themeColors, ...DARK }
      : { ...themeColors, text: themeColors.foreground };
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Native multiline boxes size to their content. The web <textarea> does not: it keeps its row count and
  // scrolls, so on web the box is re-measured whenever the text changes (reset first so it can shrink again).
  // Any `maxHeight` in `style` still caps the growth through CSS.
  useEffect(() => {
    if (Platform.OS !== 'web' || !multiline) return;
    const node = inputRef.current as unknown as { style: { height: string }; scrollHeight: number } | null;
    if (!node?.style) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [multiline, props.value]);

  const borderColor = error ? colors.destructive : focused ? colors.primary : colors.border;

  const edgePadding = dense ? space.md : space.lg;
  // The web <textarea> defaults to two rows unless told otherwise. Never pass rows/numberOfLines natively:
  // on Android they fix the height and stop the box from growing.
  const webRows = Platform.OS === 'web' && multiline && props.numberOfLines == null ? { rows: 1 } : null;

  return (
    <View style={[styles.container, dense && styles.containerDense, containerStyle]}>
      {label && (
        <Text style={[dense ? styles.labelDense : styles.label, { color: colors.foreground }]}>
          {label}
        </Text>
      )}
      <View collapsable={false} style={[styles.row, dense && styles.rowDense, {
        backgroundColor: colors.input,
        borderColor,
        borderWidth: 1.5,
        borderRadius: colors.radius,
      }, inputContainerStyle]}>
        {leftIcon && (
          <Feather
            name={leftIcon}
            size={size.inlineIcon}
            color={focused ? colors.primary : colors.mutedForeground}
            style={dense ? styles.leftIconDense : styles.leftIcon}
          />
        )}
        {!!leftText && !leftIcon && (
          <Text style={[dense ? styles.leftIconDense : styles.leftIcon, styles.leftText, { color: focused ? colors.primary : colors.mutedForeground }]}>{leftText}</Text>
        )}
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            dense && styles.inputDense,
            multiline && (dense ? styles.multilineDense : styles.multiline),
            {
              color: colors.text,
              paddingLeft: (leftIcon || leftText) ? 0 : edgePadding,
              paddingRight: (isPassword || rightIcon) ? 0 : edgePadding,
            },
            style,
          ]}
          placeholderTextColor={colors.placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          secureTextEntry={isPassword && !showPassword}
          multiline={multiline}
          {...webRows}
          {...props}
        />
        {isPassword && (
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={[styles.rightIcon, dense && styles.rightIconDense]}>
            <Feather name={showPassword ? 'eye-off' : 'eye'} size={size.inlineIcon} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
        {rightIcon && !isPassword && (
          <TouchableOpacity
            onPress={onRightIconPress}
            style={[styles.rightIcon, dense && styles.rightIconDense]}
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
  containerDense: { gap: space.xs },
  label: font.label,
  labelDense: font.captionStrong,
  row: { minHeight: size.input, flexDirection: 'row', alignItems: 'center' },
  rowDense: { minHeight: size.inputSm },
  leftIcon: { width: size.input, textAlign: 'center' },
  leftIconDense: { width: size.inputSm - space.xs, textAlign: 'center' },
  leftText: { ...font.bodyStrong, fontFamily: fontFamily.semibold },
  rightIcon: { width: size.iconButton, height: size.input, alignItems: 'center', justifyContent: 'center' },
  rightIconDense: { height: size.inputSm },
  input: { flex: 1, minHeight: size.input - 2, minWidth: 0, ...font.input, paddingVertical: 0 },
  inputDense: { minHeight: size.inputSm - 2, ...font.body },
  // Multiline boxes start one line tall (first line centred by symmetric padding) and grow with
  // their content; callers cap the growth with `style={{ maxHeight }}`.
  multiline: { textAlignVertical: 'top', paddingVertical: (size.input - 2 - font.input.lineHeight) / 2 },
  multilineDense: { textAlignVertical: 'top', paddingVertical: (size.inputSm - 2 - font.body.lineHeight) / 2 },
  error: { ...font.small, marginTop: -2 },
});
