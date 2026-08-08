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
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { Avatar } from '@/components/ui/Avatar';
import { SampleBadge } from '@/components/ui/Badge';
import { GlassCard, ScreenGlow, FadeInView, useIsDark } from '@/components/ui/Glass';
import { CustomerFormSheet } from '@/components/forms/CustomerFormSheet';
import { Customer } from '@/types';
import { formatCurrency, formatDate } from '@/utils/helpers';

function CustomerCard({ customer, onPress }: { customer: Customer; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <GlassCard style={styles.card}>
        <Avatar name={customer.name} size={48} />
        <View style={styles.cardContent}>
          <Text style={[styles.customerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{customer.name}</Text>
          <Text style={[styles.mobile, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{customer.mobile}</Text>
          <View style={styles.cardMeta}>
            {customer.isSample && <SampleBadge />}
            <View style={[styles.metaBadge, { backgroundColor: colors.primary + '15' }]}>
              <Feather name="tool" size={11} color={colors.primary} />
              <Text style={[styles.metaText, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>
                {customer.totalRepairs} repairs
              </Text>
            </View>
            {customer.dueAmount > 0 && (
              <View style={[styles.metaBadge, { backgroundColor: colors.warning + '15' }]}>
                <Feather name="alert-circle" size={11} color={colors.warning} />
                <Text style={[styles.metaText, { color: colors.warning, fontFamily: 'Inter_600SemiBold' }]}>
                  Due {formatCurrency(customer.dueAmount)}
                </Text>
              </View>
            )}
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </GlassCard>
    </TouchableOpacity>
  );
}

export default function CustomersScreen() {
  const colors = useColors();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { customers, isLoading, loadError, loadAll } = useData();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

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
      <ScreenGlow />

      <FadeInView animValue={headerAnim} style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Customers</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {filtered.length} records
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setShowAdd(true)}
            activeOpacity={0.85}
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
          >
            <Feather name="plus" size={18} color="#FFFFFF" />
            <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Add</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.searchBar, {
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
        }]}>
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
      </FadeInView>

      {isLoading && customers.length === 0 ? (
        <DataLoadingState />
      ) : loadError && customers.length === 0 ? (
        <DataErrorState onRetry={loadAll} />
      ) : (
      <>
      {!!loadError && <DataErrorBanner onRetry={loadAll} />}
      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
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
      </>
      )}

      <CustomerFormSheet visible={showAdd} onClose={() => setShowAdd(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerTitle: { fontSize: 28 },
  headerSub: { fontSize: 13, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14 },
  addBtnText: { color: '#FFFFFF', fontSize: 14 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14 },
  searchInput: { flex: 1, height: 46, fontSize: 14 },
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14,
  },
  cardContent: { flex: 1, gap: 4 },
  customerName: { fontSize: 15 },
  mobile: { fontSize: 13 },
  cardMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  metaBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  metaText: { fontSize: 11 },
});
