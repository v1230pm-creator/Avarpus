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
import { FlatCard, FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { InventoryFormSheet } from '@/components/forms/InventoryFormSheet';
import { InventoryItem } from '@/types';
import { formatCurrency } from '@/utils/helpers';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

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
      <FlatCard
        style={[
          styles.card,
          isOut
            ? { borderColor: colors.destructive + '44' }
            : isLow
            ? { borderColor: colors.warning + '44' }
            : { borderColor: colors.border },
          { backgroundColor: colors.surface }
        ]}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.itemName, { color: colors.foreground, fontFamily: fontFamily.semibold }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.brand, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
              {item.brand}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Text style={[styles.price, { color: colors.foreground, fontFamily: fontFamily.bold }]}>{formatCurrency(item.sellingPrice)}</Text>
            {item.canSeeCosts !== false && (
              <Text style={[styles.costPrice, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
                Cost: {formatCurrency(item.purchasePrice)}
              </Text>
            )}
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.cardBottom}>
          <View style={styles.stockInfo}>
            <View style={[styles.stockBadge, { backgroundColor: isOut ? colors.destructive + '15' : isLow ? colors.warning + '15' : colors.success + '15' }]}>
              <Text style={[styles.stockNum, { color: isOut ? colors.destructive : isLow ? colors.warning : colors.success, fontFamily: fontFamily.semibold }]}>
                {item.quantity} in stock
              </Text>
            </View>
            {isOut ? (
               <Text style={[styles.minLabel, { color: colors.destructive, fontFamily: fontFamily.medium }]}>Out of Stock</Text>
            ) : isLow ? (
               <Text style={[styles.minLabel, { color: colors.warning, fontFamily: fontFamily.medium }]}>Low Stock</Text>
            ) : (
               <Text style={[styles.minLabel, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>Min: {item.minStock}</Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', flexDirection: 'row', gap: 6 }}>
            <Badge
              label={CAT_LABELS[item.category]}
              variant={item.category === 'spare_part' ? 'info' : item.category === 'product' ? 'default' : 'muted'}
              size="sm"
            />
            {item.isSample && <SampleBadge />}
          </View>
        </View>
      </FlatCard>
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

  const headerAnims = useStaggerAnim(2);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      <FadeInView animValue={headerAnims[0]} style={[styles.header, { paddingTop: topPad + space.lg, backgroundColor: colors.background }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Inventory</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity activeOpacity={0.7} style={styles.iconBtn}>
              <Feather name="search" size={size.headerIcon} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={openAdd} activeOpacity={0.7} style={styles.iconBtn}>
              <Feather name="plus-square" size={size.headerIcon} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.searchBar, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Feather name="search" size={size.inlineIcon} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search inventory..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.tabsWrapper}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={CATEGORIES}
            keyExtractor={(c) => c}
            contentContainerStyle={styles.tabsContent}
            renderItem={({ item }) => {
              const active = category === item;
              return (
                <TouchableOpacity
                  onPress={() => setCategory(item)}
                  activeOpacity={0.8}
                  style={[
                    styles.filterTab,
                    { 
                      backgroundColor: active ? colors.primary : colors.surfaceSecondary,
                      borderColor: active ? colors.primary : colors.border
                    }
                  ]}
                >
                  <Text style={[styles.filterText, { color: active ? colors.primaryForeground : colors.mutedForeground, fontFamily: active ? fontFamily.semibold : fontFamily.medium }]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
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
  header: { 
    paddingBottom: 12, 
    borderBottomWidth: 1,
  },
  headerRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    marginBottom: 12,
  },
  headerTitle: { ...font.display },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBtn: {
    width: size.iconButton,
    height: size.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 10, 
    paddingHorizontal: 14,
    marginHorizontal: layout.screenPadding,
    height: size.searchField,
    borderRadius: size.searchRadius,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  searchInput: { flex: 1, height: '100%', ...font.search },
  tabsWrapper: {
    borderTopWidth: 1,
    borderTopColor: 'transparent', // controlled by container
  },
  tabsContent: { 
    paddingHorizontal: 16, 
    gap: 8,
    paddingBottom: 4,
  },
  filterTab: { 
    paddingHorizontal: 16, 
    paddingVertical: 6, 
    borderRadius: 16, 
    borderWidth: 1 
  },
  filterText: { ...font.label },
  list: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  card: { padding: 14, gap: 12, borderRadius: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  itemName: { ...font.itemTitle, marginBottom: space.xs },
  brand: { ...font.caption },
  divider: { height: 1, marginVertical: 2 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stockInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stockBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  stockNum: { ...font.captionStrong },
  minLabel: { ...font.caption },
  price: { ...font.bodyStrong },
  costPrice: { ...font.caption },
});
