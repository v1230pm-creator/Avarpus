import React, { useMemo, useState } from 'react';
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
import { formatCurrency } from '@/utils/helpers';
import { useKhataLedger } from '@/hooks/useKhataLedger';
import type { KhataPartyType, LedgerEntry } from '@/utils/khata-ledger';
import { Avatar } from '@/components/ui/Avatar';
import { useColors } from '@/hooks/useColors';
import { DataErrorBanner, DataErrorState } from '@/components/ui/DataStates';

export default function KhataDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useColors();
  const { type, id, name } = useLocalSearchParams<{
    type: KhataPartyType;
    id: string;
    name?: string;
  }>();
  const validType = type === 'customer' || type === 'dealer' ? type : undefined;

  const { ledger, totals, isLoading, error, reload } = useKhataLedger(validType, id);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'transactions' | 'summary'>('transactions');
  const [newestFirst, setNewestFirst] = useState(true);
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const orderedLedger = useMemo(
    () =>
      [...ledger].sort((a, b) =>
        newestFirst
          ? b.date.localeCompare(a.date)
          : a.date.localeCompare(b.date),
      ),
    [ledger, newestFirst],
  );

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
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return `Today, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const renderEntry = (entry: LedgerEntry) => {
    const isDebit = entry.debit > 0; // Means Repair (charge)
    const isCredit = entry.credit > 0; // Means Payment Received
    const amount = isDebit ? entry.debit : entry.credit;

    return (
      <View key={entry.id} style={styles.entryBox}>
        <View style={styles.entryRow}>
          <View style={[styles.entryIconBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Feather name={isDebit ? 'tool' : 'download'} size={14} color={colors.mutedForeground} />
          </View>
          <View style={styles.entryInfo}>
            <Text style={[styles.entryTitle, { color: colors.foreground }]} numberOfLines={1}>
              {isDebit ? `Repair Bill - R-${entry.repairId}` : 'Payment Received'}
            </Text>
            <Text style={[styles.entryDesc, { color: colors.mutedForeground }]} numberOfLines={1}>
              {isDebit ? entry.label : (entry.method ? `By ${entry.method}` : 'Cash')}
            </Text>
            <Text style={[styles.entryDate, { color: colors.mutedForeground }]}>{formatDateLabel(entry.date)}</Text>
          </View>
          <View style={styles.entryAmountBox}>
            <Text style={[styles.entryAmount, { color: isDebit ? colors.destructive : colors.success }]}>
              {formatCurrency(amount)}
            </Text>
          </View>
        </View>
      </View>
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
      <View style={[styles.header, { paddingTop: topPadding + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Khata Book - {name}</Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setNewestFirst((value) => !value)}
          accessibilityLabel={newestFirst ? 'Show oldest transactions first' : 'Show newest transactions first'}
        >
          <Feather name={newestFirst ? 'arrow-down' : 'arrow-up'} size={18} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {!!error && <DataErrorBanner onRetry={reload} />}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'transactions' && { backgroundColor: colors.primary }]}
            onPress={() => setActiveTab('transactions')}
          >
            <Text style={[styles.tabText, { color: activeTab === 'transactions' ? colors.primaryForeground : colors.mutedForeground }]}>Transactions</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'summary' && { backgroundColor: colors.primary }]}
            onPress={() => setActiveTab('summary')}
          >
            <Text style={[styles.tabText, { color: activeTab === 'summary' ? colors.primaryForeground : colors.mutedForeground }]}>Summary</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.cardContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {activeTab === 'transactions' ? (
            <View style={styles.activityList}>
              {orderedLedger.length > 0 ? (
                orderedLedger.map(renderEntry)
              ) : (
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No transactions yet</Text>
              )}
            </View>
          ) : (
            <View style={styles.summaryGrid}>
              <View style={styles.summaryCell}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Billed</Text>
                <Text style={[styles.summaryValue, { color: colors.foreground }]}>{formatCurrency(totals.billed)}</Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Received</Text>
                <Text style={[styles.summaryValue, { color: colors.success }]}>{formatCurrency(totals.paid)}</Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Outstanding</Text>
                <Text style={[styles.summaryValue, { color: totals.due > 0 ? colors.destructive : colors.success }]}>{formatCurrency(totals.due)}</Text>
              </View>
            </View>
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
    borderBottomWidth: 1,
  },
  iconBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  scroll: { padding: 16, paddingBottom: 100 },

  tabBar: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 16,
  },
  tabButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  tabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  cardContainer: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },

  activityList: { paddingVertical: 8 },
  summaryGrid: { padding: 16, gap: 16 },
  summaryCell: { gap: 4 },
  summaryLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  summaryValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  entryBox: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  entryIconBox: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center'
  },
  entryInfo: { flex: 1 },
  entryTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  entryDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  entryDate: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  entryAmountBox: { alignItems: 'flex-end' },
  entryAmount: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  
  emptyText: { fontSize: 13, textAlign: 'center', marginVertical: 20 },
});


