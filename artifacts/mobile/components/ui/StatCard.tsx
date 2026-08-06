import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

type IconColor = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'muted';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: keyof typeof Feather.glyphMap;
  iconColor?: IconColor;
  subtitle?: string;
  style?: ViewStyle;
}

export function StatCard({ title, value, icon, iconColor = 'primary', subtitle, style }: StatCardProps) {
  const colors = useColors();

  const iconBg: Record<IconColor, string> = {
    primary: colors.primary + '22',
    success: colors.successLight,
    warning: colors.warningLight,
    error: colors.destructive + '22',
    info: colors.infoLight,
    muted: colors.muted,
  };
  const iconFg: Record<IconColor, string> = {
    primary: colors.primary,
    success: colors.success,
    warning: colors.warning,
    error: colors.destructive,
    info: colors.info,
    muted: colors.mutedForeground,
  };

  return (
    <View style={[styles.card, {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderColor: colors.border,
      shadowColor: colors.foreground,
    }, style]}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg[iconColor], borderRadius: colors.radius - 4 }]}>
        <Feather name={icon} size={20} color={iconFg[iconColor]} />
      </View>
      <Text style={[styles.value, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.title, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
        {title}
      </Text>
      {subtitle && (
        <Text style={[styles.subtitle, { color: colors.success, fontFamily: 'Inter_500Medium' }]} numberOfLines={1}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16, gap: 6, borderWidth: 1,
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  iconWrap: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  value: { fontSize: 24, lineHeight: 28 },
  title: { fontSize: 12 },
  subtitle: { fontSize: 11 },
});
