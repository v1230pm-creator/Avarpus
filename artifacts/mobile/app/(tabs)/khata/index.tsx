import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCurrency } from '@/utils/helpers';
import { FlatCard } from '@/components/ui/FlatCard';
import { Avatar } from '@/components/ui/Avatar';
import { DataErrorBanner, DataErrorState } from '@/components/ui/DataStates';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { useKhataLedger } from '@/hooks/useKhataLedger';
import type { LedgerEntry, KhataPartyType } from '@/utils/khata-ledger';

type FilterState = 'all' | KhataPartyType;

export default function KhataOverviewScreen() {
  const { user, canAccess } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ledger, totals, isLoading, error, reload } = useKhataLedger();
  const { repairs } = useData();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterState>('all');
  const [showSearch, setShowSearch] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const repairsInProgress = repairs.filter(r => r.status !== 'delivered' && r.status !== 'cancelled').length;
  const repairsCompleted = repairs.filter(r => r.status === 'ready' || r.status === 'delivered').length;

  const featureItems = [
    { id: 'repairs', label: 'All Repairs', sub: repairs.length.toString(), icon: 'target' as const, route: '/(tabs)/repairs' },
    { id: 'progress', label: 'In Progress', sub: repairsInProgress.toString(), icon: 'clock' as const, route: '/(tabs)/repairs' },
    { id: 'completed', label: 'Completed', sub: repairsCompleted.toString(), icon: 'check-square' as const, route: '/(tabs)/repairs' },
    { id: 'receivables', label: 'Receivables', sub: formatCurrency(totals.due), icon: 'pie-chart' as const, route: '/(tabs)/khata/receivables' },
    ...(canAccess('finance')
      ? [{ id: 'payments', label: 'Payments', sub: formatCurrency(totals.paid), icon: 'dollar-sign' as const, route: '/(tabs)/more/finance' }]
      : [{ id: 'payments_ph', label: 'Payments', sub: 'Locked', icon: 'lock' as const, route: null }]),
    { id: 'book', label: 'Khata Book', sub: 'View All', icon: 'book' as const, route: '/(tabs)/customers' },
    ...(canAccess('repairs_create')
      ? [{ id: 'add', label: 'Add Repair', sub: 'New', icon: 'plus-circle' as const, route: '/(tabs)/repairs/new' }]
      : [{ id: 'add_ph', label: 'Add Repair', sub: 'Locked', icon: 'lock' as const, route: null }]),
    { id: 'receive', label: 'Receive Payment', sub: 'New', icon: 'arrow-down-circle' as const, route: '/(tabs)/repairs' },
    ...(canAccess('reports')
      ? [{ id: 'reports', label: 'Reports', sub: 'View', icon: 'bar-chart-2' as const, route: '/(tabs)/more/reports' }]
      : [{ id: 'reports_ph', label: 'Reports', sub: 'Locked', icon: 'lock' as const, route: null }]),
  ];

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  const visibleLedger = useMemo(() => {
    let result = ledger;
    if (filter !== 'all') {
      result = result.filter((entry) => entry.partyType === filter);
    }
    const query = search.trim().toLowerCase();
    if (query) {
      result = result.filter(
        (entry) =>
          entry.partyName.toLowerCase().includes(query) ||
          entry.repairId.toLowerCase().includes(query)
      );
    }
    return result;
  }, [ledger, filter, search]);

  const openParty = (entry: LedgerEntry) => {
    router.push(
      `/(tabs)/khata/party/${entry.partyType}/${entry.partyId}?name=${encodeURIComponent(
        entry.partyName
      )}`
    );
  };

  const formatDateLabel = (isoDate: string) => {
    const d = new Date(isoDate);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return `Today, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  };

  const renderEntry = (entry: LedgerEntry) => {
    const isDebit = entry.debit > 0;
    const isCredit = entry.credit > 0;
    const amount = isDebit ? entry.debit : entry.credit;

    return (
      <TouchableOpacity
        key={entry.id}
        activeOpacity={0.75}
        onPress={() => openParty(entry)}
        style={styles.entryPressable}
      >
        <View style={styles.entryRow}>
          <View style={[styles.entryIconBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name={isDebit ? 'tool' : 'download'} size={14} color={colors.mutedForeground} />
          </View>
          <View style={styles.entryInfo}>
            <Text style={[styles.entryTitle, { color: colors.foreground }]} numberOfLines={1}>
              {isDebit ? `Repair #${entry.repairId}` : 'Payment Received'}
            </Text>
            <Text style={[styles.entryDesc, { color: colors.mutedForeground }]} numberOfLines={1}>
              {isDebit ? entry.label : `From ${entry.partyName}`}
            </Text>
            <Text style={[styles.entryDate, { color: colors.mutedForeground }]}>{formatDateLabel(entry.date)}</Text>
          </View>
          <View style={styles.entryAmountBox}>
            <Text style={[styles.entryAmount, { color: isCredit ? colors.success : colors.destructive }]}>
              {formatCurrency(amount)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading && ledger.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error && ledger.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPadding }]}>
        <DataErrorState onRetry={reload} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16 }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/(tabs)/more')}>
          <Feather name="menu" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Khata</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>Repair, Receive, Payments & Accounts</Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setShowSearch((visible) => !visible)}
          accessibilityLabel="Search Khata activity"
        >
          <Feather name="search" size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {showSearch && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 10 }}>
          <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search customer or repair"
              placeholderTextColor={colors.mutedForeground}
              style={{ flex: 1, color: colors.foreground, fontFamily: 'Inter_400Regular' }}
              autoFocus
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear Khata search">
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['all', 'customer', 'dealer'] as const).map((value) => {
              const active = filter === value;
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setFilter(value)}
                  style={[styles.filterChip, { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border }]}
                >
                  <Text style={{ color: active ? colors.primaryForeground : colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' }}>
                    {value}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {!!error && <DataErrorBanner onRetry={reload} />}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Business Summary</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Business</Text>
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>{formatCurrency(totals.billed)}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Received</Text>
            <Text style={[styles.summaryValue, { color: colors.success }]}>{formatCurrency(totals.paid)}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Outstanding</Text>
            <Text style={[styles.summaryValue, { color: totals.due > 0 ? colors.destructive : colors.success }]}>
              {formatCurrency(totals.due)}
            </Text>
          </View>
        </View>

        <View style={[styles.glowBoxWrapper, { shadowColor: colors.primary, backgroundColor: colors.border }]}>
          <View style={[styles.glowGridContainer, { backgroundColor: colors.card }]}>
            <View style={styles.gridRow}>
              {featureItems.slice(0, 3).map((item, idx) => (
                <TouchableOpacity key={item.id} style={[styles.gridCell, idx !== 2 && { borderRightWidth: 1, borderRightColor: colors.border }, { borderBottomWidth: 1, borderBottomColor: colors.border }]} onPress={() => item.route && router.push(item.route as any)}>
                  <Feather name={item.icon} size={18} color={colors.mutedForeground} style={styles.gridIcon} />
                  <Text style={[styles.gridLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
                  <Text style={[styles.gridSub, { color: colors.foreground }, item.sub.includes('₹') || item.sub === 'New' || item.sub === 'View' ? { color: colors.primary } : {}]}>{item.sub}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.gridRow}>
              {featureItems.slice(3, 6).map((item, idx) => (
                <TouchableOpacity key={item.id} style={[styles.gridCell, idx !== 2 && { borderRightWidth: 1, borderRightColor: colors.border }, { borderBottomWidth: 1, borderBottomColor: colors.border }]} onPress={() => item.route && router.push(item.route as any)}>
                  <Feather name={item.icon} size={18} color={colors.mutedForeground} style={styles.gridIcon} />
                  <Text style={[styles.gridLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
                  <Text style={[styles.gridSub, { color: colors.primary }]}>{item.sub}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.gridRow}>
              {featureItems.slice(6, 9).map((item, idx) => (
                <TouchableOpacity key={item.id} style={[styles.gridCell, idx !== 2 && { borderRightWidth: 1, borderRightColor: colors.border }]} onPress={() => item.route && router.push(item.route as any)}>
                  <Feather name={item.icon} size={18} color={colors.mutedForeground} style={styles.gridIcon} />
                  <Text style={[styles.gridLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
                  <Text style={[styles.gridSub, { color: colors.primary }]}>{item.sub}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>Recent Activity</Text>
        <View style={styles.activityList}>
          {visibleLedger.length > 0 ? (
            visibleLedger.slice(0, 10).map(renderEntry)
          ) : (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No recent activity</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  iconBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  searchBox: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  headerSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  scroll: { paddingHorizontal: 16, paddingBottom: 100 },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    marginBottom: 24,
  },
  summaryCell: { flex: 1 },
  summaryLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 4 },
  summaryValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },

  glowBoxWrapper: {
    borderRadius: 16,
    padding: 1, // For gradient/border effect
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 10,
  },
  glowGridContainer: {
    borderRadius: 15,
    overflow: 'hidden',
  },
  gridRow: { flexDirection: 'row' },
  gridCell: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridIcon: { marginBottom: 8 },
  gridLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 4 },
  gridSub: { fontSize: 13, fontFamily: 'Inter_700Bold' },

  activityList: { gap: 16 },
  entryPressable: {},
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  entryIconBox: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center'
  },
  entryInfo: { flex: 1 },
  entryTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  entryDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  entryDate: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  entryAmountBox: { alignItems: 'flex-end' },
  entryAmount: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  
  emptyText: { fontSize: 13, textAlign: 'center', marginTop: 20 },
});


