import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { font } from '@/constants/typography';
import { space } from '@/constants/spacing';

interface EmptyStateProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  const colors = useColors();
  return (
    <View style={styles.container}>
      <View
        style={[
          styles.iconWrap,
          {
            backgroundColor: colors.primary + '12',
            borderRadius: 100,
            borderWidth: 1,
            borderColor: colors.primary + '22',
          },
        ]}
      >
        <Feather name={icon} size={24} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {description && (
        <Text style={[styles.desc, { color: colors.mutedForeground }]}>{description}</Text>
      )}
      {actionLabel && onAction && (
        <Button title={actionLabel} onPress={onAction} variant="primary" size="sm" style={{ marginTop: space.sm }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.xxxl + space.sm, paddingVertical: space.xxxl },
  iconWrap: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  title: { ...font.itemTitle, textAlign: 'center' },
  desc: { ...font.body, textAlign: 'center' },
});
