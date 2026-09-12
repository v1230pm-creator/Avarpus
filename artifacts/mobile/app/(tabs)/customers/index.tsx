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
  useColorScheme,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { Avatar } from '@/components/ui/Avatar';
import { SampleBadge } from '@/components/ui/Badge';
import { FlatCard } from '@/components/ui/FlatCard';
import { FadeInView, useIsDark } from '@/components/ui/Glass';
import { CustomerFormSheet } from '@/components/forms/CustomerFormSheet';
import { Customer } from '@/types';
import { formatCurrency, formatDate } from '@/utils/helpers';

function CustomerCard({ customer, onPress, theme }: { customer: Customer; onPress: () => void; theme: any }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <FlatCard style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Avatar name={customer.name} size={44} />
        <View style={styles.cardContent}>
          <Text style={[styles.customerName, { color: theme.text, fontFamily: 'Inter_600SemiBold' }]}>{customer.name}</Text>
          <Text style={[styles.mobile, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]}>{customer.mobile}</Text>
          <View style={styles.cardMeta}>
            {customer.isSample && <SampleBadge />}
            <View style={[styles.metaBadge, { backgroundColor: theme.primary + '15' }]}>
              <Feather name="tool" size={10} color={theme.primary} />
              <Text style={[styles.metaText, { color: theme.primary, fontFamily: 'Inter_500Medium' }]}>
                {customer.totalRepairs} repairs
              </Text>
            </View>
            {customer.dueAmount > 0 && (
              <View style={[styles.metaBadge, { backgroundColor: theme.warning + '15' }]}>
                <Feather name="alert-circle" size={10} color={theme.warning} />
                <Text style={[styles.metaText, { color: theme.warning, fontFamily: 'Inter_600SemiBold' }]}>
                  Due {formatCurrency(customer.dueAmount)}
                </Text>
              </View>
            )}
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={theme.textMuted} />
      </FlatCard>
    </TouchableOpacity>
  );
}

export default function CustomersScreen() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  
  const theme = {
    bg: colors.background,
    card: colors.card,
    border: colors.border,
    primary: isDark ? '#2563EB' : colors.primary,
    text: colors.foreground,
    textMuted: colors.mutedForeground,
    inputBg: colors.input,
    warning: isDark ? '#F59E0B' : colors.warning,
  };

  const { user } = useAuth();
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
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <FadeInView animValue={headerAnim} style={[styles.header, { paddingTop: topPad + 12, backgroundColor: theme.bg }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.headerTitle, { color: theme.text, fontFamily: 'Inter_700Bold' }]}>Customers</Text>
            <Text style={[styles.headerSub, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]}>
              {filtered.length} records
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/more')}
              style={{
                width: 38, height: 38, borderRadius: 19,
                backgroundColor: theme.inputBg,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: theme.border
              }}
            >
              <Avatar name={user?.name ?? 'User'} size={34} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowAdd(true)}
              activeOpacity={0.85}
              style={[styles.addBtn, { backgroundColor: theme.primary }]}
            >
              <Feather name="plus" size={16} color="#FFFFFF" />
              <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.searchBar, {
          backgroundColor: theme.inputBg,
          borderColor: theme.border,
        }]}>
          <Feather name="search" size={14} color={theme.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or mobile..."
            placeholderTextColor={theme.textMuted}
            style={[styles.searchInput, { color: theme.text, fontFamily: 'Inter_400Regular' }]}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={14} color={theme.textMuted} />
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title="No customers found"
            description={search ? 'Try a different search term' : 'No customers have been added yet'}
          />
        }
        renderItem={({ item }) => (
          <CustomerCard customer={item} onPress={() => router.push(`/(tabs)/customers/${item.id}`)} theme={theme} />
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
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerTitle: { fontSize: 24, letterSpacing: -0.5 },
  headerSub: { fontSize: 12, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  addBtnText: { color: '#FFFFFF', fontSize: 13 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 40, fontSize: 13 },
  list: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
  },
  cardContent: { flex: 1, gap: 4 },
  customerName: { fontSize: 14 },
  mobile: { fontSize: 12 },
  cardMeta: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  metaBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12 },
  metaText: { fontSize: 10 },
});
