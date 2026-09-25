import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { RepairStatus, RepairPriority } from '@/types';
import { font } from '@/constants/typography';
import { radius, size as controlSize, space } from '@/constants/spacing';

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
  return (
    <View style={[styles.badge, size === 'sm' && styles.smallBadge, { backgroundColor: bg[variant] }, style]}>
      <Text style={[styles.text, { color: fg[variant] }]}>{label}</Text>
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
  received: 'Received', diagnosing: 'Diagnosing', waiting_parts: 'Waiting for Parts',
  repairing: 'In Repair', testing: 'Testing', ready: 'Repair Completed (Ready)',
  delivered: 'Delivered', cancelled: 'Cancelled',
  cannot_repair: 'Cannot Repair', customer_approval: 'Customer Approval Required'
};

const PRIORITY_VARIANTS: Record<RepairPriority, BadgeVariant> = {
  low: 'muted', normal: 'default', high: 'warning', urgent: 'error',
};

// Short forms for list cards, where a long pill would squeeze the ticket id.
const REPAIR_STATUS_SHORT_LABELS: Partial<Record<RepairStatus, string>> = {
  waiting_parts: 'Waiting Parts', ready: 'Ready', customer_approval: 'Approval Needed',
};

export function RepairStatusBadge({ status, compact = false }: { status: RepairStatus; compact?: boolean }) {
  const label = (compact && REPAIR_STATUS_SHORT_LABELS[status]) || REPAIR_STATUS_LABELS[status];
  return <Badge label={label} variant={REPAIR_STATUS_VARIANTS[status]} size="sm" />;
}

export function PriorityBadge({ priority }: { priority?: RepairPriority | null }) {
  const safePriority = priority ?? 'normal';
  return <Badge label={safePriority.charAt(0).toUpperCase() + safePriority.slice(1)} variant={PRIORITY_VARIANTS[safePriority]} size="sm" />;
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
  badge: {
    alignSelf: 'flex-start',
    minHeight: controlSize.badge,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  smallBadge: { minHeight: controlSize.badge },
  text: { ...font.smallStrong, letterSpacing: 0.2 },
});
