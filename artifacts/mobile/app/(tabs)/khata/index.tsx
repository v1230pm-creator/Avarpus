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
import { Avatar } from '@/components/ui/Avatar';
import { DataErrorBanner, DataErrorState } from '@/components/ui/DataStates';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { useKhataLedger } from '@/hooks/useKhataLedger';
import { groupLedgerByParty, type KhataPartyType } from '@/utils/khata-ledger';
import { CustomerFormSheet } from '@/components/forms/CustomerFormSheet';

type FilterState = 'all' | KhataPartyType | 'due' | 'today';

function RepairOnlyKhataScreen() {
  const { canAccess } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { repairs } = useData();
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const inProgress = repairs.filter((repair) => !['ready', 'delivered', 'cancelled'].includes(repair.status)).length;
  const completed = repairs.filter((repair) => ['ready', 'delivered'].includes(repair.status)).length;
  const items = [
    { label: 'All Repairs', value: repairs.length, icon: 'tool' as const, route: '/(tabs)/repairs' },
    { label: 'In Progress', value: inProgress, icon: 'clock' as const, route: '/(tabs)/repairs' },
    { label: 'Completed', value: completed, icon: 'check-circle' as const, route: '/(tabs)/repairs' },
    ...(canAccess('repairs_create')
      ? [{ label: 'Add Repair', value: 'New', icon: 'plus-circle' as const, route: '/(tabs)/repairs/new' }]
      : []),
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Khata</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>Repair book</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { gap: 12 }]} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Repairs</Text>
        {items.map((item) => (
          <TouchableOpacity
            key={item.label}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.75}
            style={[styles.repairHubRow, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.repairHubIcon, { backgroundColor: colors.primary + '14' }]}>
              <Feather name={item.icon} size={19} color={colors.primary} />
            </View>
            <Text style={[styles.repairHubLabel, { color: colors.foreground }]}>{item.label}</Text>
            <Text style={[styles.repairHubValue, { color: colors.primary }]}>{item.value}</Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function FullKhataOverviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ledger, totals, isLoading, error, reload } = useKhataLedger();
  const { customers, loadAll } = useData();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterState>('all');
  const [showSearch, setShowSearch] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([reload(), loadAll()]);
    } finally {
      setRefreshing(false);
    }
  };

  const visibleParties = useMemo(() => {
    const ledgerParties = groupLedgerByParty(ledger);
    const byCustomer = new Map(
      ledgerParties
        .filter((party) => party.partyType === 'customer')
        .map((party) => [party.partyId, party]),
    );
    let result = [
      ...customers.map((customer) => {
        const fromLedger = byCustomer.get(customer.id);
        return {
          partyId: customer.id,
           partyIds: [customer.id],
          partyName: customer.name,
          partyType: 'customer' as const,
          balance: customer.dueAmount,
          lastActivity: fromLedger?.lastActivity ?? customer.createdAt,
        };
      }),
      ...ledgerParties.filter((party) => party.partyType === 'dealer'),
    ];
    if (filter === 'customer') result = result.filter(p => p.partyType === 'customer');
    else if (filter === 'dealer') result = result.filter(p => p.partyType === 'dealer');
    else if (filter === 'due') result = result.filter(p => p.balance > 0);
    else if (filter === 'today') {
      const todayString = new Date().toDateString();
      result = result.filter(p => p.balance > 0 && new Date(p.lastActivity).toDateString() === todayString);
    }

    const query = search.trim().toLowerCase();
    if (query) {
      result = result.filter((p) => p.partyName.toLowerCase().includes(query));
    }

    // Sort by balance descending (highest due first), then by newest activity
    return result.sort((a, b) => {
      if (b.balance !== a.balance) return b.balance - a.balance;
      return b.lastActivity.localeCompare(a.lastActivity);
    });
  }, [customers, ledger, filter, search]);

  const receivableTotal = useMemo(() => {
    const dealerBalances = groupLedgerByParty(ledger)
      .filter((party) => party.partyType === 'dealer')
      .reduce((sum, party) => sum + Math.max(party.balance, 0), 0);
    return customers.reduce((sum, customer) => sum + Math.max(customer.dueAmount, 0), dealerBalances);
  }, [customers, ledger]);

  const openParty = (
    partyType: KhataPartyType,
    partyId: string,
    partyName: string,
    partyIds: string[],
  ) => {
    const mergedIds =
      partyType === 'dealer' && partyIds.length > 1
        ? `&ids=${encodeURIComponent(partyIds.join(','))}`
        : '';
    router.push(
      `/(tabs)/khata/party/${partyType}/${partyId}?name=${encodeURIComponent(partyName)}${mergedIds}`,
    );
  };

  const formatDateLabel = (isoDate: string) => {
    const d = new Date(isoDate);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return `Today`;
    }
    return d.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short'
    });
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
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Shop Khata</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>Ledger Book</Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setShowSearch((visible) => !visible)}
          accessibilityLabel="Search Khata"
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
              placeholder="Search customer or supplier..."
              placeholderTextColor={colors.mutedForeground}
              style={{ flex: 1, color: colors.foreground, fontFamily: 'Inter_400Regular' }}
              autoFocus
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search">
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {!!error && <DataErrorBanner onRetry={reload} />}

        <View style={[styles.netBalanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.netBalanceRow}>
            <View style={styles.netBalanceCell}>
              <View style={styles.netBalanceHeader}>
                <Feather name="arrow-up-right" size={14} color={colors.success} />
                <Text style={[styles.netBalanceLabel, { color: colors.mutedForeground }]}>You will give</Text>
              </View>
              <Text style={[styles.netBalanceValue, { color: colors.success }]}>
                {formatCurrency(0 /* Future: Dealers payable */)}
              </Text>
            </View>
            <View style={[styles.netBalanceDivider, { backgroundColor: colors.border }]} />
            <View style={styles.netBalanceCell}>
              <View style={styles.netBalanceHeader}>
                <Feather name="arrow-down-left" size={14} color={colors.destructive} />
                <Text style={[styles.netBalanceLabel, { color: colors.mutedForeground }]}>You will get</Text>
              </View>
              <Text style={[styles.netBalanceValue, { color: colors.destructive }]}>
                 {formatCurrency(receivableTotal)}
              </Text>
            </View>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {(['all', 'customer', 'dealer', 'due', 'today'] as const).map((value) => {
            const active = filter === value;
            const labels: Record<string, string> = { all: 'All', customer: 'Customers', dealer: 'Suppliers', due: 'Pending', today: 'Due Today' };
            return (
              <TouchableOpacity
                key={value}
                onPress={() => setFilter(value)}
                style={[styles.filterChip, { backgroundColor: active ? colors.primary + '15' : colors.card, borderColor: active ? colors.primary : colors.border }]}
              >
                <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 13, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium' }}>
                  {labels[value]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.partyList}>
          {visibleParties.length > 0 ? (
            visibleParties.map((party) => (
              <TouchableOpacity
                key={party.partyId}
                activeOpacity={0.7}
                onPress={() =>
                  openParty(party.partyType, party.partyId, party.partyName, party.partyIds)
                }
                style={[styles.partyRow, { borderBottomColor: colors.border }]}
              >
                <Avatar name={party.partyName} size={42} />
                <View style={styles.partyInfo}>
                  <Text style={[styles.partyName, { color: colors.foreground }]} numberOfLines={1}>
                    {party.partyName}
                  </Text>
                  <Text style={[styles.partyDate, { color: colors.mutedForeground }]}>
                    {formatDateLabel(party.lastActivity)}
                  </Text>
                </View>
                <View style={styles.partyAmountBox}>
                  {party.balance > 0 ? (
                    <Text style={[styles.partyAmount, { color: colors.destructive }]}>
                      {formatCurrency(party.balance)}
                    </Text>
                  ) : party.balance < 0 ? (
                    <Text style={[styles.partyAmount, { color: colors.success }]}>
                      {formatCurrency(Math.abs(party.balance))}
                    </Text>
                  ) : (
                    <Text style={[styles.partyAmount, { color: colors.mutedForeground }]}>
                      {formatCurrency(0)}
                    </Text>
                  )}
                  <Text style={[styles.partyDueLabel, { color: colors.mutedForeground }]}>
                    {party.balance > 0 ? 'Due' : party.balance < 0 ? 'Advance' : 'Settled'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {search ? 'No matches found' : 'No ledger entries'}
            </Text>
          )}
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary, bottom: insets.bottom + 16 }]}
        onPress={() => setShowAddCustomer(true)}
        activeOpacity={0.9}
      >
        <Feather name="user-plus" size={20} color="#fff" />
        <Text style={styles.fabText}>Add Customer</Text>
      </TouchableOpacity>

      <CustomerFormSheet visible={showAddCustomer} onClose={() => setShowAddCustomer(false)} />
    </View>
  );
}

export default function KhataOverviewScreen() {
  const { canAccess } = useAuth();
  return canAccess('payments') ? <FullKhataOverviewScreen /> : <RepairOnlyKhataScreen />;
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
  filterScroll: {
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  headerSubtitle: { fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 2 },
  scroll: { paddingBottom: 100 },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 12, marginHorizontal: 16 },

  netBalanceCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  netBalanceRow: {
    flexDirection: 'row',
    paddingVertical: 16,
  },
  netBalanceCell: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  netBalanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  netBalanceLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  netBalanceValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  netBalanceDivider: { width: 1, height: '100%' },

  partyList: { paddingHorizontal: 16, paddingBottom: 24 },
  partyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  partyInfo: { flex: 1, justifyContent: 'center' },
  partyName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  partyDate: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  partyAmountBox: { alignItems: 'flex-end', justifyContent: 'center' },
  partyAmount: { fontSize: 15, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  partyDueLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 40, fontFamily: 'Inter_500Medium' },
  
  fab: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 28,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  fabText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },

  repairHubRow: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  repairHubIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repairHubLabel: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  repairHubValue: { fontSize: 13, fontFamily: 'Inter_700Bold' },
});