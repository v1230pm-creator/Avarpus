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
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { RepairStatusBadge, PriorityBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Repair } from '@/types';
import { formatDate, formatCurrency } from '@/utils/helpers';

const FILTERS = ['All', 'Active', 'Ready', 'Delivered', 'Cancelled'] as const;
type Filter = (typeof FILTERS)[number];

function RepairCard({ repair, onPress }: { repair: Repair; onPress: () => void }) {
  const colors = useColors();
  const balance = Math.max(0, repair.repairCharge + repair.partsCharge - repair.advance);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <View style={styles.cardTop}>
        <View style={[styles.repairIdBadge, { backgroundColor: colors.primary + '1A' }]}>
          <Text style={[styles.repairId, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{repair.repairId}</Text>
        </View>
        <PriorityBadge priority={repair.priority} />
      </View>
      <Text style={[styles.customerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{repair.customerName}</Text>
      <Text style={[styles.deviceLine, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        {repair.deviceType} · {repair.brand} {repair.model}
      </Text>
      <Text style={[styles.problem, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
        {repair.problem}
      </Text>
      <View style={styles.cardBottom}>
        <RepairStatusBadge status={repair.status} />
        <View style={styles.cardBottomRight}>
          {balance > 0 && (
            <Text style={[styles.balance, { color: colors.warning, fontFamily: 'Inter_600SemiBold' }]}>
              Due {formatCurrency(balance)}
            </Text>
          )}
          <Text style={[styles.dateText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {formatDate(repair.createdAt)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function RepairsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { canAccess, user } = useAuth();
  const { repairs } = useData();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('All');

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const filtered = useMemo(() => {
    let list = repairs;
    // Technicians see only their assigned repairs
    if (user?.role === 'technician') {
      list = list.filter((r) => r.technicianId === user.id);
    }
    if (filter === 'Active') list = list.filter((r) => !['delivered', 'cancelled', 'ready'].includes(r.status));
    else if (filter === 'Ready') list = list.filter((r) => r.status === 'ready');
    else if (filter === 'Delivered') list = list.filter((r) => r.status === 'delivered');
    else if (filter === 'Cancelled') list = list.filter((r) => r.status === 'cancelled');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.customerName.toLowerCase().includes(q) ||
        r.repairId.toLowerCase().includes(q) ||
        r.brand.toLowerCase().includes(q) ||
        r.model.toLowerCase().includes(q) ||
        r.mobile.includes(q),
      );
    }
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [repairs, filter, search, user]);

  const canCreateRepair = canAccess('repairs') && user?.role !== 'technician';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 16, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Repairs</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {filtered.length} jobs
            </Text>
          </View>
          {canCreateRepair && (
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/repairs/new')}
              style={[styles.addBtn, { backgroundColor: colors.primary }]}
            >
              <Feather name="plus" size={18} color="#FFFFFF" />
              <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>New</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Search */}
        <View style={[styles.searchBar, { backgroundColor: colors.input, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search repairs..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Tabs */}
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
                style={[styles.filterTab, {
                  backgroundColor: active ? colors.primary : colors.muted,
                  borderColor: active ? colors.primary : colors.border,
                }]}
              >
                <Text style={[styles.filterText, {
                  color: active ? '#FFFFFF' : colors.mutedForeground,
                  fontFamily: active ? 'Inter_600SemiBold' : 'Inter_400Regular',
                }]}>{item}</Text>
              </TouchableOpacity>
            );
          }}
          style={{ paddingBottom: 2 }}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="tool"
            title="No repairs found"
            description={search ? 'Try a different search term' : 'No repairs match the current filter'}
            actionLabel={canCreateRepair ? 'Create Repair' : undefined}
            onAction={canCreateRepair ? () => router.push('/(tabs)/repairs/new') : undefined}
          />
        }
        renderItem={({ item }) => (
          <RepairCard repair={item} onPress={() => router.push(`/(tabs)/repairs/${item.id}`)} />
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
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  addBtnText: { color: '#FFFFFF', fontSize: 14 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 44, fontSize: 14 },
  filterTab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterText: { fontSize: 13 },
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  card: { padding: 14, gap: 7, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4, elevation: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  repairIdBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  repairId: { fontSize: 11 },
  customerName: { fontSize: 15 },
  deviceLine: { fontSize: 13 },
  problem: { fontSize: 12 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  cardBottomRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  balance: { fontSize: 12 },
  dateText: { fontSize: 12 },
});
