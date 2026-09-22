import React, { useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { FlatCard } from '@/components/ui/FlatCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DataLoadingState, DataErrorState } from '@/components/ui/DataStates';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { transferStatusLine } from '@/components/dealer/TransferRequestCard';
import { formatDateTime } from '@/utils/dealer-ledger';
import { formatDate } from '@/utils/helpers';
import {
  useDealerTransfersGet,
  useDealerTransfersAccept,
  useDealerTransfersDecline,
  useDealerTransfersCancel,
  getDealerTransfersListQueryKey,
  getDealerTransfersGetQueryKey,
  getDealerTransactionsListQueryKey,
  getDealerTransactionsLedgerQueryKey,
  getRepairsListQueryKey,
  getRepairsGetQueryKey,
} from '@workspace/api-client-react';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

// One transfer request, seen from whichever side the caller is on.
//   receiver + pending  → device preview + ACCEPT / DECLINE
//   sender   + pending  → "Waiting for X to accept" + CANCEL
//   accepted            → link to the shared transaction (both sides)
//   declined/cancelled  → terminal, with reason; sender can send again from
//                         the original repair (long-press → Send to Dealer).
export default function TransferRequestScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { canAccess } = useAuth();
  const { confirm } = useConfirmDialog();
  const { id } = useLocalSearchParams<{ id: string }>();
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const { data, isLoading, error, refetch } = useDealerTransfersGet(id ?? '', { query: { enabled: !!id } } as any);
  const accept = useDealerTransfersAccept();
  const decline = useDealerTransfersDecline();
  const cancel = useDealerTransfersCancel();
  const [reason, setReason] = useState('');
  const [showDecline, setShowDecline] = useState(false);
  const [actionError, setActionError] = useState('');
  // One decision in flight at a time. `isPending` only flips after a
  // re-render, so a fast double-tap needs a synchronous guard as well.
  const busyRef = useRef(false);
  const runOnce = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try { await fn(); } finally { busyRef.current = false; }
  };

  const request = data?.request;
  const canRespond = canAccess('repairs_update');

  const invalidate = async (extraRepairId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getDealerTransfersListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getDealerTransfersGetQueryKey(id ?? '') }),
      queryClient.invalidateQueries({ queryKey: getDealerTransactionsListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getDealerTransactionsLedgerQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getRepairsListQueryKey() }),
      extraRepairId ? queryClient.invalidateQueries({ queryKey: getRepairsGetQueryKey(extraRepairId) }) : Promise.resolve(),
    ]);
  };

  const fail = (err: any, fallback: string) => {
    setActionError(err?.data?.message ?? fallback);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const onAccept = () => runOnce(async () => {
    if (!id) return;
    setActionError('');
    try {
      const res = await accept.mutateAsync({ id });
      await invalidate(request?.sourceRepairId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (res.repair?.id) router.replace(`/(tabs)/repairs/${res.repair.id}` as any);
    } catch (err) {
      fail(err, 'Could not accept this request. Please try again.');
    }
  });

  const onDecline = () => runOnce(async () => {
    if (!id) return;
    setActionError('');
    try {
      await decline.mutateAsync({ id, data: { reason: reason.trim() || undefined } });
      await invalidate(request?.sourceRepairId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowDecline(false);
    } catch (err) {
      fail(err, 'Could not decline this request. Please try again.');
    }
  });

  const onCancel = () => {
    if (!id || !request) return;
    confirm({
      title: 'Cancel this request?',
      message: `${request.receiver.businessName} will no longer be able to accept ${request.device.brand} ${request.device.model}.`,
      caption: 'Your repair record is not affected. You can send it to a dealer again later.',
      icon: 'slash',
      actions: [
        {
          label: 'Cancel request',
          description: 'Withdraw the offer before it is accepted',
          tone: 'destructive',
          onPress: () => runOnce(async () => {
            setActionError('');
            try {
              await cancel.mutateAsync({ id });
              await invalidate(request.sourceRepairId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err) {
              fail(err, 'Could not cancel this request. Please try again.');
            }
          }),
        },
      ],
      cancelLabel: 'Keep waiting',
    });
  };

  const line = request ? transferStatusLine(request, colors) : null;
  const other = request ? (request.side === 'sender' ? request.receiver : request.sender) : null;
  const d = request?.device;

  const factRows: { label: string; value?: string }[] = d
    ? [
        { label: 'Their ticket', value: d.sourceTicket },
        { label: 'Device', value: `${d.deviceType} · ${d.brand} ${d.model}` },
        { label: 'IMEI', value: d.imei },
        { label: 'IMEI 2', value: d.imei2 },
        { label: 'Serial', value: d.serialNumber },
        { label: 'Colour', value: d.color },
        { label: 'Storage / RAM', value: [d.storage, d.ram].filter(Boolean).join(' / ') || undefined },
        { label: 'Problem', value: d.problem },
        { label: 'Condition', value: d.deviceCondition },
        { label: 'Accessories', value: d.accessoriesList?.length ? d.accessoriesList.join(', ') : d.accessories },
        { label: 'Priority', value: d.priority },
        { label: 'Received by them on', value: d.receiveDate ? formatDate(d.receiveDate) : undefined },
        { label: 'Photos', value: d.photoCount > 0 ? `${d.photoCount} device photo${d.photoCount === 1 ? '' : 's'} will be copied` : undefined },
      ].filter((row) => !!row.value)
    : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + layout.rowPaddingVertical }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}>
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {request?.side === 'receiver' ? 'Incoming Request' : 'Transfer Request'}
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {request?.side === 'receiver' ? 'Nothing enters your queue until you accept' : 'Your record stays unchanged until they accept'}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {isLoading && !data ? (
        <DataLoadingState />
      ) : error && !data ? (
        <DataErrorState onRetry={() => { void refetch(); }} />
      ) : !request || !line || !other || !d ? null : (
        <ScrollView contentContainerStyle={{ padding: layout.screenPadding, paddingBottom: insets.bottom + space.xxxl, gap: space.md }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={[styles.stateBadge, { backgroundColor: line.color + '14' }]} testID="transfer-state">
            <Feather name={line.icon} size={14} color={line.color} />
            <Text style={{ ...font.captionStrong, color: line.color, flexShrink: 1 }}>{line.label}</Text>
          </View>

          <FlatCard style={{ padding: 14, gap: 6 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {request.side === 'sender' ? 'SENDING TO' : request.status === 'accepted' ? 'RECEIVED FROM' : 'REQUEST FROM'}
            </Text>
            <Text style={{ ...font.itemTitle, color: colors.foreground }}>{other.businessName}</Text>
            <Text style={{ ...font.captionStrong, color: colors.mutedForeground }}>
              Owner {other.ownerName}
            </Text>
            <Text style={{ ...font.caption, color: colors.mutedForeground }}>
              Sent by {request.sentByName} · {formatDateTime(request.createdAt)}
            </Text>
            {!!request.message && (
              <View style={[styles.note, { backgroundColor: colors.primary + '0F', borderColor: colors.primary + '22' }]}>
                <Feather name="message-square" size={13} color={colors.primary} />
                <Text style={{ ...font.body, color: colors.foreground, flex: 1 }}>{request.message}</Text>
              </View>
            )}
            {!!request.respondedAt && (
              <Text style={{ ...font.caption, color: colors.mutedForeground }}>
                {request.status === 'cancelled' ? 'Cancelled' : request.status === 'declined' ? 'Declined' : 'Accepted'}
                {request.respondedByName ? ` by ${request.respondedByName}` : ''} · {formatDateTime(request.respondedAt)}
              </Text>
            )}
            {!!request.declineReason && (
              <Text style={{ ...font.captionStrong, color: colors.destructive }} testID="transfer-decline-reason">
                Reason: {request.declineReason}
              </Text>
            )}
          </FlatCard>

          <FlatCard style={{ padding: 14, gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DEVICE DETAILS (AS SAVED BY THE SENDER)</Text>
            {factRows.map((row) => (
              <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ ...font.captionStrong, color: colors.mutedForeground }}>{row.label}</Text>
                <Text style={{ ...font.captionStrong, color: colors.foreground, flex: 1, textAlign: 'right' }}>{row.value}</Text>
              </View>
            ))}
            {request.side === 'receiver' && request.status === 'pending' && (
              <Text style={{ ...font.small, color: colors.mutedForeground }}>
                On accept, a new repair is created in your shop with exactly these details — no form to fill. The sender's customer is not shared; the customer on your record will be {other.businessName}.
              </Text>
            )}
          </FlatCard>

          {!!actionError && (
            <Text style={{ ...font.captionStrong, color: colors.destructive }} testID="transfer-action-error">{actionError}</Text>
          )}

          {request.status === 'pending' && request.side === 'receiver' && (
            canRespond ? (
              <View style={{ gap: 10 }}>
                {showDecline ? (
                  <View style={{ gap: 10 }}>
                    <Input
                      label="Reason (optional, shown to the sender)"
                      value={reason}
                      onChangeText={(t) => setReason(t.slice(0, 500))}
                      placeholder="e.g. No parts for this model right now"
                      leftIcon="message-square"
                      multiline
                    />
                    <Button title="Decline request" variant="destructive" onPress={onDecline} loading={decline.isPending} fullWidth testID="transfer-decline-confirm" />
                    <Button title="Back" variant="ghost" onPress={() => setShowDecline(false)} fullWidth />
                  </View>
                ) : (
                  <>
                    <Button title="Accept · add to my Received list" onPress={onAccept} loading={accept.isPending} fullWidth size="lg" testID="transfer-accept" />
                    <Button title="Decline" variant="outline" onPress={() => setShowDecline(true)} disabled={accept.isPending} fullWidth testID="transfer-decline" />
                  </>
                )}
              </View>
            ) : (
              <View style={[styles.note, { backgroundColor: colors.warning + '14', borderColor: colors.warning + '33' }]}>
                <Feather name="lock" size={13} color={colors.warning} />
                <Text style={{ ...font.caption, color: colors.foreground, flex: 1 }}>
                  Only staff with the “update repairs” permission can accept or decline. Ask your shop owner.
                </Text>
              </View>
            )
          )}

          {request.status === 'pending' && request.side === 'sender' && (
            <View style={{ gap: 10 }}>
              {!!request.sourceRepairId && (
                <Button title="Open my repair record" variant="outline" onPress={() => router.push(`/(tabs)/repairs/${request.sourceRepairId}` as any)} fullWidth />
              )}
              {canRespond && (
                <Button title="Cancel request" variant="destructive" onPress={onCancel} loading={cancel.isPending} fullWidth testID="transfer-cancel" />
              )}
            </View>
          )}

          {request.status === 'accepted' && !!request.resultRepairId && (
            <Button
              title={request.side === 'receiver' ? 'Open the repair' : 'Open shared transaction'}
              onPress={() =>
                router.push(
                  (request.side === 'receiver'
                    ? `/(tabs)/repairs/${request.resultRepairId}`
                    : `/(tabs)/repairs/dealer-transactions/${request.resultRepairId}`) as any,
                )
              }
              fullWidth
              size="lg"
              testID="transfer-open-result"
            />
          )}

          {(request.status === 'declined' || request.status === 'cancelled') && request.side === 'sender' && !!request.sourceRepairId && (
            <View style={{ gap: 10 }}>
              <Button title="Open my repair record" variant="outline" onPress={() => router.push(`/(tabs)/repairs/${request.sourceRepairId}` as any)} fullWidth />
              {canRespond && (
                <Button
                  title="Send to another dealer"
                  onPress={() => router.push({ pathname: '/(tabs)/repairs/dealer-transactions/send', params: { repairId: request.sourceRepairId } } as any)}
                  fullWidth
                  testID="transfer-resend"
                />
              )}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingBottom: space.md, gap: space.sm },
  backBtn: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  headerSub: { ...font.caption },
  sectionLabel: { ...font.overline },
  stateBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 4 },
});
