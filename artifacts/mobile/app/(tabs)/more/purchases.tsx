import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
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
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { Badge, SampleBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { GlassCard, ScreenGlow, FadeInView, useIsDark } from '@/components/ui/Glass';
import { Purchase } from '@/types';
import { formatCurrency, formatDate } from '@/utils/helpers';

const PAYMENT_STATUS_COLORS = {
  paid: 'success',
  unpaid: 'error',
  partial: 'warning',
} as const;

function PurchaseCard({ purchase }: { purchase: Purchase }) {
  const colors = useColors();
  return (
    <GlassCard style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.invoiceBadge, { backgroundColor: colors.primary + '15' }]}>
          <Text style={[styles.invoiceId, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{purchase.invoiceNo}</Text>
        </View>
        <Badge
          label={purchase.paymentStatus.charAt(0).toUpperCase() + purchase.paymentStatus.slice(1)}
          variant={PAYMENT_STATUS_COLORS[purchase.paymentStatus]}
          size="sm"
        />
        {purchase.isSample && <SampleBadge />}
      </View>

      <Text style={[styles.supplier, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{purchase.supplier}</Text>
      <Text style={[styles.itemsText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        {purchase.purchaseId} · {purchase.paymentMethod}
      </Text>

      <View style={[styles.itemList, { borderTopColor: colors.border }]}>
        <Text style={[styles.itemLine, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
          • {purchase.itemName} × {purchase.quantity} @ {formatCurrency(purchase.purchasePrice)}
        </Text>
      </View>

      <View style={styles.cardFooter}>
        <View>
          <Text style={[styles.totalAmount, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            {formatCurrency(purchase.total)}
          </Text>
          {purchase.paymentStatus !== 'paid' && (
            <Text style={[styles.balanceText, { color: colors.warning, fontFamily: 'Inter_500Medium' }]}>
              {purchase.paymentStatus === 'partial' ? 'Partially paid' : `Due: ${formatCurrency(purchase.total)}`}
            </Text>
          )}
        </View>
        <Text style={[styles.dateText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {formatDate(purchase.date)}
        </Text>
      </View>
    </GlassCard>
  );
}

export default function PurchasesScreen() {
  const colors = useColors();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { purchases, isLoading, loadError, loadAll } = useData();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'All' | 'Unpaid' | 'Paid' | 'Partial'>('All');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  };

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const headerAnim = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(headerAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [headerAnim]);

  const filtered = useMemo(() => {
    let list = purchases;
    if (filter === 'Unpaid') list = list.filter((p) => p.paymentStatus === 'unpaid');
    else if (filter === 'Paid') list = list.filter((p) => p.paymentStatus === 'paid');
    else if (filter === 'Partial') list = list.filter((p) => p.paymentStatus === 'partial');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.supplier.toLowerCase().includes(q) || p.invoiceNo.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => b.date.localeCompare(a.date));
  }, [purchases, filter, search]);

  const totalDue = useMemo(
    () => purchases.filter((p) => p.paymentStatus === 'unpaid').reduce((s, p) => s + p.total, 0),
    [purchases],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />

      <FadeInView animValue={headerAnim}>
        <View style={[styles.header, { paddingTop: topPad + 14 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Purchases</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {filtered.length} orders{totalDue > 0 ? ` · Due ${formatCurrency(totalDue)}` : ''}
            </Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        <View style={styles.searchWrap}>
          <View style={[styles.searchBar, {
            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
            borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
          }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search purchases..."
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
            />
            {!!search && <TouchableOpacity onPress={() => setSearch('')}><Feather name="x" size={16} color={colors.mutedForeground} /></TouchableOpacity>}
          </View>
          <View style={styles.filterRow}>
            {(['All', 'Unpaid', 'Paid', 'Partial'] as const).map((f) => {
              const active = filter === f;
              return (
                <TouchableOpacity
                  key={f}
                  onPress={() => setFilter(f)}
                  style={[styles.filterTab, {
                    backgroundColor: active ? colors.primary : (isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)'),
                    borderColor: active ? colors.primary : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)'),
                  }]}
                >
                  <Text style={[styles.filterText, { color: active ? '#FFFFFF' : colors.mutedForeground, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>
                    {f}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </FadeInView>

      {isLoading && purchases.length === 0 ? (
        <DataLoadingState />
      ) : loadError && purchases.length === 0 ? (
        <DataErrorState onRetry={loadAll} />
      ) : (
      <>
      {!!loadError && <DataErrorBanner onRetry={loadAll} />}
      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={<EmptyState icon="shopping-bag" title="No purchases found" description="No purchase orders match the current filter" />}
        renderItem={({ item }) => <PurchaseCard purchase={item} />}
      />
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22 },
  headerSub: { fontSize: 12, marginTop: 2 },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14 },
  searchInput: { flex: 1, height: 46, fontSize: 14 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterTab: { flex: 1, paddingVertical: 8, borderRadius: 20, borderWidth: 1, alignItems: 'center' },
  filterText: { fontSize: 12 },
  list: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  card: { padding: 14, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  invoiceBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  invoiceId: { fontSize: 11 },
  supplier: { fontSize: 16 },
  itemsText: { fontSize: 12 },
  itemList: { borderTopWidth: 1, paddingTop: 8, gap: 4 },
  itemLine: { fontSize: 12 },
  moreItems: { fontSize: 12 },
  cardFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  totalAmount: { fontSize: 18 },
  balanceText: { fontSize: 12 },
  dateText: { fontSize: 12 },
});
