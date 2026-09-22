import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { GlassCard } from '@/components/ui/Glass';
import { font } from '@/constants/typography';
import { radius, space } from '@/constants/spacing';

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
    <GlassCard style={StyleSheet.flatten([styles.card, style])}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg[iconColor], borderRadius: radius.sm }]}>
        <Feather name={icon} size={22} color={iconFg[iconColor]} />
      </View>
      <Text style={[styles.value, { color: colors.foreground }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.title, { color: colors.mutedForeground }]} numberOfLines={1}>
        {title}
      </Text>
      {subtitle && (
        <Text style={[styles.subtitle, { color: colors.success }]} numberOfLines={1}>
          {subtitle}
        </Text>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space.xl, gap: space.xs + 2,
  },
  iconWrap: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  value: font.title,
  title: font.caption,
  subtitle: font.smallStrong,
});
