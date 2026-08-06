import React, { useMemo } from 'react';
import {
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { StatCard } from '@/components/ui/StatCard';
import { Card } from '@/components/ui/Card';
import { BarChart } from '@/components/charts/BarChart';
import { RepairStatusBadge, PriorityBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { formatCurrency, formatDate, getGreeting, ROLE_LABELS, getTodayStr } from '@/utils/helpers';

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, canAccess } = useAuth();
  const { repairs, customers, inventory, finance } = useData();

  const today = getTodayStr();

  const stats = useMemo(() => {
    const todayRepairs = repairs.filter((r) => r.createdAt.startsWith(today));
    const pending = repairs.filter((r) => !['delivered', 'cancelled'].includes(r.status));
    const ready = repairs.filter((r) => r.status === 'ready');
    const lowStock = inventory.filter((i) => i.quantity <= i.minStock);
    const todayIncome = finance
      .filter((f) => f.type === 'income' && f.date === today)
      .reduce((s, f) => s + f.amount, 0);
    const todayExpense = finance
      .filter((f) => f.type === 'expense' && f.date === today)
      .reduce((s, f) => s + f.amount, 0);
    const totalIncome = finance.filter((f) => f.type === 'income').reduce((s, f) => s + f.amount, 0);
    const totalExpense = finance.filter((f) => f.type === 'expense').reduce((s, f) => s + f.amount, 0);
    const pendingPayments = repairs
      .filter((r) => r.status !== 'cancelled')
      .reduce((s, r) => s + Math.max(0, r.repairCharge + r.partsCharge - r.advance), 0);

    return {
      todayRepairs: todayRepairs.length,
      pending: pending.length,
      ready: ready.length,
      lowStock: lowStock.length,
      totalCustomers: customers.length,
      todayIncome,
      todayExpense,
      todayProfit: todayIncome - todayExpense,
      totalIncome,
      totalExpense,
      totalProfit: totalIncome - totalExpense,
      pendingPayments,
    };
  }, [repairs, customers, inventory, finance, today]);

  const weeklyData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().split('T')[0];
      const label = d.toLocaleDateString('en-IN', { weekday: 'short' }).substring(0, 3);
      const count = repairs.filter((r) => r.createdAt.startsWith(key)).length;
      return { label, value: count };
    });
  }, [repairs]);

  const recentRepairs = useMemo(
    () => [...repairs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    [repairs],
  );

  const showFinance = canAccess('finance');
  const showRepairs = canAccess('repairs');

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 16, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.greeting, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {getGreeting()},
          </Text>
          <Text style={[styles.userName, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            {user?.name}
          </Text>
          <Text style={[styles.role, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>
            {ROLE_LABELS[user?.role ?? 'reception']}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={[styles.notifBtn, { backgroundColor: colors.muted }]}>
            <Feather name="bell" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Avatar name={user?.name ?? 'User'} size={44} />
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}
      >
        {/* Stats */}
        {showRepairs && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
              REPAIR OVERVIEW
            </Text>
            <View style={styles.statsGrid}>
              <StatCard title="Today's Repairs" value={stats.todayRepairs} icon="tool" iconColor="primary" style={styles.statCard} />
              <StatCard title="Pending Repairs" value={stats.pending} icon="clock" iconColor="warning" style={styles.statCard} />
              <StatCard title="Ready for Pickup" value={stats.ready} icon="check-circle" iconColor="success" style={styles.statCard} />
              <StatCard title="Total Customers" value={stats.totalCustomers} icon="users" iconColor="info" style={styles.statCard} />
            </View>
          </View>
        )}

        {/* Finance stats (role-gated) */}
        {showFinance && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
              TODAY'S FINANCIALS
            </Text>
            <View style={styles.statsGrid}>
              <StatCard title="Today's Income" value={formatCurrency(stats.todayIncome)} icon="trending-up" iconColor="success" style={styles.statCard} />
              <StatCard title="Today's Expense" value={formatCurrency(stats.todayExpense)} icon="trending-down" iconColor="error" style={styles.statCard} />
              <StatCard title="Today's Profit" value={formatCurrency(stats.todayProfit)} icon="dollar-sign" iconColor={stats.todayProfit >= 0 ? 'success' : 'error'} style={styles.statCard} />
              <StatCard title="Pending Payments" value={formatCurrency(stats.pendingPayments)} icon="credit-card" iconColor="warning" style={styles.statCard} />
            </View>
          </View>
        )}

        {/* Low stock + Chart */}
        <View style={styles.section}>
          <View style={styles.statsGrid}>
            <StatCard title="Low Stock Items" value={stats.lowStock} icon="alert-triangle" iconColor={stats.lowStock > 0 ? 'warning' : 'success'} style={styles.statCard} />
            <StatCard title="All Repairs Total" value={repairs.length} icon="layers" iconColor="muted" style={styles.statCard} />
          </View>
        </View>

        {/* Weekly Chart */}
        <View style={styles.section}>
          <Card>
            <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
              Weekly Repairs
            </Text>
            <Text style={[styles.cardSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Last 7 days activity
            </Text>
            <BarChart data={weeklyData} color={colors.primary} height={110} />
          </Card>
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            QUICK ACTIONS
          </Text>
          <View style={styles.actionsRow}>
            {canAccess('repairs') && (
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/repairs/new')}
                style={[styles.actionBtn, { backgroundColor: colors.primary }]}
              >
                <Feather name="tool" size={22} color="#FFFFFF" />
                <Text style={[styles.actionLabel, { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' }]}>
                  New Repair
                </Text>
              </TouchableOpacity>
            )}
            {canAccess('customers') && (
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/customers')}
                style={[styles.actionBtn, { backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border }]}
              >
                <Feather name="user-plus" size={22} color={colors.primary} />
                <Text style={[styles.actionLabel, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                  Add Customer
                </Text>
              </TouchableOpacity>
            )}
            {showFinance && (
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/more/finance')}
                style={[styles.actionBtn, { backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border }]}
              >
                <Feather name="bar-chart-2" size={22} color={colors.primary} />
                <Text style={[styles.actionLabel, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                  Finance
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Recent Repairs */}
        {showRepairs && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
                RECENT REPAIRS
              </Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/repairs')}>
                <Text style={[styles.seeAll, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>See All</Text>
              </TouchableOpacity>
            </View>
            {recentRepairs.length === 0 ? (
              <Card>
                <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  No repairs yet
                </Text>
              </Card>
            ) : (
              recentRepairs.map((repair) => (
                <TouchableOpacity
                  key={repair.id}
                  onPress={() => router.push(`/(tabs)/repairs/${repair.id}`)}
                  activeOpacity={0.8}
                >
                  <Card style={styles.repairCard}>
                    <View style={styles.repairRow}>
                      <View style={[styles.repairIdBadge, { backgroundColor: colors.primary + '22' }]}>
                        <Text style={[styles.repairId, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
                          {repair.repairId}
                        </Text>
                      </View>
                      <PriorityBadge priority={repair.priority} />
                    </View>
                    <Text style={[styles.customerName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                      {repair.customerName}
                    </Text>
                    <Text style={[styles.deviceInfo, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      {repair.brand} {repair.model}
                    </Text>
                    <View style={styles.repairFooter}>
                      <RepairStatusBadge status={repair.status} />
                      <Text style={[styles.dateText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                        {formatDate(repair.createdAt)}
                      </Text>
                    </View>
                  </Card>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1,
  },
  headerLeft: { gap: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  notifBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  greeting: { fontSize: 13 },
  userName: { fontSize: 22 },
  role: { fontSize: 12 },
  scroll: { paddingHorizontal: 16, gap: 4 },
  section: { paddingTop: 20, gap: 12 },
  sectionTitle: { fontSize: 11, letterSpacing: 1 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seeAll: { fontSize: 13 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { width: '47%' },
  cardTitle: { fontSize: 16, marginBottom: 2 },
  cardSub: { fontSize: 12, marginBottom: 14 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, borderRadius: 14, padding: 16, alignItems: 'center', gap: 8 },
  actionLabel: { fontSize: 13 },
  repairCard: { marginBottom: 8, gap: 6 },
  repairRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  repairIdBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  repairId: { fontSize: 11 },
  customerName: { fontSize: 15 },
  deviceInfo: { fontSize: 13 },
  repairFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  dateText: { fontSize: 12 },
  emptyText: { fontSize: 14, textAlign: 'center', paddingVertical: 8 },
});
