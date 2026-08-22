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
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ledger, totals, isLoading, error, reload } = useKhataLedger();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterState>('all');
  const [refreshing, setRefreshing] = useState(false);
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

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
            <Text style={styles.entryDate}>{formatDateLabel(entry.date)}</Text>
            <View style={styles.repairIdBadge}>
              <Text style={styles.repairIdText}>{entry.repairId}</Text>
            </View>
          </View>

          <View style={styles.entryBody}>
            <Avatar name={entry.partyName} size={38} />
            <View style={styles.partyInfo}>
              <View style={styles.partyNameRow}>
                <Text style={styles.partyName} numberOfLines={1}>
                  {entry.partyName}
                </Text>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeText}>
                    {entry.partyType === 'dealer' ? 'Dealer' : 'Customer'}
                  </Text>
                </View>
              </View>
              <Text style={styles.entryLabel}>
                {entry.label}
                {entry.method ? ` • ${entry.method.toUpperCase()}` : ''}
              </Text>
            </View>

            <View style={styles.amountInfo}>
              {isDebit ? (
                <Text style={styles.debitText}>
                  {formatCurrency(amount)} DEBIT
                </Text>
              ) : isCredit ? (
                <Text style={styles.creditText}>
                  {formatCurrency(amount)} CREDIT
                </Text>
              ) : null}
              <Text
                style={[
                  styles.balanceText,
                  entry.partyBalance <= 0 && styles.settledBalance,
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
              Chronological account ledger
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

        <FlatCard style={styles.summaryCard}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Total Business</Text>
            <Text style={styles.summaryValue}>{formatCurrency(totals.billed)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Total Paid</Text>
            <Text style={[styles.summaryValue, styles.paidValue]}>{formatCurrency(totals.paid)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Outstanding</Text>
            <Text
              style={[
                styles.summaryValue,
                totals.due > 0 ? styles.dueSummary : styles.paidValue,
              ]}
            >
              {formatCurrency(totals.due)}
            </Text>
          </View>
        </FlatCard>

        <View style={styles.searchBar}>
          <Feather name="search" size={17} color="#64748B" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search customer, dealer or ticket..."
            placeholderTextColor="#94A3B8"
            style={styles.searchInput}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search">
              <Feather name="x" size={17} color="#64748B" />
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
                filter === value && styles.filterButtonActive,
              ]}
            >
              <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>
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
              <View style={styles.emptyIcon}>
                <Feather name="list" size={28} color="#94A3B8" />
              </View>
              <Text style={styles.emptyTitle}>No ledger entries</Text>
              <Text style={styles.emptyText}>
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
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    gap: 12,
  },
  loadingText: { color: '#64748B', fontSize: 13, fontFamily: 'Inter_500Medium' },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 26, color: '#111827', fontFamily: 'Inter_700Bold' },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
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
    backgroundColor: '#EAF2FF',
    borderColor: '#D7E6FF',
    marginBottom: 14,
  },
  summaryCell: { flex: 1, minWidth: 0 },
  summaryDivider: { width: 1, backgroundColor: '#CFE0FA', marginHorizontal: 10 },
  summaryLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 5,
    fontFamily: 'Inter_500Medium',
  },
  summaryValue: { fontSize: 16, color: '#111827', fontFamily: 'Inter_700Bold' },
  paidValue: { color: '#16A34A' },
  dueSummary: { color: '#EF4444' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  searchInput: {
    flex: 1,
    color: '#111827',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  filters: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterButtonActive: { backgroundColor: '#0B63F6', borderColor: '#0B63F6' },
  filterText: { color: '#64748B', fontSize: 12, fontFamily: 'Inter_500Medium' },
  filterTextActive: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' },
  section: { marginBottom: 20 },
  entryPressable: { marginBottom: 10 },
  entryCard: { padding: 12, gap: 10 },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entryDate: { color: '#64748B', fontSize: 11, fontFamily: 'Inter_500Medium' },
  repairIdBadge: { backgroundColor: '#EAF2FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  repairIdText: { color: '#0B63F6', fontSize: 10, fontFamily: 'Inter_700Bold' },
  entryBody: { flexDirection: 'row', alignItems: 'center' },
  partyInfo: { flex: 1, marginLeft: 10 },
  partyNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  partyName: { flexShrink: 1, color: '#111827', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#F1F5F9' },
  typeText: { color: '#64748B', fontSize: 9, fontFamily: 'Inter_600SemiBold' },
  entryLabel: { color: '#64748B', fontSize: 12, marginTop: 4, fontFamily: 'Inter_400Regular' },
  amountInfo: { alignItems: 'flex-end', minWidth: 90 },
  debitText: { color: '#EF4444', fontSize: 13, fontFamily: 'Inter_700Bold' },
  creditText: { color: '#16A34A', fontSize: 13, fontFamily: 'Inter_700Bold' },
  balanceText: { color: '#64748B', fontSize: 11, marginTop: 4, fontFamily: 'Inter_500Medium' },
  settledBalance: { color: '#16A34A' },
  empty: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 54 },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#F3F7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { marginTop: 14, color: '#111827', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  emptyText: {
    marginTop: 6,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    fontFamily: 'Inter_400Regular',
  },
});
