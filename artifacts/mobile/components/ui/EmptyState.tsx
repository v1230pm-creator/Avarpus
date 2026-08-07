import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';

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
        <Feather name={icon} size={32} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{title}</Text>
      {description && (
        <Text style={[styles.desc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{description}</Text>
      )}
      {actionLabel && onAction && (
        <Button title={actionLabel} onPress={onAction} variant="primary" size="sm" style={{ marginTop: 8 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40, paddingVertical: 60 },
  iconWrap: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontSize: 18, textAlign: 'center' },
  desc: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
