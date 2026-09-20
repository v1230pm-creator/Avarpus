import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FlatCard } from '@/components/ui/FlatCard';
import { formatDateTime } from '@/utils/dealer-ledger';
import type { DealerTransferRequest } from '@workspace/api-client-react';

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
      <FlatCard style={{ padding: 12, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[styles.avatar, { backgroundColor: line.color + '1A' }]}>
            <Feather name={request.side === 'sender' ? 'upload' : 'download'} size={16} color={line.color} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_700Bold' }} numberOfLines={1}>
              {d.brand} {d.model}
            </Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
              {request.side === 'sender' ? `To ${other.businessName}` : `From ${other.businessName}`}
              {other.ownerName ? ` · ${other.ownerName}` : ''}
            </Text>
          </View>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>{formatDateTime(request.createdAt)}</Text>
        </View>
        {!!d.problem && (
          <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }} numberOfLines={1}>
            {d.problem}
          </Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={[styles.badge, { backgroundColor: line.color + '1A' }]}>
            <Feather name={line.icon} size={11} color={line.color} />
            <Text style={{ fontSize: 11, color: line.color, fontFamily: 'Inter_600SemiBold', flexShrink: 1 }} numberOfLines={1}>
              {line.label}
            </Text>
          </View>
          {request.status === 'pending' && request.side === 'receiver' && canRespond && (
            <Text style={{ fontSize: 11, color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Accept / Decline ›</Text>
          )}
        </View>
      </FlatCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
});
