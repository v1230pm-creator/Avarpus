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
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

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

  // Every entry opens its own details: server-backed customer entries open
  // the dynamic entry page; legacy computed rows fall back to their repair.
  const openEntry = (entry: LedgerEntry) => {
    if (newKhataData && validType === 'customer') {
      router.push({
        pathname: '/(tabs)/khata/transaction',
        params: { scope: 'customer', entryId: entry.id, customerId: id, name: partyName },
      } as any);
      return;
    }
    if (entry.repairDbId) {
      router.push(`/(tabs)/repairs/${entry.repairDbId}` as any);
    }
  };

  const renderEntry = (entry: LedgerEntry) => {
    const isDebit = entry.debit > 0; // Given (charge)
    const amount = isDebit ? entry.debit : entry.credit;
    const tappable = (newKhataData && validType === 'customer') || !!entry.repairDbId;

    return (
      <TouchableOpacity
        key={entry.id}
        activeOpacity={0.75}
        disabled={!tappable}
        onPress={() => openEntry(entry)}
        accessibilityRole={tappable ? 'button' : undefined}
        style={[styles.entryRow, isDebit ? styles.entryRight : styles.entryLeft]}
      >
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
      </TouchableOpacity>
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
      <View style={[styles.header, { paddingTop: topPadding + space.lg, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <Avatar name={partyName} size={size.avatarSm} />
        <View style={{ flex: 1, paddingHorizontal: space.md }}>
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
    minHeight: layout.headerHeight,
    paddingLeft: space.sm,
    paddingRight: layout.screenPadding,
    borderBottomWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  iconBtn: {
    width: size.iconButton, height: size.iconButton,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 4,
  },
  headerTitle: { ...font.title },
  headerSubtitle: { ...font.caption },

  scroll: { padding: layout.screenPadding, paddingBottom: space.xxl },

  summaryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: space.lg,
    marginBottom: space.xxl,
  },
  summaryBox: { flex: 1, gap: 4 },
  summaryLabel: { ...font.captionStrong },
  summaryValue: { ...font.heading },
  summaryDivider: { width: 1, height: '100%', marginHorizontal: space.lg },
  summaryRow: { flex: 1.2, gap: space.md },
  summaryMiniBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryMiniLabel: { ...font.captionStrong },
  summaryMiniValue: { ...font.bodyStrong },

  activityList: { gap: space.md },
  entryRow: { flexDirection: 'row', marginVertical: 4 },
  entryLeft: { justifyContent: 'flex-start', paddingRight: 40 },
  entryRight: { justifyContent: 'flex-end', paddingLeft: 40 },
  entryCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: space.md,
    minWidth: 160,
  },
  entryAmount: { ...font.heading, marginBottom: space.xs },
  entryDesc: { ...font.bodyStrong, marginBottom: space.sm },
  entryDate: { ...font.caption, marginBottom: space.sm },
  balancePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: 8,
  },
  balancePillText: { ...font.captionStrong },
  
  emptyText: { ...font.body, textAlign: 'center', marginVertical: 40 },

  footer: {
    flexDirection: 'row',
    padding: space.lg,
    borderTopWidth: 1,
    gap: space.md,
  },
  actionBtn: {
    flex: 1,
    minHeight: size.button,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    color: '#fff',
    ...font.button,
  },
});