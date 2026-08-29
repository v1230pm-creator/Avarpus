import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { FlatCard } from '@/components/ui/Glass';
import { RepairStatusBadge, PriorityBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState } from '@/components/ui/DataStates';
import { Repair } from '@/types';
import { isDealerPortalRole } from '@/types';
import { formatCurrency, formatDate } from '@/utils/helpers';
import {
  useDealersGet,
  useRepairsList,
  getRepairsListQueryKey,
} from '@workspace/api-client-react';

const STATUS_FILTERS = ['All', 'Received', 'Repair', 'Ready', 'Delivered'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function StatCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: keyof typeof Feather.glyphMap }) {
  const colors = useColors();
  return (
    <FlatCard style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: color + '18' }]}>
        <Feather name={icon} size={14} color={color} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]} numberOfLines={1}>{label}</Text>
    </FlatCard>
  );
}

export default function DealerProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, canAccess } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [page, setPage] = useState(1);
  const [accumulated, setAccumulated] = useState<Repair[]>([]);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter]);

  const { data: profile, isLoading: profileLoading, error: profileError, refetch: profileRefetch } = useDealersGet(id!);

  const statusQuery =
    statusFilter === 'Received' ? 'received'
    : statusFilter === 'Repair' ? 'diagnosing,waiting_parts,repairing,testing,customer_approval,cannot_repair'
    : statusFilter === 'Ready' ? 'ready'
    : statusFilter === 'Delivered' ? 'delivered'
    : undefined;

  const repairsParams: any = {
    dealerId: id,
    q: debouncedSearch || undefined,
    status: statusQuery,
    page,
    limit: 20,
  };

  const {
    data: repairsData,
    isLoading: repairsLoading,
    error: repairsError,
    refetch: repairsRefetch,
    isFetching: repairsFetching,
  } = useRepairsList(repairsParams, {
    query: { queryKey: getRepairsListQueryKey(repairsParams) },
  });

  React.useEffect(() => {
    if (repairsData?.repairs) {
      if (page === 1) setAccumulated(repairsData.repairs as Repair[]);
      else setAccumulated((prev) => {
        const fresh = (repairsData.repairs as Repair[]).filter((r) => !prev.find((p) => p.id === r.id));
        return [...prev, ...fresh];
      });
    }
  }, [repairsData, page]);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const dealer = profile?.dealer;
  const stats = profile?.stats;

  const onRefresh = async () => { await Promise.all([profileRefetch(), repairsRefetch()]); };

  const header = useMemo(() => (
    <View style={{ gap: 10 }}>
      {dealer && (
        <FlatCard style={{ padding: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={[styles.avatar, { backgroundColor: colors.primary + '18' }]}>
              <Feather name="briefcase" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{dealer.name}</Text>
              {!!dealer.shopName && (
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{dealer.shopName}</Text>
              )}
            </View>
            <View style={[styles.codeBadge, { backgroundColor: colors.primary + '15' }]}>
              <Text style={{ fontSize: 10, color: colors.primary, fontFamily: 'Inter_700Bold' }}>{dealer.dealerCode}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Feather name="phone" size={10} color={colors.mutedForeground} />
              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{dealer.mobile}</Text>
            </View>
            {!!dealer.location && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="map-pin" size={10} color={colors.mutedForeground} />
                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{dealer.location}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Feather name="calendar" size={10} color={colors.mutedForeground} />
              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Since {formatDate(dealer.createdAt)}</Text>
            </View>
          </View>
          {!isDealerPortalRole(user?.role) && (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, width: '100%' }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: colors.primary, paddingVertical: 10, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                onPress={() =>
                  router.push(
                    `/(tabs)/customers/chat/${dealer.id}?targetId=${dealer.id}&type=dealer&name=${encodeURIComponent(dealer.name)}`,
                  )
                }
                activeOpacity={0.8}
              >
                <Feather name="message-square" size={14} color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 13 }}>Message</Text>
              </TouchableOpacity>
              {canAccess('payments') && (
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                  onPress={() => router.push(`/(tabs)/khata/party/dealer/${dealer.id}?name=${encodeURIComponent(dealer.name)}`)}
                  activeOpacity={0.8}
                >
                  <Feather name="book" size={14} color={colors.foreground} />
                  <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 13 }}>Khata</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </FlatCard>
      )}

      {stats && (
        <View style={styles.statsGrid}>
          <StatCard label="Total Repairs" value={String(stats.totalRepairs)} color={colors.primary} icon="tool" />
          <StatCard label="In Progress" value={String(stats.received + stats.repairing)} color={colors.warning} icon="clock" />
          <StatCard label="Ready" value={String(stats.ready)} color={colors.info} icon="check-circle" />
          <StatCard label="Delivered" value={String(stats.delivered)} color={colors.success} icon="package" />
          <StatCard label="Repair Value" value={formatCurrency(stats.totalRepairValue)} color={colors.primary} icon="bar-chart-2" />
          <StatCard label="Pending Amount" value={formatCurrency(stats.pendingAmount)} color={stats.pendingAmount > 0 ? colors.warning : colors.success} icon="credit-card" />
          <StatCard label="After-Sale Returns" value={String(stats.afterSaleReturns)} color={colors.destructive} icon="corner-up-left" />
          <StatCard label="Refunded" value={formatCurrency(stats.refundedAmount)} color={colors.destructive} icon="rotate-ccw" />
        </View>
      )}

      <FlatCard style={styles.searchBar}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search this dealer's repairs..."
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </FlatCard>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f;
          return (
            <TouchableOpacity
              key={f}
              onPress={() => setStatusFilter(f)}
              activeOpacity={0.8}
              style={[styles.filterTab, {
                backgroundColor: active ? colors.primary : colors.primary + '12',
                borderColor: active ? colors.primary : 'transparent',
              }]}
            >
              <Text style={{ fontSize: 13, color: active ? '#FFFFFF' : colors.mutedForeground, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium' }}>{f}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  ), [dealer, stats, search, statusFilter, colors]);

  if (profileLoading && !profile) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>

        <DataLoadingState />
      </View>
    );
  }
  if (profileError && !profile) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>

        <DataErrorState onRetry={onRefresh} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Dealer Profile</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {repairsData?.total ?? 0} repairs
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={accumulated}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 100, gap: 10 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={repairsLoading && page === 1} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          repairsLoading ? null : (
            <EmptyState
              icon="tool"
              title="No repairs yet"
              description={search ? 'Try a different search term' : 'Repairs linked to this dealer will appear here'}
            />
          )
        }
        ListFooterComponent={
          repairsFetching && accumulated.length > 0 ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
          ) : null
        }
        onEndReached={() => {
          if (repairsData?.total && accumulated.length < repairsData.total && !repairsFetching) {
            setPage((p) => p + 1);
          }
        }}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => {
          const total = item.repairCharge + item.partsCharge;
          const balance = Math.max(0, total - item.advance);
          return (
            <TouchableOpacity onPress={() => router.push(`/(tabs)/repairs/${item.id}`)} activeOpacity={0.8}>
              <FlatCard style={{ padding: 12, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={[styles.codeBadge, { backgroundColor: colors.primary + '15' }]}>
                    <Text style={{ fontSize: 10, color: colors.primary, fontFamily: 'Inter_700Bold' }}>{item.repairId}</Text>
                  </View>
                  <PriorityBadge priority={item.priority} />
                  <RepairStatusBadge status={item.status} />
                </View>
                <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{item.customerName}</Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                  {item.deviceType} · {item.brand} {item.model}
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                    Total: {formatCurrency(total)}{balance > 0 ? '' : ' · Paid'}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{formatDate(item.createdAt)}</Text>
                </View>
                {balance > 0 && (
                  <Text style={{ fontSize: 11, color: colors.warning, fontFamily: 'Inter_600SemiBold' }}>Pending: {formatCurrency(balance)}</Text>
                )}
              </FlatCard>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  backBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20 },
  headerSub: { fontSize: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  codeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { width: '48%', flexGrow: 1, padding: 10, gap: 4 },
  statIcon: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 14 },
  statLabel: { fontSize: 10 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 40, fontSize: 13 },
  filterTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
});
