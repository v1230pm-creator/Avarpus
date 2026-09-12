import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { RepairStatusBadge, PriorityBadge, SampleBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { FlatCard } from '@/components/ui/FlatCard';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { Avatar } from '@/components/ui/Avatar';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { Repair, isDealerPortalRole, isLinkedCustomerPortalUser } from '@/types';
import { formatDate, formatCurrency, getReturnStatusColor } from '@/utils/helpers';
import * as Network from 'expo-network';
import { offlineQueue, QueuedRepair } from '@/utils/offlineQueue';
import { useQueryClient } from '@tanstack/react-query';

import { useReturnsList, useRepairsList, getRepairsListQueryKey, useDealersList, useDealersMe, useDealersOverview, useCustomersKhataGet } from '@workspace/api-client-react';

const FILTERS = ['Received', 'Repair', 'Ready', 'Delivered', 'Dealers', 'After-Sales Service'] as const;
type Filter = (typeof FILTERS)[number];
// Dealer-portal accounts see a simplified read-only view of their own repairs.
const PORTAL_FILTERS = ['All', 'Received', 'Repair', 'Ready', 'Delivered'] as const;

function RepairCard({ repair, onPress }: { repair: Repair; onPress: () => void; }) {
  const colors = useColors();
  const total = repair.totalAmount ?? repair.repairCharge + repair.partsCharge;
  const paid = repair.paidAmount ?? repair.advance ?? 0;
  const rawBalance = repair.balance ?? total - paid;
  const balanceLabel = rawBalance > 0 ? 'Due' : rawBalance < 0 ? 'Advance' : 'Paid / Settled';
  const balanceColor = rawBalance > 0 ? colors.destructive : rawBalance < 0 ? colors.success : colors.mutedForeground;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <View style={{ padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 12, flexDirection: 'row' }}>
        
        {/* Left Icon */}
        <View style={{ marginRight: 12 }}>
          <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: colors.backgroundSecondary, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="smartphone" size={18} color={colors.mutedForeground} />
          </View>
        </View>

        {/* Center/Left Content */}
        <View style={{ flex: 1, justifyContent: 'flex-start', paddingRight: 8 }}>
          <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 2 }}>{repair.repairId}</Text>
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 4 }} numberOfLines={1}>{repair.problem}</Text>
          <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 2 }}>{repair.deviceType} · {repair.brand} {repair.model}</Text>
          <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 2 }}>{repair.customerName}</Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>{formatDate(repair.createdAt)}</Text>
        </View>

        {/* Right Content */}
        <View style={{ alignItems: 'flex-end', justifyContent: 'space-between', minWidth: 90 }}>
          <View style={{ marginBottom: 12 }}>
             <RepairStatusBadge status={repair.status} />
          </View>
          <Text style={{ fontSize: 15, color: colors.success, fontFamily: 'Inter_600SemiBold', marginBottom: 6 }}>
            {formatCurrency(total)}
          </Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
             Paid / Deposit: {formatCurrency(paid)}
          </Text>
           <Text style={{ fontSize: 11, color: balanceColor, fontFamily: rawBalance !== 0 ? 'Inter_600SemiBold' : 'Inter_400Regular' }}>
             {balanceLabel}: {formatCurrency(Math.abs(rawBalance))}
          </Text>
        </View>

      </View>
    </TouchableOpacity>
  );
}

export default function RepairsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { canAccess, user } = useAuth();
  const isDealerPortal = isDealerPortalRole(user?.role);
  const isCustomerPortal = isLinkedCustomerPortalUser(user);
  const isPortal = isDealerPortal || isCustomerPortal;
  const isOwner = user?.role === 'dealer' || user?.role === 'super_admin';
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('Received');
  const [portalFilter, setPortalFilter] = useState<(typeof PORTAL_FILTERS)[number]>('All');
  const [dealerSearch, setDealerSearch] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  // Technicians now see the full shop list by default; "Assigned to me only"
  // stays available as an optional filter.
  const [techOnly, setTechOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [accumulatedRepairs, setAccumulatedRepairs] = useState<Repair[]>([]);

  const queryClient = useQueryClient();
  const [offlineItems, setOfflineItems] = useState<QueuedRepair[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  const loadOfflineQueue = async () => {
    const q = await offlineQueue.getQueue();
    setOfflineItems(q);
  };

  const handleSync = async () => {
    if (isSyncing || offlineItems.length === 0) return;
    const net = await Network.getNetworkStateAsync();
    if (!net.isConnected) return;

    setIsSyncing(true);
    const { success, failed } = await offlineQueue.flush();
    setIsSyncing(false);
    await loadOfflineQueue();
    if (success > 0) {
      setPage(1);
      queryClient.invalidateQueries();
    }
  };

  React.useEffect(() => {
    loadOfflineQueue();
    Network.getNetworkStateAsync().then(state => setIsConnected(!!state.isConnected));
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    setPage(1);
  }, [filter, portalFilter, debouncedSearch, showCancelled, techOnly]);

  const { data: returnsData, isLoading: returnsLoading, error: returnsError, refetch: returnsRefetch } = useReturnsList({ query: { enabled: !isPortal } } as any);

  // Dealer directory (staff view) — live counts per dealer.
  const dealersParams: any = { q: debouncedSearch || undefined };
  const { data: dealersData, isLoading: dealersLoading, error: dealersError, refetch: dealersRefetch, isFetching: dealersFetching } =
    useDealersList(dealersParams, { query: { enabled: !isPortal && filter === 'Dealers' } } as any);

  // Admin overview stats across all dealer repairs (owner only).
  const { data: overviewData } = useDealersOverview({ query: { enabled: !isPortal && filter === 'Dealers' && isOwner } } as any);

  // Dealer-portal: own dealer profile + stats.
  const { data: myDealer } = useDealersMe({ query: { enabled: isDealerPortal } } as any);
  const { data: myKhata } = useCustomersKhataGet('me', { query: { enabled: isCustomerPortal } } as any);

  const getStatusQuery = () => {
    if (isPortal) {
      if (portalFilter === 'Received') return 'received';
      if (portalFilter === 'Repair') return 'diagnosing,waiting_parts,repairing,testing,customer_approval,cannot_repair';
      if (portalFilter === 'Ready') return 'ready';
      if (portalFilter === 'Delivered') return 'delivered';
      return undefined;
    }
    if (filter === 'Received') return 'received';
    if (filter === 'Repair') return 'diagnosing,waiting_parts,repairing,testing,customer_approval,cannot_repair';
    if (filter === 'Ready') return 'ready';
    if (filter === 'Delivered') return showCancelled ? 'delivered,cancelled' : 'delivered';
    return undefined;
  };

  const repairsParams: any = {
    q: debouncedSearch || undefined,
    status: getStatusQuery(),
    page,
    limit: 20,
  };

  if (user?.role === 'technician' && techOnly) {
    repairsParams.technicianId = 'me';
  }

  const {
    data: repairsData,
    isLoading: repairsLoading,
    error: repairsError,
    refetch: repairsRefetch,
    isFetching: repairsFetching
  } = useRepairsList(repairsParams, {
    query: {
      enabled: isPortal || (filter !== 'After-Sales Service' && filter !== 'Dealers'),
      queryKey: getRepairsListQueryKey(repairsParams)
    }
  });
  const searchBusy =
    (filter === 'Dealers' ? dealersFetching : repairsFetching) && search.trim().length > 0;

  React.useEffect(() => {
    if (repairsData?.repairs) {
      if (page === 1) setAccumulatedRepairs(repairsData.repairs as Repair[]);
      else setAccumulatedRepairs(prev => {
        const newItems = (repairsData.repairs as Repair[]).filter(r => !prev.find(p => p.id === r.id));
        return [...prev, ...newItems];
      });
    }
  }, [repairsData, page]);

  const onRefresh = async () => {
    if (isPortal) await repairsRefetch();
    else if (filter === 'After-Sales Service') await returnsRefetch();
    else if (filter === 'Dealers') await dealersRefetch();
    else await repairsRefetch();
  };

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const filteredReturns = useMemo(() => {
    if (filter !== 'After-Sales Service') return [];
    let list = returnsData?.returns || [];
    // Technicians see the full after-sales list (same view as reception).

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.customerName?.toLowerCase().includes(q) ||
        r.returnId.toLowerCase().includes(q) ||
        r.repairTicket?.toLowerCase().includes(q) ||
        r.brand?.toLowerCase().includes(q) ||
        r.model?.toLowerCase().includes(q) ||
        r.mobile?.includes(q) ||
        r.imei?.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [returnsData, filter, search, user]);

  // Create button follows the owner-configured repairs_create toggle.
  const canCreateRepair = !isPortal && canAccess('repairs_create');

  const headerAnims = useStaggerAnim(3);

  const filteredDealers = useMemo(() => {
    let list = dealersData?.dealers || [];
    if (dealerSearch.trim()) {
      const q = dealerSearch.toLowerCase();
      list = list.filter((d) =>
        d.name.toLowerCase().includes(q) ||
        (d.shopName || '').toLowerCase().includes(q) ||
        d.dealerCode.toLowerCase().includes(q) ||
        d.mobile.includes(q),
      );
    }
    return list;
  }, [dealersData, dealerSearch]);

  const totalCount = isPortal
    ? repairsData?.total || 0
    : filter === 'After-Sales Service' ? filteredReturns.length
    : filter === 'Dealers' ? filteredDealers.length
    : repairsData?.total || 0;
  const isGlobalLoading = isPortal ? repairsLoading : filter === 'After-Sales Service' ? returnsLoading : filter === 'Dealers' ? dealersLoading : repairsLoading;
  const isGlobalError = isPortal ? repairsError : filter === 'After-Sales Service' ? returnsError : filter === 'Dealers' ? dealersError : repairsError;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <FadeInView animValue={headerAnims[0]} style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {isPortal ? 'My Repairs' : 'All Repairs'}
            </Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
              {isPortal
                ? (isDealerPortal && myDealer?.dealer ? `${myDealer.dealer.dealerCode} · ${myDealer.dealer.name}` : `${totalCount} jobs`)
                : filter === 'Dealers' ? `${totalCount} dealers` : `${totalCount} jobs`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/more')}
              style={{
                width: 40, height: 40, borderRadius: 12,
                backgroundColor: colors.backgroundSecondary,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: colors.border,
                marginRight: 4,
              }}
            >
              <Avatar name={user?.name ?? 'User'} size={36} />
              <View style={{ position: 'absolute', bottom: -2, right: -2, backgroundColor: colors.card, borderRadius: 10, padding: 2 }}>
                <Feather name="menu" size={10} color={colors.primary} />
              </View>
            </TouchableOpacity>

            {!isPortal && filter === 'Dealers' && canCreateRepair && (
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/repairs/dealer-new')}
                activeOpacity={0.85}
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
              >
                <Feather name="plus" size={18} color="#FFFFFF" />
                <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Dealer</Text>
              </TouchableOpacity>
            )}
            {canCreateRepair && filter !== 'Delivered' && filter !== 'Repair' && filter !== 'Ready' && filter !== 'Dealers' && (
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/repairs/new')}
                activeOpacity={0.85}
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
              >
                <Feather name="plus" size={18} color="#FFFFFF" />
                <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>New</Text>
              </TouchableOpacity>
            )}
            {!isPortal && (
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/repairs/scanner')}
                activeOpacity={0.85}
                style={[styles.addBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 }]}
              >
                <Feather name="maximize" size={18} color={colors.foreground} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Search */}
        <FlatCard style={styles.searchBar}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <View style={{ width: 16, alignItems: 'center' }}>
            {searchBusy ? <AvarpusSpinner size={14} /> : null}
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search tickets, names, mobile..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </FlatCard>


        {/* Offline Sync Banner */}
        {!isPortal && offlineItems.length > 0 && (
          <View style={{ backgroundColor: colors.warning + '22', borderWidth: 1, borderColor: colors.warning + '44', padding: 12, borderRadius: 8, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, color: colors.warning, fontFamily: 'Inter_600SemiBold' }}>
                {offlineItems.length} repair{offlineItems.length > 1 ? 's' : ''} saved offline
              </Text>
              <Text style={{ fontSize: 12, color: colors.warning, marginTop: 2 }}>
                Photos/signatures will need to be re-added once synced.
              </Text>
              {offlineItems.some(i => i.status === 'failed') && (
                <Text style={{ fontSize: 11, color: colors.destructive, marginTop: 2 }}>
                  Some items failed to sync due to errors.
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={handleSync}
              disabled={isSyncing || !isConnected}
              style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: (isSyncing || !isConnected) ? colors.muted : colors.warning, borderRadius: 6 }}
            >
              {isSyncing ? (
                <AvarpusSpinner size={20} color="#FFF" />
              ) : (
                <Text style={{ color: '#FFF', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
                  {isConnected ? 'Sync Now' : 'Offline'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Dealer-portal stats header */}
        {isDealerPortal && myDealer?.stats && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[
              { label: 'Total', value: String(myDealer.stats.totalRepairs), color: colors.primary },
              { label: 'In Progress', value: String(myDealer.stats.received + myDealer.stats.repairing), color: colors.warning },
              { label: 'Ready', value: String(myDealer.stats.ready), color: colors.info },
              { label: 'Delivered', value: String(myDealer.stats.delivered), color: colors.success },
            ].map((s) => (
              <FlatCard key={s.label} style={{ flex: 1, minWidth: '22%', padding: 10, alignItems: 'center', gap: 2 }}>
                <Text style={{ fontSize: 16, color: s.color, fontFamily: 'Inter_700Bold' }}>{s.value}</Text>
                <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{s.label}</Text>
              </FlatCard>
            ))}
          </View>
        )}

        {isCustomerPortal && myKhata?.totals && (() => {
          const balance = myKhata.totals.balance;
          const label = balance > 0 ? 'Due' : balance < 0 ? 'Advance' : 'Paid / Settled';
          const color = balance > 0 ? colors.destructive : colors.success;
          return (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <FlatCard style={{ flex: 1, padding: 12, gap: 3 }}>
                <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>TOTAL REPAIR VALUE</Text>
                <Text style={{ fontSize: 17, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>
                  {formatCurrency(myKhata.totals.totalGiven)}
                </Text>
              </FlatCard>
              <FlatCard style={{ flex: 1, padding: 12, gap: 3 }}>
                <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{label.toUpperCase()}</Text>
                <Text style={{ fontSize: 17, color, fontFamily: 'Inter_700Bold' }}>
                  {formatCurrency(Math.abs(balance))}
                </Text>
              </FlatCard>
            </View>
          );
        })()}

        {/* Filter Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
          {(isPortal ? PORTAL_FILTERS : FILTERS).map((item) => {
            const active = isPortal ? portalFilter === item : filter === item;
            return (
              <TouchableOpacity
                key={item}
                onPress={() => (isPortal ? setPortalFilter(item as any) : setFilter(item as Filter))}
                activeOpacity={0.8}
                style={[styles.filterTab, {
                  backgroundColor: active ? colors.primary : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                }]}
              >
                <Text style={[styles.filterText, {
                  color: active ? '#FFFFFF' : colors.mutedForeground,
                  fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium',
                }]}>{item}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {user?.role === 'technician' && (
          <TouchableOpacity onPress={() => setTechOnly(!techOnly)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: colors.primary, backgroundColor: techOnly ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {techOnly && <Feather name="check" size={12} color="#FFF" />}
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>Assigned to me only</Text>
          </TouchableOpacity>
        )}
        {filter === 'Delivered' && (
          <TouchableOpacity onPress={() => setShowCancelled(!showCancelled)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: colors.primary, backgroundColor: showCancelled ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {showCancelled && <Feather name="check" size={12} color="#FFF" />}
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>Include Cancelled</Text>
          </TouchableOpacity>
        )}
      </FadeInView>

      {isGlobalLoading && totalCount === 0 ? (
        <DataLoadingState />
      ) : isGlobalError && totalCount === 0 ? (
        <DataErrorState onRetry={onRefresh} />
      ) : (
      <>
      {!!isGlobalError && <DataErrorBanner onRetry={onRefresh} />}

      {!isPortal && filter === 'Dealers' ? (
        <FlatList
          data={filteredDealers}
          keyExtractor={(d) => d.id}
          contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={dealersLoading} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            isOwner && overviewData?.stats ? (
              <FlatCard style={{ padding: 14, gap: 10, marginBottom: 2 }}>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 }}>DEALER REPAIRS OVERVIEW</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {[
                    { label: 'Total Repairs', value: String(overviewData.stats.totalDealerRepairs), color: colors.primary },
                    { label: 'Active', value: String(overviewData.stats.activeRepairs), color: colors.warning },
                    { label: 'Delivered', value: String(overviewData.stats.deliveredRepairs), color: colors.success },
                    { label: 'Returns', value: String(overviewData.stats.afterSaleReturns), color: colors.destructive },
                    { label: 'Revenue', value: formatCurrency(overviewData.stats.totalRepairRevenue), color: colors.success },
                    { label: 'Pending', value: formatCurrency(overviewData.stats.pendingPayments), color: colors.warning },
                  ].map((s) => (
                    <View key={s.label} style={{ minWidth: '28%' }}>
                      <Text style={{ fontSize: 15, color: s.color, fontFamily: 'Inter_700Bold' }}>{s.value}</Text>
                      <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{s.label}</Text>
                    </View>
                  ))}
                </View>
              </FlatCard>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="briefcase"
              title="No dealers yet"
              description={search ? 'Try a different search term' : 'Add your B2B dealers to track their bulk repairs'}
              actionLabel={canCreateRepair ? 'Add Dealer' : undefined}
              onAction={canCreateRepair ? () => router.push('/(tabs)/repairs/dealer-new') : undefined}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => router.push(`/(tabs)/repairs/dealer/${item.id}`)} activeOpacity={0.8}>
              <FlatCard style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.repairIdBadge, { backgroundColor: colors.primary + '15' }]}>
                    <Text style={[styles.repairId, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{item.dealerCode}</Text>
                  </View>
                  {!item.isActive && (
                    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.destructive + '22' }}>
                      <Text style={{ fontSize: 10, color: colors.destructive, fontFamily: 'Inter_600SemiBold' }}>INACTIVE</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.customerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{item.name}</Text>
                <Text style={[styles.deviceLine, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {[item.shopName, item.location].filter(Boolean).join(' · ') || item.mobile}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Total: <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{item.totalRepairs}</Text></Text>
                  <Text style={{ fontSize: 12, color: colors.warning }}>In Progress: {item.received + item.repairing}</Text>
                  <Text style={{ fontSize: 12, color: colors.info }}>Ready: {item.ready}</Text>
                  <Text style={{ fontSize: 12, color: colors.success }}>Delivered: {item.delivered}</Text>
                </View>
              </FlatCard>
            </TouchableOpacity>
          )}
        />
      ) : !isPortal && filter === 'After-Sales Service' ? (
        <FlatList
          data={filteredReturns}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={returnsLoading} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="corner-up-left"
              title="No after-sales cases"
              description={search ? 'Try a different search term' : 'No return cases match the current filter'}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => router.push(`/(tabs)/repairs/return/${item.id}`)} activeOpacity={0.8}>
              <FlatCard style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.repairIdBadge, { backgroundColor: colors.warning + '15' }]}>
                    <Text style={[styles.repairId, { color: colors.warning, fontFamily: 'Inter_700Bold' }]}>{item.returnId}</Text>
                  </View>
                  <View style={[{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: getReturnStatusColor(item.status, colors) + '15' }]}>
                    <Text style={{ fontSize: 11, color: getReturnStatusColor(item.status, colors), fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' }}>
                      {item.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.customerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{item.customerName || 'Unknown'}</Text>
                <Text style={[styles.deviceLine, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {item.brand} {item.model}
                </Text>
                <Text style={[styles.problem, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
                  Reason: {item.reason.replace(/_/g, ' ')}
                </Text>
                <View style={styles.cardBottom}>
                  {item.underWarranty ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Feather name="shield" size={12} color={colors.success} />
                      <Text style={{ fontSize: 11, color: colors.success, fontFamily: 'Inter_600SemiBold' }}>Warranty</Text>
                    </View>
                  ) : (
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>Out of Warranty</Text>
                  )}
                  <View style={styles.cardBottomRight}>
                    <Text style={[styles.dateText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      {formatDate(item.createdAt)}
                    </Text>
                  </View>
                </View>
              </FlatCard>
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          data={accumulatedRepairs}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={repairsLoading && page === 1} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="tool"
              title="No repairs found"
              description={search ? 'Try a different search term' : 'No repairs match the current filter'}
              actionLabel={canCreateRepair && filter !== 'Delivered' && filter !== 'Repair' && filter !== 'Ready' ? 'Create Repair' : undefined}
              onAction={canCreateRepair && filter !== 'Delivered' && filter !== 'Repair' && filter !== 'Ready' ? () => router.push('/(tabs)/repairs/new') : undefined}
            />
          }
          ListFooterComponent={
             repairsFetching && (repairsData?.repairs?.length || 0) > 0 ? (
               <AvarpusSpinner size={20} style={{ marginVertical: 20 }} />
             ) : null
          }
          onEndReached={() => {
             if (repairsData?.total && accumulatedRepairs.length < repairsData.total && !repairsFetching) {
               setPage(p => p + 1);
             }
          }}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => {
            // Portal accounts get a read-only card: variant derived from the
            // repair's own status, never the staff 'ready' variant (which
            // shows Notify/Payment/Hand Over actions).
            return <RepairCard repair={item} onPress={() => router.push(`/(tabs)/repairs/${item.id}`)} />;
          }}
        />
      )}
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerTitle: { fontSize: 28 },
  headerSub: { fontSize: 13, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14 },
  addBtnText: { color: '#FFFFFF', fontSize: 14 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchInput: { flex: 1, height: 46, fontSize: 14 },
  filterTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  filterText: { fontSize: 13 },
  list: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },
  card: { padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  repairIdBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  repairId: { fontSize: 11 },
  customerName: { fontSize: 15 },
  deviceLine: { fontSize: 13 },
  problem: { fontSize: 12 },
  amountSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
    paddingTop: 9,
  },
  amountSummaryCell: { alignItems: 'flex-end' },
  amountSummaryLabel: { fontSize: 9, fontFamily: 'Inter_500Medium', marginBottom: 2 },
  amountSummaryValue: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  cardBottomRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateText: { fontSize: 12 },
});
