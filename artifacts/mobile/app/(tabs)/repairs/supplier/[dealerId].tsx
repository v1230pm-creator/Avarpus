import React, { useMemo, useState } from 'react';
import {
  FlatList,
  LayoutAnimation,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { useColors } from '@/hooks/useColors';
import { FlatCard } from '@/components/ui/FlatCard';
import { RepairStatusBadge, PriorityBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataErrorState } from '@/components/ui/DataStates';
import { Repair } from '@/types';
import { formatCurrency, formatDate } from '@/utils/helpers';
import {
  useDealersSuppliersRepairsList,
  getDealersSuppliersRepairsListQueryKey,
} from '@workspace/api-client-react';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const STATUS_FILTERS = ['All', 'Received', 'Repair', 'Ready', 'Delivered'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

// Read-only view of the repairs one supplier shop has booked against me as
// their dealer. Repair rows come from the supplier's shop, so the regular
// repair detail route (own-shop scoped) cannot open them: each card expands
// in place with the full read-only projection instead.
export default function SupplierRepairsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { dealerId, name } = useLocalSearchParams<{ dealerId: string; name?: string }>();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [page, setPage] = useState(1);
  const [accumulated, setAccumulated] = useState<Repair[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter]);

  const statusQuery =
    statusFilter === 'Received' ? 'received'
    : statusFilter === 'Repair' ? 'diagnosing,waiting_parts,repairing,testing,customer_approval,cannot_repair'
    : statusFilter === 'Ready' ? 'ready'
    : statusFilter === 'Delivered' ? 'delivered'
    : undefined;

  const params = {
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
  } = useDealersSuppliersRepairsList(dealerId as string, params, {
    query: { enabled: !!dealerId, queryKey: getDealersSuppliersRepairsListQueryKey(dealerId as string, params) },
  });
  const searchBusy = repairsFetching && search.trim().length > 0;

  React.useEffect(() => {
    if (repairsData?.repairs) {
      const rows = repairsData.repairs as unknown as Repair[];
      if (page === 1) setAccumulated(rows);
      else setAccumulated((prev) => {
        const fresh = rows.filter((r) => !prev.find((p) => p.id === r.id));
        return [...prev, ...fresh];
      });
    }
  }, [repairsData, page]);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((current) => (current === id ? null : id));
  };

  const header = useMemo(() => (
    <View style={{ gap: 10 }}>
      <FlatCard style={styles.searchBar}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <View style={{ width: 16, alignItems: 'center' }}>
          {searchBusy ? <AvarpusSpinner size={14} /> : null}
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search job no, device, problem..."
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search">
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
  ), [search, searchBusy, statusFilter, colors]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
            {name || 'Supplier repairs'}
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {repairsData ? `${repairsData.total} repairs · read-only` : 'My repairs at this shop'}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {repairsError && !repairsData ? (
        <DataErrorState onRetry={() => { void repairsRefetch(); }} />
      ) : (
        <FlatList
          data={accumulated}
          keyExtractor={(r) => r.id}
          extraData={expandedId}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 100, gap: 10 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={repairsFetching && page === 1 && !!repairsData} onRefresh={() => { void repairsRefetch(); }} tintColor={colors.primary} />}
          ListEmptyComponent={
            repairsLoading ? null : (
              <EmptyState
                icon="tool"
                title="No repairs here yet"
                description={search ? 'Try a different search term' : 'Repairs this shop books under your dealer record will appear here'}
              />
            )
          }
          ListFooterComponent={
            repairsFetching && accumulated.length > 0 ? (
              <AvarpusSpinner size={20} style={{ marginVertical: 20 }} />
            ) : null
          }
          onEndReached={() => {
            if (repairsData?.total && accumulated.length < repairsData.total && !repairsFetching) {
              setPage((p) => p + 1);
            }
          }}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <SupplierRepairCard repair={item} expanded={expandedId === item.id} onPress={() => toggle(item.id)} />
          )}
        />
      )}
    </View>
  );
}

function SupplierRepairCard({ repair, expanded, onPress }: { repair: Repair; expanded: boolean; onPress: () => void }) {
  const colors = useColors();
  // Portal projection always carries totals; the fallbacks only guard older
  // API builds that predate them.
  const total = repair.totalAmount ?? (repair.repairCharge ?? 0) + (repair.partsCharge ?? 0);
  const paid = repair.paidAmount ?? repair.advance ?? 0;
  const balance = repair.balance ?? Math.max(0, total - paid);
  const chargeRows: Array<[string, number | undefined]> = [
    ['Repair charge', repair.repairCharge],
    ['Parts', repair.partsCharge],
    ['Service', repair.serviceCharge],
    ['Other', repair.otherCharge],
    ['Discount', repair.discount ? -repair.discount : undefined],
  ];
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${repair.repairId}, ${repair.brand} ${repair.model}`}
      testID={`supplier-repair-${repair.id}`}
    >
      <FlatCard style={{ padding: 12, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={[styles.codeBadge, { backgroundColor: colors.primary + '15' }]}>
            <Text style={{ fontSize: 10, color: colors.primary, fontFamily: 'Inter_700Bold' }}>{repair.repairId}</Text>
          </View>
          <PriorityBadge priority={repair.priority} />
          <RepairStatusBadge status={repair.status} />
          <View style={{ flex: 1 }} />
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
        </View>
        <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>
          {repair.brand} {repair.model}
        </Text>
        <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }} numberOfLines={expanded ? undefined : 2}>
          {repair.deviceType} · {repair.problem}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
            Total {formatCurrency(total)}{balance > 0 ? '' : ' · Paid'}
          </Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Received {formatDate(repair.receiveDate)}</Text>
        </View>
        {balance > 0 && (
          <Text style={{ fontSize: 11, color: colors.warning, fontFamily: 'Inter_600SemiBold' }}>Pending {formatCurrency(balance)}</Text>
        )}

        {expanded && (
          <View style={[styles.details, { borderTopColor: colors.border }]}>
            <DetailRow label="Booked under" value={repair.customerName} />
            {!!repair.diagnosis && <DetailRow label="Diagnosis" value={repair.diagnosis} />}
            {!!repair.workPerformed && <DetailRow label="Work done" value={repair.workPerformed} />}
            <DetailRow label="Expected" value={formatDate(repair.expectedDate)} />
            {!!repair.repairCompletedAt && <DetailRow label="Completed" value={formatDate(repair.repairCompletedAt)} />}
            {!!repair.deliveryDate && <DetailRow label="Delivered" value={formatDate(repair.deliveryDate)} />}
            {!!repair.warrantyDays && (
              <DetailRow
                label="Warranty"
                value={`${repair.warrantyDays} days${repair.warrantyExpiry ? ` · till ${formatDate(repair.warrantyExpiry)}` : ''}`}
              />
            )}
            <View style={[styles.bill, { backgroundColor: colors.primary + '0C' }]}>
              {chargeRows.filter(([, v]) => typeof v === 'number' && v !== 0).map(([label, v]) => (
                <BillRow key={label} label={label} value={formatCurrency(v as number)} />
              ))}
              {!!repair.taxPercent && <BillRow label={`Tax ${repair.taxPercent}%`} value="" />}
              <BillRow label="Total" value={formatCurrency(total)} strong />
              <BillRow label="Paid" value={formatCurrency(paid)} />
              <BillRow label="Balance" value={formatCurrency(balance)} strong tone={balance > 0 ? colors.warning : colors.success} />
            </View>
          </View>
        )}
      </FlatCard>
    </TouchableOpacity>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Text style={{ width: 92, fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 12, color: colors.foreground, fontFamily: 'Inter_400Regular' }}>{value}</Text>
    </View>
  );
}

function BillRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  const colors = useColors();
  const color = tone ?? (strong ? colors.foreground : colors.mutedForeground);
  const fontFamily = strong ? 'Inter_700Bold' : 'Inter_500Medium';
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 12, color, fontFamily }}>{label}</Text>
      <Text style={{ fontSize: 12, color, fontFamily }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  backBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20 },
  headerSub: { fontSize: 12 },
  codeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 40, fontSize: 13 },
  filterTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  details: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 4, gap: 6 },
  bill: { borderRadius: 10, padding: 10, gap: 4, marginTop: 4 },
});
