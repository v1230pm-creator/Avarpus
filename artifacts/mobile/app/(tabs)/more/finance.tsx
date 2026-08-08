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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/ui/Card';
import { SampleBadge } from '@/components/ui/Badge';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { StatCard } from '@/components/ui/StatCard';
import { GlassCard, ScreenGlow, useStaggerAnim, useIsDark } from '@/components/ui/Glass';
import { FinanceEntry } from '@/types';
import { formatCurrency, formatDate, getTodayStr } from '@/utils/helpers';

const PERIODS = ['Today', 'Week', 'Month', 'All'] as const;
type Period = (typeof PERIODS)[number];

function TransactionItem({ entry, isLast }: { entry: FinanceEntry; isLast: boolean }) {
  const colors = useColors();
  const isIncome = entry.type === 'income';
  return (
    <View style={[styles.txItem, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={[styles.txIcon, { backgroundColor: isIncome ? colors.success + '15' : colors.destructive + '15' }]}>
        <Feather name={isIncome ? 'trending-up' : 'trending-down'} size={16} color={isIncome ? colors.success : colors.destructive} />
      </View>
      <View style={styles.txContent}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.txCategory, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{entry.category}</Text>
          {entry.isSample && <SampleBadge />}
        </View>
        {entry.description && (
          <Text style={[styles.txDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
            {entry.description}
          </Text>
        )}
        <Text style={[styles.txDate, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{formatDate(entry.date)}</Text>
      </View>
      <Text style={[styles.txAmount, { color: isIncome ? colors.success : colors.destructive, fontFamily: 'Inter_700Bold' }]}>
        {isIncome ? '+' : '-'}{formatCurrency(entry.amount)}
      </Text>
    </View>
  );
}

export default function FinanceScreen() {
  const colors = useColors();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { finance, isLoading, loadError, loadAll } = useData();
  const [period, setPeriod] = useState<Period>('Month');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  };

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const anims = useStaggerAnim(4);

  const filteredEntries = useMemo(() => {
    const now = new Date();
    const today = getTodayStr();
    return finance.filter((e) => {
      if (period === 'Today') return e.date === today;
      if (period === 'Week') {
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        return new Date(e.date) >= weekAgo;
      }
      if (period === 'Month') {
        const monthAgo = new Date(now);
        monthAgo.setMonth(now.getMonth() - 1);
        return new Date(e.date) >= monthAgo;
      }
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [finance, period]);

  const stats = useMemo(() => {
    const income = filteredEntries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
    const expense = filteredEntries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
    return { income, expense, profit: income - expense };
  }, [filteredEntries]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />

      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Finance</Text>
        <View style={{ width: 44 }} />
      </View>

      {isLoading && finance.length === 0 ? (
        <DataLoadingState />
      ) : loadError && finance.length === 0 ? (
        <DataErrorState onRetry={loadAll} />
      ) : (
      <>
      {!!loadError && <DataErrorBanner onRetry={loadAll} />}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Period Filter */}
        <View style={styles.periodRow}>
          {PERIODS.map((p) => {
            const active = period === p;
            return (
              <TouchableOpacity
                key={p}
                onPress={() => setPeriod(p)}
                style={[styles.periodTab, {
                  backgroundColor: active ? colors.primary : (isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)'),
                  borderColor: active ? colors.primary : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)'),
                }]}
              >
                <Text style={[styles.periodText, { color: active ? '#FFFFFF' : colors.mutedForeground, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>
                  {p}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard title="Income" value={formatCurrency(stats.income)} icon="trending-up" iconColor="success" style={styles.statCard} />
          <StatCard title="Expense" value={formatCurrency(stats.expense)} icon="trending-down" iconColor="error" style={styles.statCard} />
        </View>

        <GlassCard animValue={anims[0]} style={{ padding: 20 }}>
          <View style={styles.profitRow}>
            <View>
              <Text style={[styles.profitLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Net Profit</Text>
              <Text style={[styles.profitValue, { color: stats.profit >= 0 ? colors.success : colors.destructive, fontFamily: 'Inter_700Bold' }]}>
                {formatCurrency(stats.profit)}
              </Text>
            </View>
            <View style={[styles.profitBadge, { backgroundColor: stats.profit >= 0 ? colors.success + '15' : colors.destructive + '15' }]}>
              <Feather name={stats.profit >= 0 ? 'trending-up' : 'trending-down'} size={24} color={stats.profit >= 0 ? colors.success : colors.destructive} />
            </View>
          </View>
        </GlassCard>

        {/* Transactions */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
          TRANSACTIONS ({filteredEntries.length})
        </Text>

        {filteredEntries.length === 0 ? (
          <Card>
            <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              No transactions for this period
            </Text>
          </Card>
        ) : (
          <GlassCard animValue={anims[1]} style={styles.txList}>
            {filteredEntries.map((entry, i) => (
              <TransactionItem key={entry.id} entry={entry} isLast={i === filteredEntries.length - 1} />
            ))}
          </GlassCard>
        )}
      </ScrollView>
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22 },
  scroll: { padding: 16, gap: 14 },
  periodRow: { flexDirection: 'row', gap: 8 },
  periodTab: { flex: 1, paddingVertical: 10, borderRadius: 14, borderWidth: 1, alignItems: 'center' },
  periodText: { fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: { flex: 1 },
  profitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profitLabel: { fontSize: 13 },
  profitValue: { fontSize: 28, marginTop: 2 },
  profitBadge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 11, letterSpacing: 1 },
  txList: { overflow: 'hidden' },
  txItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  txIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  txContent: { flex: 1, gap: 2 },
  txCategory: { fontSize: 14 },
  txDesc: { fontSize: 12 },
  txDate: { fontSize: 11 },
  txAmount: { fontSize: 15 },
  emptyText: { textAlign: 'center', fontSize: 14 },
});
