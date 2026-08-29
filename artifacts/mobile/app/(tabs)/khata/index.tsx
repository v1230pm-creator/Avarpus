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
import { useAuth } from '@/context/AuthContext';
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
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterState>('all');
  const [refreshing, setRefreshing] = useState(false);
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const featureItems = [
    { id: 'repairs', label: 'All Repairs', icon: 'tool' as const, route: '/(tabs)/repairs' },
    { id: 'progress', label: 'In Progress', icon: 'clock' as const, route: '/(tabs)/repairs' },
    { id: 'completed', label: 'Completed', icon: 'check-circle' as const, route: '/(tabs)/repairs' },
    { id: 'receivables', label: 'Receivables', icon: 'trending-up' as const, route: null },
    { id: 'payments', label: 'Payments', icon: 'credit-card' as const, route: null },
    { id: 'book', label: 'Khata Book', icon: 'book-open' as const, route: null },
    ...(canAccess('repairs_create')
      ? [{ id: 'add', label: 'Add Repair', icon: 'plus-circle' as const, route: '/(tabs)/repairs/new' }]
      : []),
    { id: 'receive', label: 'Receive Payment', icon: 'download' as const, route: '/(tabs)/repairs' },
    ...(canAccess('reports')
      ? [{ id: 'reports', label: 'Reports', icon: 'bar-chart-2' as const, route: '/(tabs)/more/reports' }]
      : []),
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
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
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
          <FlatCard style={styles.entryCard}>
          <View style={styles.entryHeader}>
            <Text style={[styles.entryDate, { color: colors.mutedForeground }]}>{formatDateLabel(entry.date)}</Text>
            <View style={[styles.repairIdBadge, { backgroundColor: colors.accent }]}>
              <Text style={[styles.repairIdText, { color: colors.primary }]}>{entry.repairId}</Text>
            </View>
          </View>

          <View style={styles.entryBody}>
            <Avatar name={entry.partyName} size={38} />
            <View style={styles.partyInfo}>
              <View style={styles.partyNameRow}>
                <Text style={[styles.partyName, { color: colors.foreground }]} numberOfLines={1}>
                  {entry.partyName}
                </Text>
                <View style={[styles.typeBadge, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={[styles.typeText, { color: colors.mutedForeground }]}>
                    {entry.partyType === 'dealer' ? 'Dealer' : 'Customer'}
                  </Text>
                </View>
              </View>
              <Text style={[styles.entryLabel, { color: colors.mutedForeground }]}>
                {entry.label}
                {entry.method ? ` • ${entry.method.toUpperCase()}` : ''}
              </Text>
            </View>

            <View style={styles.amountInfo}>
              {isDebit ? (
                <Text style={[styles.debitText, { color: colors.destructive }]}>
                  {formatCurrency(amount)} DEBIT
                </Text>
              ) : isCredit ? (
                <Text style={[styles.creditText, { color: colors.success }]}>
                  {formatCurrency(amount)} CREDIT
                </Text>
              ) : null}
              <Text
                style={[
                    styles.balanceText,
                    { color: colors.mutedForeground },
                    entry.partyBalance <= 0 && { color: colors.success },
                ]}
              >
                Bal: {formatCurrency(entry.partyBalance)}
              </Text>
            </View>
          </View>
        </FlatCard>
      </TouchableOpacity>
    );
  };

  if (isLoading && ledger.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Loading Ledger…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPadding + 16,
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Khata</Text>
            <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
              Repair, Receive, Payments &amp; Accounts
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => router.push('/(tabs)/more')}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: colors.backgroundSecondary,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Avatar name={user?.name ?? 'User'} size={40} />
            <View
              style={{
                position: 'absolute',
                bottom: -2,
                right: -2,
                backgroundColor: colors.card,
                borderRadius: 10,
                padding: 2,
              }}
            >
              <Feather name="menu" size={12} color={colors.primary} />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0B63F6" />
        }
      >
        {!!error && (
          <FlatCard style={styles.errorCard}>
            <Feather name="alert-circle" size={18} color="#EF4444" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={reload} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </FlatCard>
        )}

        <FlatCard style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Business</Text>
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>{formatCurrency(totals.billed)}</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Received</Text>
            <Text style={[styles.summaryValue, { color: colors.success }]}>{formatCurrency(totals.paid)}</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Outstanding</Text>
            <Text
              style={[
                styles.summaryValue,
                { color: totals.due > 0 ? colors.destructive : colors.success },
              ]}
            >
              {formatCurrency(totals.due)}
            </Text>
          </View>
        </FlatCard>

        <View style={styles.featureGrid}>
          {featureItems.map((item) => (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.78}
              onPress={() => item.route ? router.push(item.route as any) : undefined}
              style={[
                styles.featureCard,
                {
                  backgroundColor: colors.card,
                  borderColor: item.id === 'book' ? colors.primary : colors.border,
                  shadowColor: item.id === 'book' ? colors.primary : 'transparent',
                },
              ]}
            >
              <View style={[styles.featureIcon, { backgroundColor: colors.accent }]}>
                <Feather name={item.icon} size={18} color={item.id === 'book' ? colors.gold : colors.primary} />
              </View>
              <Text style={[styles.featureLabel, { color: colors.secondaryForeground }]} numberOfLines={2}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.searchBar, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="search" size={17} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search customer, dealer or ticket..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search">
              <Feather name="x" size={17} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.filters}>
          {(
            [
              ['all', 'All'],
              ['customer', 'Customers'],
              ['dealer', 'Dealers'],
            ] as const
          ).map(([value, label]) => (
            <TouchableOpacity
              key={value}
              onPress={() => setFilter(value as FilterState)}
              style={[
                styles.filterButton,
                { backgroundColor: colors.card, borderColor: colors.border },
                filter === value && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
            >
              <Text style={[styles.filterText, { color: colors.mutedForeground }, filter === value && styles.filterTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.section}>
          {visibleLedger.length > 0 ? (
            visibleLedger.map(renderEntry)
          ) : (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="list" size={28} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No ledger entries</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {search || filter !== 'all'
                  ? 'Try changing your search or filter.'
                  : 'Ledger will automatically populate with repair bills and payments.'}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 3,
    fontFamily: 'Inter_400Regular',
  },
  scroll: { padding: 16, paddingBottom: 110, width: '100%', maxWidth: 760, alignSelf: 'center' },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    borderColor: '#FECACA',
  },
  errorText: { flex: 1, color: '#991B1B', fontSize: 12, fontFamily: 'Inter_400Regular' },
  retryButton: { paddingHorizontal: 10, paddingVertical: 7 },
  retryText: { color: '#0B63F6', fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  summaryCard: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  summaryCell: { flex: 1, minWidth: 0 },
  summaryDivider: { width: 1, marginHorizontal: 10 },
  summaryLabel: {
    fontSize: 11,
    marginBottom: 5,
    fontFamily: 'Inter_500Medium',
  },
  summaryValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  featureCard: {
    width: '31.5%',
    minHeight: 82,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 1,
  },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  featureLabel: { fontSize: 10, lineHeight: 13, textAlign: 'center', fontFamily: 'Inter_600SemiBold' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  filters: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  filterText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  filterTextActive: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' },
  section: { marginBottom: 20 },
  entryPressable: { marginBottom: 10 },
  entryCard: { padding: 12, gap: 10 },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entryDate: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  repairIdBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  repairIdText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  entryBody: { flexDirection: 'row', alignItems: 'center' },
  partyInfo: { flex: 1, marginLeft: 10 },
  partyNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  partyName: { flexShrink: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  typeText: { fontSize: 9, fontFamily: 'Inter_600SemiBold' },
  entryLabel: { fontSize: 12, marginTop: 4, fontFamily: 'Inter_400Regular' },
  amountInfo: { alignItems: 'flex-end', minWidth: 90 },
  debitText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  creditText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  balanceText: { fontSize: 11, marginTop: 4, fontFamily: 'Inter_500Medium' },
  empty: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 54 },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { marginTop: 14, fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  emptyText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    fontFamily: 'Inter_400Regular',
  },
});
