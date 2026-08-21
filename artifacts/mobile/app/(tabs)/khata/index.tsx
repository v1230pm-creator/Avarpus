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
import { useKhataRepairs } from '@/hooks/useKhataRepairs';
import {
  groupKhataParties,
  summarizeKhataRepairs,
  type KhataPartySummary,
  type KhataPartyType,
} from '@/utils/khata';

type PartyFilter = 'all' | KhataPartyType;

export default function KhataOverviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { repairs, isLoading, error, reload } = useKhataRepairs();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<PartyFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const summary = useMemo(() => summarizeKhataRepairs(repairs), [repairs]);
  const grouped = useMemo(() => groupKhataParties(repairs), [repairs]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = (party: KhataPartySummary) =>
      !query || party.name.toLowerCase().includes(query);
    return {
      dealers:
        filter === 'customer' ? [] : grouped.dealers.filter(matches),
      customers:
        filter === 'dealer' ? [] : grouped.customers.filter(matches),
    };
  }, [filter, grouped, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  const openParty = (party: KhataPartySummary) => {
    router.push(
      `/(tabs)/khata/party/${party.type}/${party.id}?name=${encodeURIComponent(party.name)}`,
    );
  };

  const renderParty = (party: KhataPartySummary) => (
    <TouchableOpacity
      key={`${party.type}-${party.id}`}
      activeOpacity={0.75}
      onPress={() => openParty(party)}
      style={styles.partyPressable}
    >
      <FlatCard style={styles.partyCard}>
        <Avatar name={party.name} size={42} />
        <View style={styles.partyContent}>
          <View style={styles.partyTitleRow}>
            <Text style={styles.partyName} numberOfLines={1}>{party.name}</Text>
            <View style={styles.typeBadge}>
              <Text style={styles.typeText}>
                {party.type === 'dealer' ? 'Dealer' : 'Customer'}
              </Text>
            </View>
          </View>
          <Text style={styles.partyMeta}>
            {party.repairCount} {party.repairCount === 1 ? 'repair' : 'repairs'} · Paid {formatCurrency(party.paid)}
          </Text>
        </View>
        <View style={styles.partyDue}>
          <Text style={styles.dueLabel}>Outstanding</Text>
          <Text style={[styles.dueValue, party.due <= 0 && styles.settledValue]}>
            {formatCurrency(party.due)}
          </Text>
          <Feather name="chevron-right" size={16} color="#94A3B8" />
        </View>
      </FlatCard>
    </TouchableOpacity>
  );

  if (isLoading && repairs.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#0B63F6" size="large" />
        <Text style={styles.loadingText}>Loading Khata…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPadding + 16 }]}>
        <Text style={styles.headerTitle}>Khata</Text>
        <Text style={styles.headerSubtitle}>Real repair bills and recorded payments</Text>
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
            <Text style={styles.summaryValue}>{formatCurrency(summary.billed)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Total Paid</Text>
            <Text style={[styles.summaryValue, styles.paidValue]}>{formatCurrency(summary.paid)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Outstanding</Text>
            <Text style={[styles.summaryValue, summary.due > 0 ? styles.dueSummary : styles.paidValue]}>
              {formatCurrency(summary.due)}
            </Text>
          </View>
        </FlatCard>

        <View style={styles.searchBar}>
          <Feather name="search" size={17} color="#64748B" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search customer or dealer…"
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
          {([
            ['all', 'All'],
            ['customer', 'Customers'],
            ['dealer', 'Dealers'],
          ] as const).map(([value, label]) => (
            <TouchableOpacity
              key={value}
              onPress={() => setFilter(value)}
              style={[styles.filterButton, filter === value && styles.filterButtonActive]}
            >
              <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {visible.dealers.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>DEALERS ({visible.dealers.length})</Text>
            {visible.dealers.map(renderParty)}
          </View>
        )}

        {visible.customers.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>CUSTOMERS ({visible.customers.length})</Text>
            {visible.customers.map(renderParty)}
          </View>
        )}

        {visible.dealers.length === 0 && visible.customers.length === 0 && (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="book" size={28} color="#94A3B8" />
            </View>
            <Text style={styles.emptyTitle}>No Khata accounts found</Text>
            <Text style={styles.emptyText}>
              {search
                ? 'Try a different customer or dealer name.'
                : 'Linked repair accounts will appear here automatically.'}
            </Text>
          </View>
        )}
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
    borderBottomColor: '#E2E8F0',
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
  sectionTitle: {
    fontSize: 11,
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
    fontFamily: 'Inter_600SemiBold',
  },
  partyPressable: { marginBottom: 10 },
  partyCard: { flexDirection: 'row', alignItems: 'center', padding: 13 },
  partyContent: { flex: 1, marginLeft: 12, minWidth: 0 },
  partyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  partyName: { flexShrink: 1, color: '#111827', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  typeBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: '#EAF2FF' },
  typeText: { color: '#0B63F6', fontSize: 9, fontFamily: 'Inter_600SemiBold' },
  partyMeta: { marginTop: 4, color: '#64748B', fontSize: 11, fontFamily: 'Inter_400Regular' },
  partyDue: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 },
  dueLabel: { display: 'none' },
  dueValue: { color: '#EF4444', fontSize: 14, fontFamily: 'Inter_700Bold' },
  settledValue: { color: '#16A34A' },
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