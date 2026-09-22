import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FlatCard } from '@/components/ui/FlatCard';
import { formatDateTime } from '@/utils/dealer-ledger';
import type { DealerTransferRequest } from '@workspace/api-client-react';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** One line describing where a request stands, from the caller's side. */
export function transferStatusLine(r: DealerTransferRequest, colors: ReturnType<typeof useColors>): { icon: FeatherName; color: string; label: string } {
  const other = r.side === 'sender' ? r.receiver : r.sender;
  const who = other.businessName || other.ownerName || 'the other dealer';
  switch (r.status) {
    case 'pending':
      return r.side === 'sender'
        ? { icon: 'clock', color: colors.warning, label: `Waiting for ${who} to accept` }
        : { icon: 'inbox', color: colors.warning, label: `${who} wants to send you this device` };
    case 'accepted':
      return {
        icon: 'check-circle',
        color: colors.success,
        label: r.side === 'sender'
          ? `Accepted by ${r.respondedByName || who}${r.resultStatus ? ` · ${r.resultStatus.replace(/_/g, ' ')}` : ''}`
          : `Accepted by ${r.respondedByName || 'your shop'}`,
      };
    case 'declined':
      return {
        icon: 'x-circle',
        color: colors.destructive,
        label: r.side === 'sender' ? `Declined by ${who}` : 'You declined this request',
      };
    default:
      return {
        icon: 'slash',
        color: colors.mutedForeground,
        label: r.side === 'sender' ? 'You cancelled this request' : `Cancelled by ${who}`,
      };
  }
}

export function TransferRequestCard({
  request,
  canRespond,
  onPress,
}: {
  request: DealerTransferRequest;
  canRespond: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const line = transferStatusLine(request, colors);
  const other = request.side === 'sender' ? request.receiver : request.sender;
  const d = request.device;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} testID={`transfer-request-${request.id}`} accessibilityRole="button">
      <FlatCard style={{ padding: space.xl, gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: layout.avatarGap }}>
          <View style={[styles.avatar, { backgroundColor: line.color + '1A' }]}>
            <Feather name={request.side === 'sender' ? 'upload' : 'download'} size={size.headerIcon} color={line.color} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...font.itemTitle, color: colors.foreground }} numberOfLines={1}>
              {d.brand} {d.model}
            </Text>
            <Text style={{ ...font.captionStrong, color: colors.mutedForeground }} numberOfLines={1}>
              {request.side === 'sender' ? `To ${other.businessName}` : `From ${other.businessName}`}
              {other.ownerName ? ` · ${other.ownerName}` : ''}
            </Text>
          </View>
          <Text style={{ ...font.caption, color: colors.mutedForeground }}>{formatDateTime(request.createdAt)}</Text>
        </View>
        {!!d.problem && (
          <Text style={{ ...font.body, color: colors.mutedForeground }} numberOfLines={1}>
            {d.problem}
          </Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={[styles.badge, { backgroundColor: line.color + '1A' }]}>
            <Feather name={line.icon} size={11} color={line.color} />
            <Text style={{ ...font.captionStrong, color: line.color, flexShrink: 1 }} numberOfLines={1}>
              {line.label}
            </Text>
          </View>
          {request.status === 'pending' && request.side === 'receiver' && canRespond && (
            <Text style={{ ...font.captionStrong, color: colors.primary }}>Accept / Decline ›</Text>
          )}
        </View>
      </FlatCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  avatar: { width: size.avatar, height: size.avatar, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm },
});
