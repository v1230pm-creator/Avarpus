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
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { Customer } from '@/types';
import { formatCurrency, formatDate } from '@/utils/helpers';

function CustomerCard({ customer, onPress }: { customer: Customer; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <Avatar name={customer.name} size={48} />
      <View style={styles.cardContent}>
        <Text style={[styles.customerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{customer.name}</Text>
        <Text style={[styles.mobile, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{customer.mobile}</Text>
        <View style={styles.cardMeta}>
          <View style={[styles.metaBadge, { backgroundColor: colors.secondary }]}>
            <Feather name="tool" size={11} color={colors.primary} />
            <Text style={[styles.metaText, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>
              {customer.totalRepairs} repairs
            </Text>
          </View>
          {customer.dueAmount > 0 && (
            <View style={[styles.metaBadge, { backgroundColor: colors.warningLight }]}>
              <Feather name="alert-circle" size={11} color={colors.warning} />
              <Text style={[styles.metaText, { color: colors.warning, fontFamily: 'Inter_600SemiBold' }]}>
                Due {formatCurrency(customer.dueAmount)}
              </Text>
            </View>
          )}
        </View>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

export default function CustomersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { customers } = useData();
  const [search, setSearch] = useState('');

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const filtered = useMemo(() => {
    let list = customers;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.mobile.includes(q) ||
        (c.email ?? '').toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [customers, search]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Customers</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {filtered.length} records
            </Text>
          </View>
        </View>
        <View style={[styles.searchBar, { backgroundColor: colors.input, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or mobile..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title="No customers found"
            description={search ? 'Try a different search term' : 'No customers have been added yet'}
          />
        }
        renderItem={({ item }) => (
          <CustomerCard customer={item} onPress={() => router.push(`/(tabs)/customers/${item.id}`)} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerTitle: { fontSize: 26 },
  headerSub: { fontSize: 13 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 44, fontSize: 14 },
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderWidth: 1,
    shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4, elevation: 1,
  },
  cardContent: { flex: 1, gap: 4 },
  customerName: { fontSize: 15 },
  mobile: { fontSize: 13 },
  cardMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  metaBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  metaText: { fontSize: 11 },
});
