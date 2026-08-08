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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { Badge, SampleBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { GlassCard, ScreenGlow, FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { InventoryFormSheet } from '@/components/forms/InventoryFormSheet';
import { InventoryItem } from '@/types';
import { formatCurrency } from '@/utils/helpers';

const CATEGORIES = ['All', 'Products', 'Accessories', 'Spare Parts'] as const;
type Cat = (typeof CATEGORIES)[number];

const CAT_MAP: Record<Cat, string | null> = {
  All: null,
  Products: 'product',
  Accessories: 'accessory',
  'Spare Parts': 'spare_part',
};

const CAT_LABELS: Record<string, string> = { product: 'Product', accessory: 'Accessory', spare_part: 'Spare Part' };

function InventoryCard({ item, onPress }: { item: InventoryItem; onPress: () => void }) {
  const colors = useColors();
  const isLow = item.quantity <= item.minStock;
  const isOut = item.quantity === 0;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
    <GlassCard
      style={StyleSheet.flatten([
        styles.card,
        isOut
          ? { borderColor: colors.destructive + '44' }
          : isLow
            ? { borderColor: colors.warning + '44' }
            : null,
      ])}
    >
      <View style={styles.cardTop}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.itemName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.brand, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {item.brand} · {CAT_LABELS[item.category]}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Badge
            label={CAT_LABELS[item.category]}
            variant={item.category === 'spare_part' ? 'info' : item.category === 'product' ? 'default' : 'muted'}
            size="sm"
          />
          {item.isSample && <SampleBadge />}
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.cardBottom}>
        <View style={styles.stockInfo}>
          <View style={[styles.stockBadge, { backgroundColor: isOut ? colors.destructive + '22' : isLow ? colors.warningLight : colors.successLight }]}>
            <Text style={[styles.stockNum, { color: isOut ? colors.destructive : isLow ? colors.warning : colors.success, fontFamily: 'Inter_700Bold' }]}>
              {item.quantity}
            </Text>
            <Text style={[styles.stockLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>In Stock</Text>
          </View>
          <View style={styles.minStock}>
            <Text style={[styles.minLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Min: {item.minStock}</Text>
          </View>
        </View>
        <View style={styles.priceInfo}>
          <Text style={[styles.price, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{formatCurrency(item.sellingPrice)}</Text>
          <Text style={[styles.costPrice, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Cost: {formatCurrency(item.purchasePrice)}
          </Text>
        </View>
      </View>

      {(isOut || isLow) && (
        <View style={[styles.alertBar, { backgroundColor: isOut ? colors.destructive + '22' : colors.warningLight }]}>
          <Feather name="alert-triangle" size={12} color={isOut ? colors.destructive : colors.warning} />
          <Text style={[styles.alertText, { color: isOut ? colors.destructive : colors.warning, fontFamily: 'Inter_600SemiBold' }]}>
            {isOut ? 'OUT OF STOCK' : 'LOW STOCK ALERT'}
          </Text>
        </View>
      )}
    </GlassCard>
    </TouchableOpacity>
  );
}

export default function InventoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { inventory, isLoading, loadError, loadAll } = useData();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Cat>('All');
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | undefined>(undefined);

  const openAdd = () => { setEditItem(undefined); setShowForm(true); };
  const openEdit = (item: InventoryItem) => { setEditItem(item); setShowForm(true); };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  };

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const lowStockCount = useMemo(() => inventory.filter((i) => i.quantity <= i.minStock).length, [inventory]);

  const filtered = useMemo(() => {
    let list = inventory;
    const catFilter = CAT_MAP[category];
    if (catFilter) list = list.filter((i) => i.category === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || i.brand.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => a.quantity - b.quantity);
  }, [inventory, category, search]);

  const headerAnims = useStaggerAnim(3);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />

      <FadeInView animValue={headerAnims[0]} style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Inventory</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
              {filtered.length} items{lowStockCount > 0 ? ` · ${lowStockCount} low stock` : ''}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {lowStockCount > 0 && (
              <View style={[styles.alertBadge, { backgroundColor: colors.warning + '15' }]}>
                <Feather name="alert-triangle" size={14} color={colors.warning} />
                <Text style={[styles.alertBadgeText, { color: colors.warning, fontFamily: 'Inter_600SemiBold' }]}>{lowStockCount}</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={openAdd}
              activeOpacity={0.85}
              style={[styles.addBtn, { backgroundColor: colors.primary }]}
            >
              <Feather name="plus" size={18} color="#FFFFFF" />
              <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        <GlassCard style={styles.searchBar}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search inventory..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
          />
          {!!search && <TouchableOpacity onPress={() => setSearch('')}><Feather name="x" size={16} color={colors.mutedForeground} /></TouchableOpacity>}
        </GlassCard>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={CATEGORIES}
          keyExtractor={(c) => c}
          contentContainerStyle={{ gap: 8 }}
          renderItem={({ item }) => {
            const active = category === item;
            return (
              <TouchableOpacity
                onPress={() => setCategory(item)}
                activeOpacity={0.8}
                style={[styles.filterTab, { backgroundColor: active ? colors.primary : colors.primary + '12', borderColor: active ? colors.primary : 'transparent' }]}
              >
                <Text style={[styles.filterText, { color: active ? '#FFFFFF' : colors.mutedForeground, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>
                  {item}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </FadeInView>

      {isLoading && inventory.length === 0 ? (
        <DataLoadingState />
      ) : loadError && inventory.length === 0 ? (
        <DataErrorState onRetry={loadAll} />
      ) : (
      <>
      {!!loadError && <DataErrorBanner onRetry={loadAll} />}
      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={<EmptyState icon="package" title="No items found" description={search ? 'Try a different search' : 'No inventory items'} />}
        renderItem={({ item }) => <InventoryCard item={item} onPress={() => openEdit(item)} />}
      />
      </>
      )}

      <InventoryFormSheet visible={showForm} onClose={() => setShowForm(false)} item={editItem} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerTitle: { fontSize: 28 },
  headerSub: { fontSize: 13, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14 },
  addBtnText: { color: '#FFFFFF', fontSize: 14 },
  alertBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  alertBadgeText: { fontSize: 13 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchInput: { flex: 1, height: 46, fontSize: 14 },
  filterTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  filterText: { fontSize: 13 },
  list: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },
  card: { padding: 16, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  itemName: { fontSize: 15 },
  brand: { fontSize: 12 },
  divider: { height: 1 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stockInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stockBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, alignItems: 'center' },
  stockNum: { fontSize: 20 },
  stockLabel: { fontSize: 10 },
  minStock: {},
  minLabel: { fontSize: 12 },
  priceInfo: { alignItems: 'flex-end', gap: 2 },
  price: { fontSize: 16 },
  costPrice: { fontSize: 11 },
  alertBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  alertText: { fontSize: 11, letterSpacing: 0.5 },
});
