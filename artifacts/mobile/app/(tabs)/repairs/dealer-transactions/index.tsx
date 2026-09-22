import React, { useMemo, useState } from 'react';
import { FlatList, Platform, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { FlatCard } from '@/components/ui/FlatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState } from '@/components/ui/DataStates';
import { RepairStatusBadge } from '@/components/ui/Badge';
import { TransferRequestCard } from '@/components/dealer/TransferRequestCard';
import { useDealerTransactionsList, useDealerTransfersList } from '@workspace/api-client-react';
import type { DealerTransactionsListDirection, DealerTransferRequest } from '@workspace/api-client-react';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

type Direction = 'incoming' | 'outgoing';
type StatusFilter = 'all' | 'in_repair' | 'ready' | 'completed';

const IN_REPAIR_STATUSES = ['diagnosing', 'waiting_parts', 'repairing', 'testing', 'customer_approval'];

// A private ledger of devices this shop sent to (or received from) another
// registered shop. Direction is the real split in the data model — status
// filter chips are a client-side view on top of whichever direction is open.
//
// Above the accepted transactions sit the transfer REQUESTS for the same
// direction: Incoming = devices other dealers want to send us (accept /
// decline); Outgoing = devices we offered and are waiting on (cancel).
export default function DealerTransactionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { canAccess } = useAuth();
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const [direction, setDirection] = useState<Direction>('incoming');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showHistory, setShowHistory] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useDealerTransactionsList({
    direction: direction as DealerTransactionsListDirection,
    limit: 50,
  });
  const requestsQuery = useDealerTransfersList({ direction, limit: 50 });
  const allRepairs = data?.repairs ?? [];

  const repairs = useMemo(() => {
    if (statusFilter === 'all') return allRepairs;
    if (statusFilter === 'in_repair') return allRepairs.filter((r: any) => IN_REPAIR_STATUSES.includes(r.status));
    if (statusFilter === 'ready') return allRepairs.filter((r: any) => r.status === 'ready');
    return allRepairs.filter((r: any) => r.status === 'delivered');
  }, [allRepairs, statusFilter]);

  const requests = requestsQuery.data?.requests ?? [];
  const pendingRequests = useMemo(() => requests.filter((r) => r.status === 'pending'), [requests]);
  const settledRequests = useMemo(
    () => requests.filter((r) => r.status === 'declined' || r.status === 'cancelled'),
    [requests],
  );
  const canRespond = canAccess('repairs_update');

  const refreshAll = () => {
    void refetch();
    void requestsQuery.refetch();
  };

  const openRequest = (r: DealerTransferRequest) =>
    router.push(`/(tabs)/repairs/dealer-transactions/request/${r.id}` as any);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + layout.rowPaddingVertical }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}
        >
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Dealer Transactions</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            Devices sent to and received from other shops
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.segmentRow}>
        {(['incoming', 'outgoing'] as Direction[]).map((d) => {
          const pendingCount = d === direction ? pendingRequests.length : 0;
          return (
            <TouchableOpacity
              key={d}
              testID={`dealer-txn-tab-${d}`}
              accessibilityRole="button"
              onPress={() => { setDirection(d); setStatusFilter('all'); setShowHistory(false); }}
              style={[
                styles.segment,
                { backgroundColor: direction === d ? colors.primary : colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={{ ...font.labelStrong, color: direction === d ? colors.primaryForeground : colors.foreground }}>
                {d === 'incoming' ? 'Incoming' : 'Outgoing'}
                {pendingCount > 0 ? ` (${pendingCount})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.chipRow}>
        {([
          { key: 'all', label: 'All' },
          { key: 'in_repair', label: 'In Repair' },
          { key: 'ready', label: 'Ready' },
          { key: 'completed', label: 'Completed' },
        ] as { key: StatusFilter; label: string }[]).map((c) => (
          <TouchableOpacity
            key={c.key}
            onPress={() => setStatusFilter(c.key)}
            style={[
              styles.chip,
              {
                backgroundColor: statusFilter === c.key ? colors.primary + '1A' : 'transparent',
                borderColor: statusFilter === c.key ? colors.primary : colors.border,
              },
            ]}
          >
             <Text style={{ ...font.captionStrong, color: statusFilter === c.key ? colors.primary : colors.mutedForeground }}>
              {c.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading && !data ? (
        <DataLoadingState />
      ) : error && !data ? (
        <DataErrorState onRetry={refreshAll} />
      ) : (
        <FlatList
          data={repairs}
          keyExtractor={(r: any) => r.id}
           contentContainerStyle={{ paddingHorizontal: layout.screenPadding, paddingBottom: insets.bottom + space.xxxl, gap: space.md }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isFetching && !!data} onRefresh={refreshAll} tintColor={colors.primary} />}
          ListHeaderComponent={
            statusFilter === 'all' && (pendingRequests.length > 0 || settledRequests.length > 0) ? (
               <View style={{ gap: space.md, marginBottom: space.sm }} testID={`transfer-requests-${direction}`}>
                {pendingRequests.length > 0 && (
                  <>
                     <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>
                      {direction === 'incoming' ? 'INCOMING REQUESTS · ACCEPT TO ADD TO YOUR QUEUE' : 'WAITING FOR THE OTHER DEALER'}
                    </Text>
                    {pendingRequests.map((r) => (
                      <TransferRequestCard key={r.id} request={r} canRespond={canRespond} onPress={() => openRequest(r)} />
                    ))}
                  </>
                )}
                {settledRequests.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setShowHistory((v) => !v)}
                    accessibilityRole="button"
                    testID="transfer-history-toggle"
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}
                  >
                    <Feather name={showHistory ? 'chevron-down' : 'chevron-right'} size={14} color={colors.mutedForeground} />
                    <Text style={{ ...font.captionStrong, color: colors.mutedForeground }}>
                      {settledRequests.length} declined / cancelled request{settledRequests.length === 1 ? '' : 's'}
                    </Text>
                  </TouchableOpacity>
                )}
                {showHistory && settledRequests.map((r) => (
                  <TransferRequestCard key={r.id} request={r} canRespond={false} onPress={() => openRequest(r)} />
                ))}
                {repairs.length > 0 && (
                   <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>
                    {direction === 'incoming' ? 'ACCEPTED · IN YOUR QUEUE' : 'ACCEPTED · WITH THE OTHER DEALER'}
                  </Text>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            pendingRequests.length > 0 && statusFilter === 'all' ? null : (
              <EmptyState
                icon="repeat"
                title={direction === 'incoming' ? 'No devices sent to you yet' : 'No devices sent out yet'}
                description={
                  direction === 'incoming'
                    ? 'When another dealer sends you a device, it appears here as a request first. Nothing enters your queue until you accept.'
                    : 'Long-press any repair in your Received or Repair list and choose “Send to Dealer”.'
                }
              />
            )
          }
          renderItem={({ item }: { item: any }) => (
            <TouchableOpacity
              onPress={() => router.push(`/(tabs)/repairs/dealer-transactions/${item.id}` as any)}
              activeOpacity={0.8}
              testID={`dealer-txn-card-${item.id}`}
            >
              <FlatCard style={{ padding: space.xl, gap: space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: layout.avatarGap }}>
                  <View style={[styles.avatar, { backgroundColor: colors.primary + '1A' }]}>
                    <Feather name={direction === 'incoming' ? 'download' : 'upload'} size={size.headerIcon} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ ...font.itemTitle, color: colors.foreground }} numberOfLines={1}>
                      {item.brand} {item.model}
                    </Text>
                    <Text style={{ ...font.captionStrong, color: colors.mutedForeground }} numberOfLines={1}>
                      {item.transactionCode ? `${item.transactionCode} · ` : ''}
                      {direction === 'incoming'
                        ? `From ${item.sourceDealerBusinessName ?? 'another shop'}`
                        : `Repair ticket ${item.repairId}`}
                    </Text>
                  </View>
                  <RepairStatusBadge status={item.status} />
                </View>
                {!!item.problem && (
                  <Text style={{ ...font.body, color: colors.mutedForeground }} numberOfLines={1}>
                    {item.problem}
                  </Text>
                )}
                <View style={[styles.pendingBadge, { backgroundColor: colors.success + '1A' }]}>
                  <Feather name="check-circle" size={11} color={colors.success} />
                  <Text style={{ ...font.captionStrong, color: colors.success }}>
                    {direction === 'incoming' ? 'Accepted' : 'Accepted by the other dealer'}
                  </Text>
                </View>
              </FlatCard>
            </TouchableOpacity>
          )}
        />
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
  segmentRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: layout.screenPadding, marginBottom: space.md },
  segment: { flex: 1, paddingVertical: space.md, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  chipRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: layout.screenPadding, marginBottom: space.md, flexWrap: 'wrap' },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  groupLabel: { ...font.overline, marginTop: space.xs },
  avatar: { width: size.avatar, height: size.avatar, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  pendingBadge: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm },
});
