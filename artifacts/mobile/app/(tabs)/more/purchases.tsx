import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
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
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Purchase } from '@/types';
import { formatCurrency, formatDate } from '@/utils/helpers';

const PAYMENT_STATUS_COLORS = {
  paid: 'success',
  unpaid: 'error',
  partial: 'warning',
} as const;

function PurchaseCard({ purchase }: { purchase: Purchase }) {
  const colors = useColors();
  const balance = purchase.totalAmount - purchase.paidAmount;
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <View style={styles.cardTop}>
        <View style={[styles.invoiceBadge, { backgroundColor: colors.primary + '1A' }]}>
          <Text style={[styles.invoiceId, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{purchase.invoiceNo}</Text>
        </View>
        <Badge
          label={purchase.paymentStatus.charAt(0).toUpperCase() + purchase.paymentStatus.slice(1)}
          variant={PAYMENT_STATUS_COLORS[purchase.paymentStatus]}
          size="sm"
        />
      </View>

      <Text style={[styles.supplier, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{purchase.supplier}</Text>
      <Text style={[styles.itemsText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        {purchase.items.length} item{purchase.items.length !== 1 ? 's' : ''} purchased
      </Text>

      <View style={[styles.itemList, { borderTopColor: colors.border }]}>
        {purchase.items.slice(0, 2).map((item, idx) => (
          <Text key={idx} style={[styles.itemLine, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
            • {item.name} × {item.quantity} @ {formatCurrency(item.unitPrice)}
          </Text>
        ))}
        {purchase.items.length > 2 && (
          <Text style={[styles.moreItems, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>
            +{purchase.items.length - 2} more items
          </Text>
        )}
      </View>

      <View style={styles.cardFooter}>
        <View>
          <Text style={[styles.totalAmount, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            {formatCurrency(purchase.totalAmount)}
          </Text>
          {balance > 0 && (
            <Text style={[styles.balanceText, { color: colors.warning, fontFamily: 'Inter_500Medium' }]}>
              Due: {formatCurrency(balance)}
            </Text>
          )}
        </View>
        <Text style={[styles.dateText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {formatDate(purchase.date)}
        </Text>
      </View>
    </View>
  );
}

export default function PurchasesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { purchases } = useData();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'All' | 'Unpaid' | 'Paid' | 'Partial'>('All');

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

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
    () => purchases.filter((p) => p.paymentStatus !== 'paid').reduce((s, p) => s + (p.totalAmount - p.paidAmount), 0),
    [purchases],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 14, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
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

      <View style={[styles.searchWrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.input, borderColor: colors.border }]}>
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
                style={[styles.filterTab, { backgroundColor: active ? colors.primary : colors.muted, borderColor: active ? colors.primary : colors.border }]}
              >
                <Text style={[styles.filterText, { color: active ? '#FFFFFF' : colors.mutedForeground, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_400Regular' }]}>
                  {f}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<EmptyState icon="shopping-bag" title="No purchases found" description="No purchase orders match the current filter" />}
        renderItem={({ item }) => <PurchaseCard purchase={item} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22 },
  headerSub: { fontSize: 12 },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 10 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 44, fontSize: 14 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterTab: { flex: 1, paddingVertical: 7, borderRadius: 20, borderWidth: 1, alignItems: 'center' },
  filterText: { fontSize: 12 },
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  card: { padding: 14, gap: 8, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4, elevation: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  invoiceBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
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
