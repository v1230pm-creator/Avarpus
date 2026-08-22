import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { staffList, useRefundsList, getRefundsListQueryKey, stockMovementsList, paymentsList, dailyRepairsStats } from '@workspace/api-client-react';
import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { FlatCard } from '@/components/ui/Glass';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { formatCurrency, getTodayStr } from '@/utils/helpers';
import { buildReportHtml, type ReportData, type StaffMember } from '@/utils/reportHtml';

interface ReportType {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
}

const REPORT_TYPES: ReportType[] = [
  { id: 'repair', title: 'Repair Report', description: 'All repair jobs with status & billing', icon: 'tool', color: '#4DA3FF' },
  { id: 'customer', title: 'Customer Report', description: 'Customer list with dues & history', icon: 'users', color: '#8B5CF6' },
  { id: 'inventory', title: 'Inventory Report', description: 'Stock levels, low stock alerts', icon: 'package', color: '#34D399' },
  { id: 'purchase', title: 'Purchase Report', description: 'Purchase orders, supplier payments', icon: 'shopping-bag', color: '#F59E0B' },
  { id: 'finance', title: 'Finance Report', description: 'Income, expense, profit & loss', icon: 'bar-chart-2', color: '#F87171' },
  { id: 'staff', title: 'Staff Report', description: 'Staff list, roles & status', icon: 'user-check', color: '#A8B3C7' },
  { id: 'technician', title: 'Technician Report', description: 'Jobs completed per technician', icon: 'award', color: '#F59E0B' },
  { id: 'warranty', title: 'Warranty Report', description: 'Repair warranties & expiry', icon: 'shield', color: '#818CF8' },
  { id: 'collection', title: 'Collection Report', description: 'Payments received by method (Cash/UPI/Card...)', icon: 'dollar-sign', color: '#34D399' },
  { id: 'daily', title: 'Daily Received vs Repaired', description: 'Date-wise: phones received & repaired per day', icon: 'calendar', color: '#4DA3FF' },
  { id: 'pending', title: 'Pending Payments', description: 'Repairs with outstanding balances', icon: 'credit-card', color: '#F87171' },
  { id: 'refunds', title: 'Refunds', description: 'List of all processed refunds', icon: 'corner-up-left', color: '#A855F7' },
  { id: 'parts', title: 'Parts Consumption', description: 'Parts used across repairs', icon: 'settings', color: '#FB923C' },
];

function notify(title: string, message: string) {
  if (Platform.OS === 'web') {
    // Alert.alert is a no-op on web
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

export default function ReportsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, canAccess } = useAuth();
  const { repairs, customers, inventory, finance, purchases, isLoading, loadError, loadAll } = useData();
  const canSeeFinance = canAccess('finance');

  const { data: refundsData } = useRefundsList({
    query: {
      enabled: canSeeFinance,
      queryKey: getRefundsListQueryKey()
    }
  });
  const [refreshing, setRefreshing] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  // Date filter for the collection report (days back; null = all time)
  const [collectionDays, setCollectionDays] = useState<number | null>(30);

  const canSeeStaff = user?.role === 'dealer' || user?.role === 'super_admin';

  const loadStaff = useCallback(async () => {
    if (!canSeeStaff) return;
    try {
      const res = await staffList();
      setStaff(res.staff as StaffMember[]);
    } catch {
      // Staff snapshot is best-effort; the rest of the screen still works.
    }
  }, [canSeeStaff]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadAll(), loadStaff()]);
    } finally {
      setRefreshing(false);
    }
  };

  const hasData =
    repairs.length + customers.length + inventory.length + finance.length + purchases.length > 0;

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const today = getTodayStr();
  const technicianIds = new Set(
    repairs.filter((r) => r.technicianId || r.technicianName).map((r) => r.technicianId ?? r.technicianName!),
  );
  const warrantyRepairs = repairs.filter((r) => (r.warrantyDays ?? 0) > 0 || r.warrantyExpiry);
  const inWarranty = warrantyRepairs.filter((r) => r.warrantyExpiry && r.warrantyExpiry >= today);

  const snapshots: Record<string, { count: number; note: string }> = {
    repair: { count: repairs.length, note: `${repairs.filter((r) => !['delivered', 'cancelled'].includes(r.status)).length} active` },
    customer: { count: customers.length, note: `${customers.filter((c) => c.dueAmount > 0).length} with dues` },
    inventory: { count: inventory.length, note: `${inventory.filter((i) => i.quantity <= i.minStock).length} low stock` },
    purchase: { count: purchases.length, note: `${purchases.filter((p) => p.paymentStatus === 'unpaid').length} unpaid` },
    finance: {
      count: finance.length,
      note: `Profit: ${formatCurrency(finance.filter((f) => f.type === 'income').reduce((s, f) => s + f.amount, 0) - finance.filter((f) => f.type === 'expense').reduce((s, f) => s + f.amount, 0))}`,
    },
    staff: canSeeStaff
      ? { count: staff.length, note: `${staff.filter((s) => s.isActive).length} active, ${staff.filter((s) => !s.isActive).length} pending` }
      : { count: 0, note: 'Owner access required' },
    technician: {
      count: technicianIds.size,
      note: technicianIds.size > 0 ? `${technicianIds.size} with assigned jobs` : 'No jobs assigned yet',
    },
    warranty: {
      count: warrantyRepairs.length,
      note: warrantyRepairs.length > 0 ? `${inWarranty.length} in warranty` : 'No warranty data yet',
    },
  };

  const handleGenerate = async (report: ReportType) => {
    if (generatingId) return;

    if (report.id === 'staff' && !canSeeStaff) {
      notify('Not available', 'Only the shop owner can generate the staff report.');
      return;
    }

    if (report.id === 'collection') {
      if (!canSeeFinance) {
        notify('Not available', 'Finance access is required for the collection report.');
        return;
      }
      setGeneratingId(report.id);
      try {
        const from = collectionDays !== null
          ? new Date(Date.now() - collectionDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          : undefined;
        const res = await paymentsList(from ? { from } : undefined);
        const rows = res.payments || [];
        const active = rows.filter((p: any) => !p.voidedAt);
        if (active.length === 0) {
          notify('No data yet', 'Is period mein koi payment record nahi hai.');
          return;
        }
        const byMethod = res.totals?.byMethod || {};
        const periodLabel = collectionDays === 1 ? 'Today' : collectionDays ? `Last ${collectionDays} days` : 'All time';
        const html = `
          <html><body style="font-family: sans-serif; padding: 24px; color: #111;">
            <h2 style="text-align:center;margin-bottom:2px;">${user?.businessName || 'VMC Electronics'}</h2>
            <p style="text-align:center;margin-top:0;">Collection Report — ${periodLabel}</p>
            <hr />
            <h3>Totals by Payment Method</h3>
            <table style="width:100%;border-collapse:collapse;" border="1" cellpadding="6">
              <tr style="background:#f0f0f0;"><th align="left">Method</th><th align="right">Amount (₹)</th></tr>
              ${Object.entries(byMethod).map(([m, v]) => `<tr><td>${m}</td><td align="right">${v}</td></tr>`).join('')}
              <tr style="font-weight:bold;background:#f8f8f8;"><td>Total</td><td align="right">${res.totals?.total ?? 0}</td></tr>
            </table>
            <h3 style="margin-top:20px;">Payments (${active.length})</h3>
            <table style="width:100%;border-collapse:collapse;font-size:12px;" border="1" cellpadding="5">
              <tr style="background:#f0f0f0;"><th align="left">Date</th><th align="left">Ticket</th><th align="left">Customer</th><th align="left">Method</th><th align="left">Type</th><th align="right">Amount (₹)</th></tr>
              ${active.map((p: any) => `<tr><td>${(p.createdAt || '').split('T')[0]}</td><td>${p.repairTicket || '-'}</td><td>${p.customerName || '-'}</td><td>${p.method}</td><td>${p.kind}</td><td align="right">${p.amount}</td></tr>`).join('')}
            </table>
            ${rows.length > active.length ? `<p style="font-size:11px;color:#777;">${rows.length - active.length} voided payment(s) excluded from totals.</p>` : ''}
          </body></html>`;
        if (Platform.OS === 'web') {
          await Print.printAsync({ html });
        } else {
          const { uri } = await Print.printToFileAsync({ html });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Collection Report', UTI: 'com.adobe.pdf' });
          } else {
            await Print.printAsync({ uri });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (!/cancel|dismiss/i.test(msg)) {
          notify('Could not generate report', 'Collection report banate waqt problem aayi. Dobara try karein.');
        }
      } finally {
        setGeneratingId(null);
      }
      return;
    }

    if (report.id === 'daily') {
      setGeneratingId(report.id);
      try {
        const res = await dailyRepairsStats({ days: 30 });
        const rows = res.days || [];
        if (rows.length === 0) {
          notify('No data yet', 'Pichhle 30 din mein koi repair data nahi hai.');
          return;
        }
        const totalReceived = rows.reduce((s: number, d: any) => s + d.received, 0);
        const totalRepaired = rows.reduce((s: number, d: any) => s + d.repaired, 0);
        const html = `
          <html><body style="font-family: sans-serif; padding: 24px; color: #111;">
            <h2 style="text-align:center;margin-bottom:2px;">${user?.businessName || 'VMC Electronics'}</h2>
            <p style="text-align:center;margin-top:0;">Daily Received vs Repaired — Last 30 days</p>
            <hr />
            <table style="width:100%;border-collapse:collapse;" border="1" cellpadding="6">
              <tr style="background:#f0f0f0;"><th align="left">Date</th><th align="right">Phones Received</th><th align="right">Phones Repaired</th></tr>
              ${rows.map((d: any) => `<tr><td>${d.date}</td><td align="right">${d.received}</td><td align="right">${d.repaired}</td></tr>`).join('')}
              <tr style="font-weight:bold;background:#f8f8f8;"><td>Total</td><td align="right">${totalReceived}</td><td align="right">${totalRepaired}</td></tr>
            </table>
          </body></html>`;
        if (Platform.OS === 'web') {
          await Print.printAsync({ html });
        } else {
          const { uri } = await Print.printToFileAsync({ html });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Daily Received vs Repaired', UTI: 'com.adobe.pdf' });
          } else {
            await Print.printAsync({ uri });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (!/cancel|dismiss/i.test(msg)) {
          notify('Could not generate report', 'Daily report banate waqt problem aayi. Dobara try karein.');
        }
      } finally {
        setGeneratingId(null);
      }
      return;
    }

    setGeneratingId(report.id);

    let stockMovements: any[] = [];
    try {
      if (report.id === 'parts') {
        const res = await stockMovementsList();
        stockMovements = res.stockMovements || [];
      }
    } catch (e) {
      console.error('Failed to load parts consumption', e);
    }

    const data: ReportData = {
      repairs,
      customers,
      inventory,
      purchases,
      finance,
      staff,
      refunds: refundsData?.refunds || [],
      stockMovements,
      shopName: user?.businessName ?? undefined,
    };
    const built = buildReportHtml(report.id, data);
    if (!built) {
      setGeneratingId(null);
      return;
    }

    if (built.rowCount === 0) {
      setGeneratingId(null);
      const messages: Record<string, string> = {
        warranty: 'No repairs with warranty yet. Warranty details added to repairs will appear here.',
        technician: 'No repairs have been assigned to technicians yet.',
      };
      notify('No data yet', messages[report.id] ?? `There is no data for the ${report.title.toLowerCase()} yet. Add some records first.`);
      return;
    }

    setGeneratingId(report.id);
    try {
      if (Platform.OS === 'web') {
        // On web, open the system print dialog (user can save as PDF from there).
        await Print.printAsync({ html: built.html });
      } else {
        const { uri } = await Print.printToFileAsync({ html: built.html });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: built.title,
            UTI: 'com.adobe.pdf',
          });
        } else {
          await Print.printAsync({ uri });
        }
      }
    } catch (err) {
      // User cancelling the print/share dialog is not an error worth surfacing.
      const msg = err instanceof Error ? err.message : '';
      if (!/cancel|dismiss/i.test(msg)) {
        notify('Could not generate report', 'Something went wrong while creating the PDF. Please try again.');
      }
    } finally {
      setGeneratingId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


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
            Tap a report to generate a PDF from your current shop data and share or print it.
          </Text>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>AVAILABLE REPORTS</Text>

        {canSeeFinance && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>COLLECTION PERIOD:</Text>
            {([['Today', 1], ['7 Din', 7], ['30 Din', 30], ['Sab', null]] as [string, number | null][]).map(([label, days]) => (
              <TouchableOpacity
                key={label}
                onPress={() => setCollectionDays(days)}
                style={{
                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1,
                  borderColor: collectionDays === days ? colors.primary : colors.border,
                  backgroundColor: collectionDays === days ? colors.primary + '18' : 'transparent',
                }}
              >
                <Text style={{ fontSize: 12, color: collectionDays === days ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {REPORT_TYPES.map((report) => {
          const snap = snapshots[report.id];
          const busy = generatingId === report.id;
          return (
            <TouchableOpacity
              key={report.id}
              activeOpacity={0.75}
              onPress={() => handleGenerate(report)}
              disabled={!!generatingId}
            >
              <FlatCard style={styles.reportCard}>
                <View style={[styles.reportIcon, { backgroundColor: report.color + '1A' }]}>
                  <Feather name={report.icon} size={22} color={report.color} />
                </View>
                <View style={styles.reportContent}>
                  <Text style={[styles.reportTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{report.title}</Text>
                  <Text style={[styles.reportDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{report.description}</Text>
                  {snap && (
                    <Text style={[styles.reportMeta, { color: report.color, fontFamily: 'Inter_500Medium' }]}>
                      {snap.count} record{snap.count === 1 ? '' : 's'} · {snap.note}
                    </Text>
                  )}
                </View>
                <View style={styles.reportRight}>
                  <Feather name={busy ? 'loader' : 'download'} size={16} color={busy ? report.color : colors.mutedForeground} />
                </View>
              </FlatCard>
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
