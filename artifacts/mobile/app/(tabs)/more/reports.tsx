import React, { useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { GlassCard, ScreenGlow } from '@/components/ui/Glass';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { formatCurrency, getTodayStr } from '@/utils/helpers';

interface ReportType {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
}

const REPORT_TYPES: ReportType[] = [
  { id: 'repair', title: 'Repair Report', description: 'All repair jobs with status & billing', icon: 'tool', color: '#0284C7' },
  { id: 'customer', title: 'Customer Report', description: 'Customer list with dues & history', icon: 'users', color: '#7C3AED' },
  { id: 'inventory', title: 'Inventory Report', description: 'Stock levels, low stock alerts', icon: 'package', color: '#059669' },
  { id: 'purchase', title: 'Purchase Report', description: 'Purchase orders, supplier payments', icon: 'shopping-bag', color: '#D97706' },
  { id: 'finance', title: 'Finance Report', description: 'Income, expense, profit & loss', icon: 'bar-chart-2', color: '#DC2626' },
  { id: 'staff', title: 'Staff Report', description: 'Staff list, roles, attendance', icon: 'user-check', color: '#64748B' },
  { id: 'technician', title: 'Technician Report', description: 'Jobs completed per technician', icon: 'award', color: '#F59E0B' },
  { id: 'warranty', title: 'Warranty Report', description: 'Warranty claims & status', icon: 'shield', color: '#6366F1' },
];

export default function ReportsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { repairs, customers, inventory, finance, purchases, isLoading, loadError, loadAll } = useData();
  const today = getTodayStr();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  };

  const hasData =
    repairs.length + customers.length + inventory.length + finance.length + purchases.length > 0;

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const snapshots = {
    repair: { count: repairs.length, note: `${repairs.filter((r) => !['delivered', 'cancelled'].includes(r.status)).length} active` },
    customer: { count: customers.length, note: `${customers.filter((c) => c.dueAmount > 0).length} with dues` },
    inventory: { count: inventory.length, note: `${inventory.filter((i) => i.quantity <= i.minStock).length} low stock` },
    purchase: { count: purchases.length, note: `${purchases.filter((p) => p.paymentStatus === 'unpaid').length} unpaid` },
    finance: {
      count: finance.length,
      note: `Profit: ${formatCurrency(finance.filter((f) => f.type === 'income').reduce((s, f) => s + f.amount, 0) - finance.filter((f) => f.type === 'expense').reduce((s, f) => s + f.amount, 0))}`,
    },
    staff: { count: 0, note: 'All staff' },
    technician: { count: 0, note: 'All technicians' },
    warranty: { count: 0, note: 'No warranty data yet' },
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />

      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Reports</Text>
        <View style={{ width: 44 }} />
      </View>

      {isLoading && !hasData ? (
        <DataLoadingState />
      ) : loadError && !hasData ? (
        <DataErrorState onRetry={loadAll} />
      ) : (
      <>
      {!!loadError && <DataErrorBanner onRetry={loadAll} />}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={[styles.bannerCard, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '22', borderRadius: 16 }]}>
          <Feather name="info" size={16} color={colors.primary} />
          <Text style={[styles.bannerText, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>
            Reports are generated from current data. Export to PDF/Excel coming soon.
          </Text>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>AVAILABLE REPORTS</Text>

        {REPORT_TYPES.map((report) => {
          const snap = snapshots[report.id as keyof typeof snapshots];
          return (
            <TouchableOpacity key={report.id} activeOpacity={0.75}>
              <GlassCard style={styles.reportCard}>
                <View style={[styles.reportIcon, { backgroundColor: report.color + '1A' }]}>
                  <Feather name={report.icon} size={22} color={report.color} />
                </View>
                <View style={styles.reportContent}>
                  <Text style={[styles.reportTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{report.title}</Text>
                  <Text style={[styles.reportDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{report.description}</Text>
                  {snap && (
                    <Text style={[styles.reportMeta, { color: report.color, fontFamily: 'Inter_500Medium' }]}>{snap.note}</Text>
                  )}
                </View>
                <View style={styles.reportRight}>
                  <Feather name="download" size={16} color={colors.mutedForeground} />
                </View>
              </GlassCard>
            </TouchableOpacity>
          );
        })}
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
  scroll: { padding: 16, gap: 12 },
  bannerCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderWidth: 1 },
  bannerText: { flex: 1, fontSize: 12, lineHeight: 18 },
  sectionLabel: { fontSize: 11, letterSpacing: 1 },
  reportCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  reportIcon: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  reportContent: { flex: 1, gap: 3 },
  reportTitle: { fontSize: 15 },
  reportDesc: { fontSize: 12 },
  reportMeta: { fontSize: 11, marginTop: 2 },
  reportRight: { paddingLeft: 8 },
});
