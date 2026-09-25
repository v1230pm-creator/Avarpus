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
import { font } from '@/constants/typography';
import { layout, radius, size, space, hitSlop } from '@/constants/spacing';
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


      <FadeInView animValue={headerAnims[0]} style={[styles.header, { paddingTop: topPad }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Returns & Rework</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              {filtered.length} cases
            </Text>
          </View>
        </View>

        <FlatCard style={styles.searchBar}>
          <Feather name="search" size={size.headerIcon} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search return cases..."
            placeholderTextColor={colors.placeholder}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={size.inlineIcon} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </FlatCard>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={(f) => f}
          contentContainerStyle={{ gap: space.sm, paddingHorizontal: layout.listInset }}
          renderItem={({ item }) => {
            const active = filter === item;
            return (
              <TouchableOpacity hitSlop={hitSlop.chip}
                onPress={() => setFilter(item)}
                activeOpacity={0.8}
                style={[styles.filterTab, {
                   backgroundColor: active ? colors.primary : colors.secondary,
                  borderColor: active ? colors.primary : 'transparent',
                }]}
              >
                <Text style={[styles.filterText, {
                  color: active ? colors.primaryForeground : colors.foreground,
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
          contentContainerStyle={[styles.list, { paddingBottom: space.xxl }]}
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
                     <Text style={[styles.returnId, { color: colors.warning }]}>{item.returnId}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: item.status === 'closed' ? colors.success + '15' : colors.warning + '15' }]}>
                     <Text style={{ ...font.smallStrong, color: item.status === 'closed' ? colors.success : colors.warning, textTransform: 'capitalize' }}>
                      {item.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                </View>
                 <Text style={[styles.customerName, { color: colors.foreground }]}>{item.customerName || 'Unknown'}</Text>
                 <Text style={[styles.deviceLine, { color: colors.mutedForeground }]}>
                  {item.brand} {item.model}
                </Text>
                 <Text style={[styles.problem, { color: colors.mutedForeground }]} numberOfLines={1}>
                  Reason: {item.reason.replace(/_/g, ' ')}
                </Text>
                <View style={styles.cardBottom}>
                  {item.underWarranty ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Feather name="shield" size={12} color={colors.success} />
                       <Text style={{ ...font.captionStrong, color: colors.success }}>Warranty</Text>
                    </View>
                  ) : (
                     <Text style={{ ...font.captionStrong, color: colors.mutedForeground }}>Out of Warranty</Text>
                  )}
                  <View style={styles.cardBottomRight}>
                     <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
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
  header: { paddingBottom: layout.searchGap, gap: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: layout.headerHeight, paddingHorizontal: layout.listInset, gap: space.xs },
  backBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  headerSub: { ...font.captionStrong, marginTop: space.xs },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: size.searchGap, paddingLeft: size.searchPadding, paddingRight: space.md, minHeight: size.searchField, borderRadius: size.searchRadius, marginLeft: layout.listInset, marginRight: layout.screenPadding, marginTop: layout.headerGap },
  searchInput: { flex: 1, ...font.search, paddingVertical: 0 },
  filterTab: { paddingHorizontal: space.lg, minHeight: size.chip, justifyContent: 'center', borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  filterText: { ...font.captionStrong },
  list: { paddingHorizontal: layout.screenPadding, paddingTop: space.md, gap: space.md },
  card: { padding: space.lg, gap: space.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  returnIdBadge: { paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm },
  returnId: { ...font.smallStrong },
  statusBadge: { paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm },
  customerName: { ...font.itemTitle },
  deviceLine: { ...font.body },
  problem: { ...font.caption },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xs },
  cardBottomRight: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dateText: { ...font.caption },
});