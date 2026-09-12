import React, { useMemo, useState } from 'react';
import {
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
import { AvarpusLoadingScreen } from '@/components/ui/AvarpusSpinner';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCurrency } from '@/utils/helpers';
import { useKhataLedger } from '@/hooks/useKhataLedger';
import { useCustomerKhataGet } from '@/hooks/api-khata-adapter';
import type { KhataPartyType, LedgerEntry } from '@/utils/khata-ledger';
import { Avatar } from '@/components/ui/Avatar';
import { useColors } from '@/hooks/useColors';
import { DataErrorBanner, DataErrorState } from '@/components/ui/DataStates';
import { KhataTransactionSheet } from '@/components/forms/KhataTransactionSheet';
import { useData } from '@/context/DataContext';

export default function KhataDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useColors();
  const { loadAll } = useData();
  const { type, id, name, ids } = useLocalSearchParams<{
    type: KhataPartyType;
    id: string;
    name?: string;
    ids?: string;
  }>();
  const validType = type === 'customer' || type === 'dealer' ? type : 'customer';
  const partyName = name || 'Unknown';
  const mergedPartyIds = useMemo(
    () =>
      validType === 'dealer'
        ? [...new Set([id, ...(ids?.split(',') ?? [])].filter(Boolean))]
        : undefined,
    [id, ids, validType],
  );

  // Planned new endpoint hook
  const { data: newKhataData, isLoading: isNewLoading, refetch: refetchNew } = useCustomerKhataGet(id);

  // Fallback existing ledger
  const { ledger: fallbackLedger, totals: fallbackTotals, isLoading: isFallbackLoading, error: fallbackError, reload: refetchFallback } = useKhataLedger(validType, id, mergedPartyIds);

  const [refreshing, setRefreshing] = useState(false);
  const [sheetType, setSheetType] = useState<'given' | 'received' | null>(null);

  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        newKhataData ? refetchNew() : refetchFallback(),
        loadAll(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  // If new data exists, map it; otherwise use fallback
  const ledger = useMemo(() => {
    if (newKhataData && Array.isArray(newKhataData.entries)) {
      return newKhataData.entries as LedgerEntry[];
    }
    // Fallback is ordered newest first by default. Reverse to oldest first for chat-like view.
    return [...fallbackLedger].reverse();
  }, [newKhataData, fallbackLedger]);

  const totals = useMemo(() => {
    if (newKhataData && newKhataData.totals) return newKhataData.totals;
    return fallbackTotals;
  }, [newKhataData, fallbackTotals]);

  const isLoading = isNewLoading || isFallbackLoading;
  const isDealer = validType === 'dealer';

  const formatDateLabel = (isoDate: string) => {
    const d = new Date(isoDate);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return `Today, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const renderEntry = (entry: LedgerEntry) => {
    const isDebit = entry.debit > 0; // Given (charge)
    const amount = isDebit ? entry.debit : entry.credit;

    return (
      <View key={entry.id} style={[styles.entryRow, isDebit ? styles.entryRight : styles.entryLeft]}>
        <View style={[styles.entryCard, { backgroundColor: isDebit ? colors.destructive + '10' : colors.success + '10', borderColor: isDebit ? colors.destructive + '30' : colors.success + '30' }]}>
          <Text style={[styles.entryAmount, { color: isDebit ? colors.destructive : colors.success }]}>
            {formatCurrency(amount)}
          </Text>
          <Text style={[styles.entryDesc, { color: colors.foreground }]} numberOfLines={2}>
            {isDebit ? entry.label : (entry.method ? `By ${entry.method}` : 'Cash')}
            {entry.repairId ? ` • R-${entry.repairId}` : ''}
          </Text>
          <Text style={[styles.entryDate, { color: colors.mutedForeground }]}>{formatDateLabel(entry.date)}</Text>
          <View style={[styles.balancePill, { backgroundColor: colors.background }]}>
            <Text style={[styles.balancePillText, { color: colors.mutedForeground }]}>
              Bal: {formatCurrency(Math.abs(entry.partyBalance))} {entry.partyBalance > 0 ? 'Due' : entry.partyBalance < 0 ? 'Adv' : ''}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  if (isLoading && ledger.length === 0) {
    return <AvarpusLoadingScreen background={colors.background} size={40} />;
  }

  if (fallbackError && !newKhataData && ledger.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPadding }]}>
        <DataErrorState onRetry={onRefresh} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Avatar name={partyName} size={36} />
        <View style={{ flex: 1, paddingHorizontal: 12 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>{partyName}</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            {isDealer ? 'Supplier' : 'Customer'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {!newKhataData && !!fallbackError && <DataErrorBanner onRetry={onRefresh} />}

        <View style={[styles.summaryBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.summaryBox}>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Net Balance</Text>
            <Text style={[styles.summaryValue, { color: totals.due > 0 ? colors.destructive : totals.due < 0 ? colors.success : colors.foreground }]}>
              {formatCurrency(Math.abs(totals.due))} {totals.due > 0 ? 'Due' : totals.due < 0 ? 'Advance' : ''}
            </Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryRow}>
            <View style={styles.summaryMiniBox}>
              <Text style={[styles.summaryMiniLabel, { color: colors.mutedForeground }]}>Total Given</Text>
              <Text style={[styles.summaryMiniValue, { color: colors.destructive }]}>{formatCurrency(totals.billed)}</Text>
            </View>
            <View style={styles.summaryMiniBox}>
              <Text style={[styles.summaryMiniLabel, { color: colors.mutedForeground }]}>Total Received</Text>
              <Text style={[styles.summaryMiniValue, { color: colors.success }]}>{formatCurrency(totals.paid)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.activityList}>
          {ledger.length > 0 ? (
            ledger.map(renderEntry)
          ) : (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No transactions yet</Text>
          )}
        </View>
      </ScrollView>

      {/* Footer Actions */}
      {!isDealer && (
        <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom || 16 }]}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.destructive }]}
            onPress={() => setSheetType('given')}
            activeOpacity={0.8}
          >
            <Text style={styles.actionBtnText}>Payment Given</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.success }]}
            onPress={() => setSheetType('received')}
            activeOpacity={0.8}
          >
            <Text style={styles.actionBtnText}>Payment Received</Text>
          </TouchableOpacity>
        </View>
      )}

      <KhataTransactionSheet
        visible={!!sheetType}
        onClose={() => setSheetType(null)}
        partyId={id as string}
        partyType={validType}
        type={sheetType!}
        onSuccess={onRefresh}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  iconBtn: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 4,
  },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  headerSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular' },

  scroll: { padding: 16, paddingBottom: 24 },

  summaryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  summaryBox: { flex: 1, gap: 4 },
  summaryLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  summaryValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  summaryDivider: { width: 1, height: '100%', marginHorizontal: 16 },
  summaryRow: { flex: 1.2, gap: 12 },
  summaryMiniBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryMiniLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  summaryMiniValue: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  activityList: { gap: 12 },
  entryRow: { flexDirection: 'row', marginVertical: 4 },
  entryLeft: { justifyContent: 'flex-start', paddingRight: 40 },
  entryRight: { justifyContent: 'flex-end', paddingLeft: 40 },
  entryCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    minWidth: 160,
  },
  entryAmount: { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  entryDesc: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 6 },
  entryDate: { fontSize: 11, fontFamily: 'Inter_400Regular', marginBottom: 8 },
  balancePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  balancePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  
  emptyText: { fontSize: 14, textAlign: 'center', marginVertical: 40, fontFamily: 'Inter_500Medium' },

  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});