import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

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
    contentContainerStyle: { gap: 8, paddingVertical: 2 },
  } : { style: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 } };

  return (
    <View style={[{ gap: 8 }, style]}>
      <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
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
                  borderRadius: colors.radius - 4,
                },
              ]}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.chipText,
                {
                  color: selected ? colors.primaryForeground : colors.mutedForeground,
                  fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_400Regular',
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
  label: { fontSize: 13 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1 },
  chipText: { fontSize: 13 },
  error: { fontSize: 12 },
});
