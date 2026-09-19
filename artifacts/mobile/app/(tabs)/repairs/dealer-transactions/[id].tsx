import React from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useDealerChat } from '@/hooks/useDealerChat';
import { FlatCard } from '@/components/ui/FlatCard';
import { Button } from '@/components/ui/Button';
import { RepairStatusBadge } from '@/components/ui/Badge';
import { DataLoadingState, DataErrorState } from '@/components/ui/DataStates';
import { formatCurrency, formatDate } from '@/utils/helpers';
import type { RepairStatus } from '@/types';
import { dealerBalanceLabel, dealerEventTitle, formatDateTime } from '@/utils/dealer-ledger';
import {
  useDealerTransactionsGet,
  useDealerTransactionsReceive,
  getDealerTransactionsListQueryKey,
  getDealerTransactionsLedgerQueryKey,
  type RepairPayment,
  type Refund,
} from '@workspace/api-client-react';

// The ONE shared dealer-to-dealer transaction, read by either party. Both
// shops see the same code, the same acceptance state, the same money and the
// same timeline — only the wording flips to match which side you are on.
export default function DealerTransactionDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { canAccess } = useAuth();
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const { data, isLoading, error, refetch } = useDealerTransactionsGet(id ?? '', {
    query: { enabled: !!id },
  } as any);
  const receiveMutation = useDealerTransactionsReceive();
  const { openChat, busy: chatBusy } = useDealerChat();

  const repair = data?.repair;
  const counterpart = data?.counterpart;
  const isReceiver = data?.side === 'receiver';
  const waiting = data?.acceptance === 'waiting';
  // Money fields are omitted by the server for staff without the payments
  // feature; the local check only decides whether to render the section.
  const financials = data?.financials;
  const payments = data?.payments ?? [];
  const refunds = data?.refunds ?? [];
  const canSeeMoney = canAccess('payments');
  const ledgerDirection = isReceiver ? 'receivable' : 'payable';

  const markReceived = async () => {
    if (!id) return;
    try {
      await receiveMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getDealerTransactionsListQueryKey() });
      queryClient.invalidateQueries({ queryKey: getDealerTransactionsLedgerQueryKey() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void refetch();
    } catch (err: any) {
      Alert.alert('Could not confirm receipt', err?.data?.message ?? 'Please try again.');
    }
  };

  const openLedger = () => {
    if (!counterpart) return;
    router.push({
      pathname: '/(tabs)/khata/dealer/[shopId]',
      params: {
        shopId: counterpart.shopId,
        direction: isReceiver ? 'receivable' : 'payable',
        name: counterpart.businessName,
      },
    } as any);
  };

  const openEntry = (entryId: string) => {
    if (!counterpart || !repair) return;
    router.push({
      pathname: '/(tabs)/khata/transaction',
      params: {
        scope: 'dealer',
        entryId,
        repairId: repair.id,
        shopId: counterpart.shopId,
        direction: isReceiver ? 'receivable' : 'payable',
        name: counterpart.businessName,
      },
    } as any);
  };

  const paidLabel = isReceiver ? 'You Received' : 'You Paid';
  // Derived from the SIGN of the balance, not just which side we are on: a
  // payment recorded before the bill posts leaves the payer in credit.
  const balanceLabel = financials ? dealerBalanceLabel(ledgerDirection, financials.balance) : 'Settled';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]} accessibilityLabel="Go back">
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>{data?.transactionCode ?? 'Transaction'}</Text>
          {!!repair && (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]} numberOfLines={1}>
              {repair.brand} {repair.model}{repair.repairId ? ` · ${repair.repairId}` : ''}
            </Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      {isLoading && !data ? (
        <DataLoadingState />
      ) : error && !data ? (
        <DataErrorState onRetry={() => { void refetch(); }} />
      ) : !repair || !data ? null : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 40, gap: 12 }} showsVerticalScrollIndicator={false}>
          {/* Acceptance state — explicit, never implied by status */}
          <View style={[styles.acceptanceBadge, { backgroundColor: (waiting ? colors.warning : colors.success) + '14' }]}>
            <Feather name={waiting ? 'clock' : 'check-circle'} size={14} color={waiting ? colors.warning : colors.success} />
            <Text style={{ fontSize: 12, color: waiting ? colors.warning : colors.success, fontFamily: 'Inter_600SemiBold', flexShrink: 1 }}>
              {waiting
                ? 'Waiting for Acceptance'
                : `Received${repair.sourceDealerReceivedAt ? ` on ${formatDateTime(repair.sourceDealerReceivedAt)}` : ''}${repair.receivedByName ? ` by ${repair.receivedByName}` : ''}`}
            </Text>
          </View>

          <FlatCard style={{ padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: 'Inter_700Bold', flex: 1 }}>{repair.brand} {repair.model}</Text>
              <RepairStatusBadge status={repair.status as RepairStatus} />
            </View>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{repair.deviceType}</Text>
            {!!repair.imei && <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>IMEI {repair.imei}</Text>}
            {!!repair.serialNumber && <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Serial {repair.serialNumber}</Text>}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_500Medium' }}>{repair.problem}</Text>
            {!!repair.diagnosis && (
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Diagnosis: {repair.diagnosis}</Text>
            )}
            {!!repair.workPerformed && (
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Work: {repair.workPerformed}</Text>
            )}
            {!!repair.expectedDate && (
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Expected by {formatDate(repair.expectedDate)}</Text>
            )}
            {isReceiver && (
              <TouchableOpacity
                onPress={() => router.push(`/(tabs)/repairs/${repair.id}` as any)}
                style={styles.inlineLink}
                accessibilityRole="button"
              >
                <Feather name="tool" size={14} color={colors.primary} />
                <Text style={{ fontSize: 13, color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Open repair record</Text>
              </TouchableOpacity>
            )}
          </FlatCard>

          {!!counterpart && (
            <FlatCard style={{ padding: 14, gap: 10 }}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                {isReceiver ? 'SOURCE DEALER' : 'REPAIRING SHOP'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.avatar, { backgroundColor: colors.primary + '1A' }]}>
                  <Feather name="briefcase" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{counterpart.businessName}</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{counterpart.ownerName} · {counterpart.ownerMobile}</Text>
                </View>
                <TouchableOpacity
                  accessibilityLabel={`Call ${counterpart.businessName}`}
                  onPress={() => { void Linking.openURL(`tel:${counterpart.ownerMobile}`); }}
                  style={[styles.iconBtn, { backgroundColor: colors.success + '1A' }]}
                >
                  <Feather name="phone-call" size={15} color={colors.success} />
                </TouchableOpacity>
              </View>
              <Button
                title="Chat about this transaction"
                variant="secondary"
                onPress={() => { void openChat(counterpart, { transactionCode: data.transactionCode }); }}
                loading={chatBusy}
                fullWidth
              />
            </FlatCard>
          )}

          {isReceiver && waiting && (
            <FlatCard style={{ padding: 14, gap: 10, borderColor: colors.warning + '44', borderWidth: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="clock" size={16} color={colors.warning} />
                <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Confirm physical receipt</Text>
              </View>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                Work cannot start until you confirm the device from {counterpart?.businessName ?? 'the source dealer'} has physically arrived.
              </Text>
              <Button title="Accept & Mark as Received" onPress={markReceived} loading={receiveMutation.isPending} fullWidth />
            </FlatCard>
          )}

          {canSeeMoney && !!financials && (
            <FlatCard style={{ padding: 14, gap: 8 }}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>MONEY</Text>
              {financials.billPosted ? (
                <TouchableOpacity onPress={() => openEntry(`bill:${repair.id}`)} accessibilityRole="button" style={styles.moneyRow}>
                  <Text style={[styles.moneyLabel, { color: colors.mutedForeground }]}>Repair Bill</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.moneyValue, { color: colors.foreground }]}>{formatCurrency(financials.billed)}</Text>
                    <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={styles.moneyRow}>
                  <Text style={[styles.moneyLabel, { color: colors.mutedForeground }]}>Estimated total</Text>
                  <Text style={[styles.moneyValue, { color: colors.foreground }]}>{formatCurrency(financials.liveTotal)}</Text>
                </View>
              )}
              <View style={styles.moneyRow}>
                <Text style={[styles.moneyLabel, { color: colors.mutedForeground }]}>{paidLabel}</Text>
                <Text style={[styles.moneyValue, { color: colors.foreground }]}>{formatCurrency(financials.paid)}</Text>
              </View>
              {financials.refunded > 0 && (
                <View style={styles.moneyRow}>
                  <Text style={[styles.moneyLabel, { color: colors.mutedForeground }]}>Refunded</Text>
                  <Text style={[styles.moneyValue, { color: colors.foreground }]}>{formatCurrency(financials.refunded)}</Text>
                </View>
              )}
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.moneyRow}>
                <Text style={[styles.moneyLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {balanceLabel}
                </Text>
                <Text style={[styles.moneyValue, { color: balanceLabel === 'You Owe' ? colors.destructive : colors.success, fontSize: 16 }]}>
                  {formatCurrency(Math.abs(financials.balance))}
                </Text>
              </View>
              {!financials.billPosted && (
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                  The bill posts to the ledger once the repair is marked ready.
                </Text>
              )}
              {!!counterpart && (
                <TouchableOpacity onPress={openLedger} style={styles.inlineLink} accessibilityRole="button">
                  <Feather name="book-open" size={14} color={colors.primary} />
                  <Text style={{ fontSize: 13, color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>
                    Open {counterpart.businessName} ledger
                  </Text>
                </TouchableOpacity>
              )}
            </FlatCard>
          )}

          {canSeeMoney && (payments.length > 0 || refunds.length > 0) && (
            <FlatCard style={{ padding: 14, gap: 4 }}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 6 }]}>PAYMENTS</Text>
              {payments.map((p: RepairPayment, i) => {
                const voided = !!p.voidedAt;
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => openEntry(`payment:${p.id}`)}
                    accessibilityRole="button"
                    style={[styles.listRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_600SemiBold', textDecorationLine: voided ? 'line-through' : 'none' }}>
                        {voided ? 'Payment Voided' : paidLabel}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                        {formatDateTime(p.createdAt)} · {p.method}{p.receivedByName ? ` · ${p.receivedByName}` : ''}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 14, color: voided ? colors.mutedForeground : colors.foreground, fontFamily: 'Inter_700Bold' }}>
                      {formatCurrency(p.amount)}
                    </Text>
                    <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                );
              })}
              {refunds.map((r: Refund, i) => (
                <TouchableOpacity
                  key={r.id}
                  onPress={() => openEntry(`refund:${r.id}`)}
                  accessibilityRole="button"
                  style={[styles.listRow, (i > 0 || payments.length > 0) && { borderTopWidth: 1, borderTopColor: colors.border }]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>
                      {isReceiver ? 'Refund By You' : 'Refund To You'}{r.status !== 'paid' ? ` · ${r.status}` : ''}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                      {formatDateTime(r.paidAt ?? r.createdAt)} · {r.method}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{formatCurrency(r.amount)}</Text>
                  <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </FlatCard>
          )}

          {data.events.length > 0 && (
            <FlatCard style={{ padding: 14, gap: 0 }}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 8 }]}>TIMELINE</Text>
              {data.events.map((ev, i) => {
                const last = i === data.events.length - 1;
                return (
                  <View key={ev.id} style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ alignItems: 'center', width: 14 }}>
                      <View style={[styles.dot, { backgroundColor: last ? colors.primary : colors.border }]} />
                      {!last && <View style={[styles.line, { backgroundColor: colors.border }]} />}
                    </View>
                    <View style={{ flex: 1, paddingBottom: last ? 0 : 14 }}>
                      <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: last ? 'Inter_600SemiBold' : 'Inter_500Medium' }}>
                        {dealerEventTitle(ev)}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                        {formatDateTime(ev.createdAt)}{ev.userName ? ` · ${ev.userName}` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </FlatCard>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  backBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  sectionLabel: { fontSize: 10, letterSpacing: 1, fontFamily: 'Inter_600SemiBold' },
  divider: { height: 1, width: '100%' },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  acceptanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  inlineLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 },
  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  moneyLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  moneyValue: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  line: { width: 2, flex: 1, marginTop: 2 },
});
