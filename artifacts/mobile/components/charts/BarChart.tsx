import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface BarChartProps {
  data: { label: string; value: number }[];
  title?: string;
  color?: string;
  height?: number;
}

export function BarChart({ data, title, color, height = 120 }: BarChartProps) {
  const colors = useColors();
  const barColor = color ?? colors.primary;
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <View>
      {title && (
        <Text style={[styles.title, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>{title}</Text>
      )}
      <View style={[styles.chart, { height }]}>
        {data.map((item, idx) => {
          const barH = Math.max((item.value / max) * (height - 24), item.value > 0 ? 4 : 0);
          return (
            <View key={idx} style={styles.barWrap}>
              <View style={styles.barContainer}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: barH,
                      backgroundColor: barColor,
                      borderRadius: 4,
                      opacity: idx === data.length - 1 ? 1 : 0.5 + (idx / data.length) * 0.5,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                {item.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 11, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  barWrap: { flex: 1, alignItems: 'center', gap: 4 },
  barContainer: { flex: 1, justifyContent: 'flex-end', width: '100%' },
  bar: { width: '100%' },
  label: { fontSize: 10 },
});
