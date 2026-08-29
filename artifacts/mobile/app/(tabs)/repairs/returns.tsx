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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { FlatCard, FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { formatDate } from '@/utils/helpers';
import { useReturnsList } from '@workspace/api-client-react';

const FILTERS = ['All', 'Active', 'Closed'] as const;
type Filter = (typeof FILTERS)[number];

export default function ReturnsListScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { data, isLoading, error, refetch, isRefetching } = useReturnsList();

  const returns = data?.returns || [];

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('All');

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const filtered = useMemo(() => {
    let list = returns;
    if (user?.role === 'technician') {
      list = list.filter((r) => r.technicianId === user.id);
    }
    if (filter === 'Active') list = list.filter((r) => r.status !== 'closed');
    else if (filter === 'Closed') list = list.filter((r) => r.status === 'closed');

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.customerName?.toLowerCase().includes(q) ||
        r.returnId.toLowerCase().includes(q) ||
        r.repairTicket?.toLowerCase().includes(q) ||
        r.brand?.toLowerCase().includes(q) ||
        r.model?.toLowerCase().includes(q) ||
        r.mobile?.includes(q)
      );
    }
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [returns, filter, search, user]);

  const headerAnims = useStaggerAnim(3);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <FadeInView animValue={headerAnims[0]} style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Returns & Rework</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
              {filtered.length} cases
            </Text>
          </View>
        </View>

        <FlatCard style={styles.searchBar}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search return cases..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </FlatCard>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={(f) => f}
          contentContainerStyle={{ gap: 8 }}
          renderItem={({ item }) => {
            const active = filter === item;
            return (
              <TouchableOpacity
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
          }}
          style={{ paddingBottom: 2 }}
        />
      </FadeInView>

      {isLoading && returns.length === 0 ? (
        <DataLoadingState />
      ) : error && returns.length === 0 ? (
        <DataErrorState onRetry={() => refetch()} />
      ) : (
      <>
        {!!error && <DataErrorBanner onRetry={() => refetch()} />}
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="corner-up-left"
              title="No returns found"
              description={search ? 'Try a different search term' : 'No return cases match the current filter'}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => router.push(`/(tabs)/repairs/return/${item.id}`)} activeOpacity={0.8}>
              <FlatCard style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.returnIdBadge, { backgroundColor: colors.warning + '15' }]}>
                    <Text style={[styles.returnId, { color: colors.warning, fontFamily: 'Inter_700Bold' }]}>{item.returnId}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: item.status === 'closed' ? colors.success + '15' : colors.warning + '15' }]}>
                    <Text style={{ fontSize: 11, color: item.status === 'closed' ? colors.success : colors.warning, fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' }}>
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
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 12, paddingBottom: 10, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20 },
  headerSub: { fontSize: 12, marginTop: 2 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 40, fontSize: 13 },
  filterTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  filterText: { fontSize: 12 },
  list: { paddingHorizontal: 12, paddingTop: 10, gap: 10 },
  card: { padding: 12, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  returnIdBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  returnId: { fontSize: 10 },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  customerName: { fontSize: 14 },
  deviceLine: { fontSize: 12 },
  problem: { fontSize: 11 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  cardBottomRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateText: { fontSize: 11 },
});