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
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { RepairStatusBadge, PriorityBadge, SampleBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { GlassCard, ScreenGlow, FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { Repair } from '@/types';
import { formatDate, formatCurrency, getReturnStatusColor } from '@/utils/helpers';
import * as Network from 'expo-network';
import { offlineQueue, QueuedRepair } from '@/utils/offlineQueue';
import { useQueryClient } from '@tanstack/react-query';

import { useReturnsList, useRepairsList, getRepairsListQueryKey } from '@workspace/api-client-react';

const FILTERS = ['Received', 'Repair', 'Ready', 'Delivered', 'After-Sales Service'] as const;
type Filter = (typeof FILTERS)[number];

function RepairCard({ repair, onPress, variant }: { repair: Repair; onPress: () => void; variant: 'received' | 'repair' | 'ready' | 'delivered' }) {
  const colors = useColors();
  const balance = Math.max(0, repair.repairCharge + repair.partsCharge - repair.advance);
  const total = repair.repairCharge + repair.partsCharge;
  
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <GlassCard style={styles.card}>
        <View style={styles.cardTop}>
          <View style={[styles.repairIdBadge, { backgroundColor: colors.primary + '15' }]}>
            <Text style={[styles.repairId, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{repair.repairId}</Text>
          </View>
          <PriorityBadge priority={repair.priority} />
          {variant !== 'received' && <RepairStatusBadge status={repair.status} />}
          {repair.isSample && <SampleBadge />}
        </View>

        <Text style={[styles.customerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{repair.customerName}</Text>
        <Text style={[styles.deviceLine, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {repair.deviceType} · {repair.brand} {repair.model}
        </Text>

        {variant === 'received' && (
          <>
            <Text style={[styles.problem, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
              {repair.problem}
            </Text>
            <View style={{ marginTop: 4 }}>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Est: {formatCurrency(total)}</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Expected: {formatDate(repair.expectedDate)}</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Received by: {repair.receivedByName || 'System'}</Text>
            </View>
          </>
        )}

        {variant === 'repair' && (
          <View style={{ marginTop: 4 }}>
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Technician: {repair.technicianName || 'Unassigned'}</Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Total: {formatCurrency(total)} | Adv: {formatCurrency(repair.advance)}</Text>
            {balance > 0 && <Text style={{ fontSize: 12, color: colors.warning, fontWeight: 'bold' }}>Pending: {formatCurrency(balance)}</Text>}
          </View>
        )}

        {variant === 'ready' && (
          <View style={{ marginTop: 4 }}>
             <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Total: {formatCurrency(total)} | Adv: {formatCurrency(repair.advance)}</Text>
             {balance > 0 && <Text style={{ fontSize: 12, color: colors.warning, fontWeight: 'bold' }}>Due: {formatCurrency(balance)}</Text>}
             <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
               <TouchableOpacity onPress={onPress} style={{ flex: 1, backgroundColor: colors.info, paddingVertical: 6, borderRadius: 6, alignItems: 'center' }}>
                 <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>Notify</Text>
               </TouchableOpacity>
               <TouchableOpacity onPress={onPress} style={{ flex: 1, backgroundColor: colors.warning, paddingVertical: 6, borderRadius: 6, alignItems: 'center' }}>
                 <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>Payment</Text>
               </TouchableOpacity>
               <TouchableOpacity onPress={onPress} style={{ flex: 1, backgroundColor: colors.primary, paddingVertical: 6, borderRadius: 6, alignItems: 'center' }}>
                 <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>Hand Over</Text>
               </TouchableOpacity>
             </View>
          </View>
        )}

        {variant === 'delivered' && (
          <View style={{ marginTop: 4 }}>
             <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Total: {formatCurrency(total)} | Adv: {formatCurrency(repair.advance)}</Text>
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
               <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: balance === 0 ? colors.success + '22' : colors.warning + '22' }}>
                 <Text style={{ fontSize: 10, color: balance === 0 ? colors.success : colors.warning, fontWeight: 'bold' }}>
                   {balance === 0 ? 'PAID' : `PENDING ${formatCurrency(balance)}`}
                 </Text>
               </View>
               {repair.paymentMethod && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>via {repair.paymentMethod}</Text>}
             </View>
             <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4 }}>
               Delivered: {repair.deliveryDate ? formatDate(repair.deliveryDate) : 'N/A'} by {repair.deliveredByName || 'Unknown'}
             </Text>
          </View>
        )}

        <View style={styles.cardBottom}>
          <View style={styles.cardBottomRight}>
            <Text style={[styles.dateText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {formatDate(repair.createdAt)}
            </Text>
          </View>
        </View>
      </GlassCard>
    </TouchableOpacity>
  );
}

export default function RepairsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { canAccess, user } = useAuth();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('Received');
  const [showCancelled, setShowCancelled] = useState(false);
  const [techOnly, setTechOnly] = useState(true);
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
  }, [filter, debouncedSearch, showCancelled, techOnly]);

  const { data: returnsData, isLoading: returnsLoading, error: returnsError, refetch: returnsRefetch } = useReturnsList();

  const getStatusQuery = () => {
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
      enabled: filter !== 'After-Sales Service',
      queryKey: getRepairsListQueryKey(repairsParams)
    } 
  });

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
    if (filter === 'After-Sales Service') await returnsRefetch();
    else await repairsRefetch();
  };

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const filteredReturns = useMemo(() => {
    if (filter !== 'After-Sales Service') return [];
    let list = returnsData?.returns || [];
    if (user?.role === 'technician') list = list.filter((r) => r.technicianId === user.id);
    
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

  const canCreateRepair = canAccess('repairs') && user?.role !== 'technician';

  const headerAnims = useStaggerAnim(3);

  const totalCount = filter === 'After-Sales Service' ? filteredReturns.length : repairsData?.total || 0;
  const isGlobalLoading = filter === 'After-Sales Service' ? returnsLoading : repairsLoading;
  const isGlobalError = filter === 'After-Sales Service' ? returnsError : repairsError;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />

      {/* Header */}
      <FadeInView animValue={headerAnims[0]} style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Repairs</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
              {totalCount} jobs
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {canCreateRepair && filter !== 'Delivered' && filter !== 'Repair' && (
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/repairs/new')}
                activeOpacity={0.85}
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
              >
                <Feather name="plus" size={18} color="#FFFFFF" />
                <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>New</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/repairs/scanner')}
              activeOpacity={0.85}
              style={[styles.addBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 }]}
            >
              <Feather name="maximize" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <GlassCard style={styles.searchBar}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
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
        </GlassCard>


        {/* Offline Sync Banner */}
        {offlineItems.length > 0 && (
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
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={{ color: '#FFF', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
                  {isConnected ? 'Sync Now' : 'Offline'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
        
        {/* Filter Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
          {FILTERS.map((item) => {
            const active = filter === item;
            return (
              <TouchableOpacity
                key={item}
                onPress={() => setFilter(item)}
                activeOpacity={0.8}
                style={[styles.filterTab, {
                  backgroundColor: active ? colors.primary : colors.primary + '12',
                  borderColor: active ? colors.primary : 'transparent',
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
      
      {filter === 'After-Sales Service' ? (
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
              <GlassCard style={styles.card}>
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
              </GlassCard>
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
              actionLabel={canCreateRepair && filter !== 'Delivered' && filter !== 'Repair' ? 'Create Repair' : undefined}
              onAction={canCreateRepair && filter !== 'Delivered' && filter !== 'Repair' ? () => router.push('/(tabs)/repairs/new') : undefined}
            />
          }
          ListFooterComponent={
             repairsFetching && (repairsData?.repairs?.length || 0) > 0 ? (
               <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
             ) : null
          }
          onEndReached={() => {
             if (repairsData?.total && accumulatedRepairs.length < repairsData.total && !repairsFetching) {
               setPage(p => p + 1);
             }
          }}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => {
            const variant = filter === 'Received' ? 'received' : filter === 'Repair' ? 'repair' : filter === 'Ready' ? 'ready' : 'delivered';
            return <RepairCard repair={item} onPress={() => router.push(`/(tabs)/repairs/${item.id}`)} variant={variant} />;
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
  card: { padding: 16, gap: 7 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  repairIdBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  repairId: { fontSize: 11 },
  customerName: { fontSize: 15 },
  deviceLine: { fontSize: 13 },
  problem: { fontSize: 12 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  cardBottomRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateText: { fontSize: 12 },
});
