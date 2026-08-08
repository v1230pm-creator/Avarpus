import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { RepairStatus, RepairPriority } from '@/types';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'muted';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
  size?: 'sm' | 'md';
}

export function Badge({ label, variant = 'default', style, size = 'md' }: BadgeProps) {
  const colors = useColors();
  const bg: Record<BadgeVariant, string> = {
    default: colors.accent,
    success: colors.successLight,
    warning: colors.warningLight,
    error: colors.destructive + '22',
    info: colors.infoLight,
    muted: colors.muted,
  };
  const fg: Record<BadgeVariant, string> = {
    default: colors.accentForeground,
    success: colors.success,
    warning: colors.warning,
    error: colors.destructive,
    info: colors.info,
    muted: colors.mutedForeground,
  };
  const padH = size === 'sm' ? 7 : 10;
  const padV = size === 'sm' ? 2 : 4;
  const fs = size === 'sm' ? 10 : 11;

  return (
    <View style={[styles.badge, { backgroundColor: bg[variant], paddingHorizontal: padH, paddingVertical: padV, borderRadius: 100 }, style]}>
      <Text style={[styles.text, { color: fg[variant], fontSize: fs }]}>{label}</Text>
    </View>
  );
}

const REPAIR_STATUS_VARIANTS: Record<RepairStatus, BadgeVariant> = {
  received: 'muted', diagnosing: 'info', waiting_parts: 'warning',
  repairing: 'info', testing: 'info', ready: 'success',
  delivered: 'success', cancelled: 'error',
  cannot_repair: 'error', customer_approval: 'warning'
};

const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  received: 'Received', diagnosing: 'Diagnosing', waiting_parts: 'Waiting Parts',
  repairing: 'Repairing', testing: 'Testing', ready: 'Ready',
  delivered: 'Delivered', cancelled: 'Cancelled',
  cannot_repair: 'Cannot Repair', customer_approval: 'Customer Approval'
};

const PRIORITY_VARIANTS: Record<RepairPriority, BadgeVariant> = {
  low: 'muted', normal: 'default', high: 'warning', urgent: 'error',
};

export function RepairStatusBadge({ status }: { status: RepairStatus }) {
  return <Badge label={REPAIR_STATUS_LABELS[status]} variant={REPAIR_STATUS_VARIANTS[status]} size="sm" />;
}

export function PriorityBadge({ priority }: { priority: RepairPriority }) {
  return <Badge label={priority.charAt(0).toUpperCase() + priority.slice(1)} variant={PRIORITY_VARIANTS[priority]} size="sm" />;
}

export function SampleBadge({ style }: { style?: ViewStyle }) {
  return <Badge label="Sample" variant="warning" size="sm" style={style} />;
}

export function PaymentBadge({ status }: { status: 'paid' | 'unpaid' | 'partial' }) {
  const variants: Record<string, BadgeVariant> = { paid: 'success', unpaid: 'error', partial: 'warning' };
  const labels: Record<string, string> = { paid: 'Paid', unpaid: 'Unpaid', partial: 'Partial' };
  return <Badge label={labels[status]} variant={variants[status]} size="sm" />;
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start' },
  text: { fontFamily: 'Inter_600SemiBold', letterSpacing: 0.2 },
});
