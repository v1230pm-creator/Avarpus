import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { formatCurrency } from '@/utils/helpers';
import { FlatCard } from '@/components/ui/FlatCard';
import { useKhataLedger } from '@/hooks/useKhataLedger';
import type { KhataPartyType, LedgerEntry } from '@/utils/khata-ledger';

export default function KhataDetailScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const { type, id, name } = useLocalSearchParams<{
    type: KhataPartyType;
    id: string;
    name?: string;
  }>();
  const validType = type === 'customer' || type === 'dealer' ? type : undefined;

  const { ledger, totals, isLoading, error, reload } = useKhataLedger(validType, id);
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
        activeOpacity={0.7}
        onPress={() => router.push(`/(tabs)/repairs/${entry.repairDbId}`)}
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
            <View style={styles.entryInfo}>
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
        <Text style={styles.loadingText}>Loading account…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>{name || 'Khata Details'}</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            {validType === 'dealer' ? 'Dealer account ledger' : 'Customer account ledger'}
          </Text>
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
          <View style={styles.summaryTop}>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>Total Business</Text>
              <Text style={styles.summaryValue}>{formatCurrency(totals.billed)}</Text>
            </View>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>Total Paid</Text>
              <Text style={[styles.summaryValue, styles.paidValue]}>{formatCurrency(totals.paid)}</Text>
            </View>
          </View>
          <View style={styles.outstandingBox}>
            <Text style={styles.outstandingLabel}>Outstanding Balance</Text>
            <Text style={[styles.outstandingValue, totals.due <= 0 && styles.paidValue]}>
              {formatCurrency(totals.due)}
            </Text>
          </View>
        </FlatCard>

        <View style={{ marginBottom: 20 }}>
          <Text style={styles.sectionTitle}>LEDGER ENTRIES ({ledger.length})</Text>
          {ledger.length > 0 ? (
            ledger.map(renderEntry)
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Feather name="list" size={28} color="#94A3B8" />
              </View>
              <Text style={styles.emptyTitle}>No entries yet</Text>
              <Text style={styles.emptyText}>
                No billing or payment activity found for this account.
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, paddingRight: 44 },
  headerTitle: { color: '#111827', fontSize: 18, fontFamily: 'Inter_700Bold' },
  headerSubtitle: { color: '#64748B', fontSize: 12, marginTop: 2, fontFamily: 'Inter_400Regular' },
  scroll: { padding: 16, paddingBottom: 110, width: '100%', maxWidth: 720, alignSelf: 'center' },
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
  summaryCard: { backgroundColor: '#EAF2FF', borderColor: '#D7E6FF', marginBottom: 22 },
  summaryTop: { flexDirection: 'row', gap: 18 },
  summaryBox: { flex: 1 },
  summaryLabel: { color: '#64748B', fontSize: 11, fontFamily: 'Inter_500Medium' },
  summaryValue: { color: '#111827', fontSize: 19, marginTop: 4, fontFamily: 'Inter_700Bold' },
  paidValue: { color: '#16A34A' },
  outstandingBox: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#CFE0FA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  outstandingLabel: { color: '#64748B', fontSize: 12, fontFamily: 'Inter_500Medium' },
  outstandingValue: { color: '#EF4444', fontSize: 22, fontFamily: 'Inter_700Bold' },
  sectionTitle: {
    color: '#64748B',
    fontSize: 11,
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
    fontFamily: 'Inter_600SemiBold',
  },
  entryPressable: { marginBottom: 10 },
  entryCard: { padding: 12, gap: 8 },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entryDate: { color: '#64748B', fontSize: 11, fontFamily: 'Inter_500Medium' },
  repairIdBadge: { backgroundColor: '#EAF2FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  repairIdText: { color: '#0B63F6', fontSize: 10, fontFamily: 'Inter_700Bold' },
  entryBody: { flexDirection: 'row', alignItems: 'center' },
  entryInfo: { flex: 1 },
  entryLabel: { color: '#111827', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  amountInfo: { alignItems: 'flex-end', minWidth: 90 },
  debitText: { color: '#EF4444', fontSize: 13, fontFamily: 'Inter_700Bold' },
  creditText: { color: '#16A34A', fontSize: 13, fontFamily: 'Inter_700Bold' },
  balanceText: { color: '#64748B', fontSize: 11, marginTop: 4, fontFamily: 'Inter_500Medium' },
  settledBalance: { color: '#16A34A' },
  empty: { alignItems: 'center', paddingVertical: 50, paddingHorizontal: 24 },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#F3F7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: '#111827', fontSize: 15, marginTop: 13, fontFamily: 'Inter_600SemiBold' },
  emptyText: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 5,
    textAlign: 'center',
    fontFamily: 'Inter_400Regular',
  },
});
