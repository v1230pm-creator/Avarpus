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
import { formatCurrency, getTodayStr } from '@/utils/helpers';
import { buildReportHtml, type ReportData, type StaffMember } from '@/utils/reportHtml';
import { useColors } from '@/hooks/useColors';
import { font } from '@/constants/typography';
import { layout, radius, space } from '@/constants/spacing';

interface ReportType {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
}

const REPORT_TYPES: ReportType[] = [
  { id: 'repair', title: 'Repair Report', description: 'All repair jobs with status & billing', icon: 'tool' },
  { id: 'customer', title: 'Customer Report', description: 'Customer list with dues & history', icon: 'users' },
  { id: 'inventory', title: 'Inventory Report', description: 'Stock levels, low stock alerts', icon: 'package' },
  { id: 'purchase', title: 'Purchase Report', description: 'Purchase orders, supplier payments', icon: 'shopping-bag' },
  { id: 'finance', title: 'Finance Report', description: 'Income, expense, profit & loss', icon: 'bar-chart-2' },
  { id: 'staff', title: 'Staff Report', description: 'Staff list, roles & status', icon: 'user-check' },
  { id: 'technician', title: 'Technician Report', description: 'Jobs completed per technician', icon: 'award' },
  { id: 'warranty', title: 'Warranty Report', description: 'Repair warranties & expiry', icon: 'shield' },
  { id: 'collection', title: 'Collection Report', description: 'Payments received by method (Cash/UPI/Card...)', icon: 'dollar-sign' },
  { id: 'daily', title: 'Daily Received vs Repaired', description: 'Date-wise: phones received & repaired per day', icon: 'calendar' },
  { id: 'pending', title: 'Pending Payments', description: 'Repairs with outstanding balances', icon: 'credit-card' },
  { id: 'refunds', title: 'Refunds', description: 'List of all processed refunds', icon: 'corner-up-left' },
  { id: 'parts', title: 'Parts Consumption', description: 'Parts used across repairs', icon: 'settings' },
];

function notify(title: string, message: string) {
  if (Platform.OS === 'web') {
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
  const { repairs, customers, inventory, finance, purchases, loadAll } = useData();
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
  const [collectionDays, setCollectionDays] = useState<number | null>(30);

  const canSeeStaff = user?.role === 'dealer' || user?.role === 'super_admin';

  const loadStaff = useCallback(async () => {
    if (!canSeeStaff) return;
    try {
      const res = await staffList();
      setStaff(res.staff as StaffMember[]);
    } catch {
      // Ignore
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

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

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
            <h2 style="text-align:center;margin-bottom:2px;">${user?.businessName || 'Avarpus'}</h2>
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
            <h2 style="text-align:center;margin-bottom:2px;">${user?.businessName || 'Avarpus'}</h2>
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
      notify('No data yet', `There is no data for the ${report.title.toLowerCase()} yet. Add some records first.`);
      return;
    }

    try {
      if (Platform.OS === 'web') {
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
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: 12 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Business Reports</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {canSeeFinance && (
          <View style={[styles.periodCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.periodLabel, { color: colors.mutedForeground }]}>Collection period</Text>
            <View style={styles.periodOptions}>
              {([
                ['Today', 1],
                ['7 Days', 7],
                ['30 Days', 30],
                ['All Time', null],
              ] as [string, number | null][]).map(([label, days]) => {
                const active = collectionDays === days;
                return (
                  <TouchableOpacity
                    key={label}
                    onPress={() => setCollectionDays(days)}
                    style={[
                      styles.periodOption,
                      {
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.primary + '18' : colors.background,
                      },
                    ]}
                  >
                    <Text style={[styles.periodOptionText, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.gridContainer}>
          {REPORT_TYPES.map((report) => {
            const busy = generatingId === report.id;
            return (
              <TouchableOpacity
                key={report.id}
                activeOpacity={0.7}
                onPress={() => handleGenerate(report)}
                disabled={!!generatingId}
                style={[styles.gridCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.cardIconBox, { backgroundColor: colors.background }]}>
                  <Feather name={report.icon} size={24} color={colors.primary} />
                </View>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{report.title}</Text>
                {busy && (
                  <Text style={[styles.cardStatus, { color: colors.mutedForeground }]}>Generating...</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 12, 
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  scroll: { padding: 12, paddingBottom: 100 },
  periodCard: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, gap: 10 },
  periodLabel: { ...font.overline },
  periodOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  periodOption: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  periodOptionText: { ...font.captionStrong },

  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  gridCard: {
    width: '47%',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cardIconBox: {
    width: 48, height: 48,
    borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 13,
    ...font.bodyStrong,
    textAlign: 'center',
  },
  cardStatus: {
    ...font.captionStrong,
    marginTop: 4,
  },
});

