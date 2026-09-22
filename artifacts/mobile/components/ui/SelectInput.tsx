import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { font, fontFamily } from '@/constants/typography';
import { radius, space } from '@/constants/spacing';

interface SelectInputProps {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  labelMap?: Record<string, string>;
  style?: ViewStyle;
  error?: string;
  horizontal?: boolean;
}

export function SelectInput({ label, options, value, onChange, labelMap, style, error, horizontal = true }: SelectInputProps) {
  const colors = useColors();
  const Wrapper = horizontal ? ScrollView : View;
  const wrapperProps = horizontal ? {
    horizontal: true, showsHorizontalScrollIndicator: false,
    contentContainerStyle: { gap: space.sm, paddingVertical: 2, alignItems: 'center' },
  } : { style: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: space.sm } };

  return (
      <View style={[{ gap: space.sm, width: '100%' }, style]}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <Wrapper {...(wrapperProps as any)}>
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onChange(opt)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.primary : colors.muted,
                  borderColor: selected ? colors.primary : colors.border,
                  borderRadius: radius.sm,
                },
              ]}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.chipText,
                {
                  color: selected ? colors.primaryForeground : colors.mutedForeground,
                  fontFamily: selected ? fontFamily.semibold : fontFamily.regular,
                },
              ]}>
                {labelMap ? labelMap[opt] : opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </Wrapper>
      {error && <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  label: font.captionStrong,
  chip: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, borderWidth: 1 },
  chipText: font.caption,
  error: font.small,
});
