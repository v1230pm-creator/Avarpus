import React, { useMemo, useState } from 'react';
import { Alert, Clipboard, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { RepairStatusBadge, SampleBadge } from '@/components/ui/Badge';
import { FlatCard, useStaggerAnim } from '@/components/ui/Glass';
import { CustomerFormSheet } from '@/components/forms/CustomerFormSheet';
import { formatCurrency, formatDate, getReturnStatusColor } from '@/utils/helpers';

import { useReturnsList, useRefundsList, useCustomerSummary, getCustomerSummaryQueryKey, useCustomerInviteCreate } from '@workspace/api-client-react';
import type { CustomerInviteResult } from '@workspace/api-client-react';

export default function CustomerDetailScreen() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const theme = {
    bg: isDark ? '#040914' : colors.background,
    card: isDark ? '#0A1221' : colors.card,
    border: isDark ? '#1E293B' : colors.border,
    primary: isDark ? '#2563EB' : colors.primary,
    text: isDark ? '#FFFFFF' : colors.foreground,
    textMuted: isDark ? '#94A3B8' : colors.mutedForeground,
    inputBg: isDark ? '#0F172A' : colors.backgroundSecondary,
    warning: isDark ? '#F59E0B' : colors.warning,
    success: isDark ? '#10B981' : colors.success,
    info: isDark ? '#3B82F6' : colors.info,
    danger: isDark ? '#EF4444' : colors.destructive,
  };

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { customers, repairs } = useData();
  const { canAccess } = useAuth();
  const [showEdit, setShowEdit] = useState(false);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const customer = useMemo(() => customers.find((c) => c.id === id), [customers, id]);
  const customerRepairs = useMemo(
    () => repairs.filter((r) => r.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [repairs, id],
  );

  const { data: returnsData } = useReturnsList();
  const { data: refundsData } = useRefundsList();
  const { data: summaryData } = useCustomerSummary(id as string, { query: { enabled: !!id, queryKey: getCustomerSummaryQueryKey(id as string) } });
  const summary = summaryData?.summary;

  // Customer invite
  const inviteMutation = useCustomerInviteCreate();
  const [inviteResult, setInviteResult] = useState<CustomerInviteResult | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const handleInvite = () => {
    setInviteError(null);
    inviteMutation.mutate(
      { id: id as string },
      {
        onSuccess: (res) => {
          setInviteResult(res);
          setShowInvite(true);
        },
        onError: (err: any) => {
          setInviteError(err?.data?.message ?? err?.message ?? 'Could not generate invite.');
        },
      },
    );
  };

  const handleCopyToken = () => {
    if (!inviteResult) return;
    Clipboard.setString(inviteResult.token);
    Alert.alert('Copied', 'Activation token copied to clipboard.');
  };

  const handleShareToken = async () => {
    if (!inviteResult) return;
    try {
      await Share.share({
        message:
          `Open Avarpus, choose “Activate Account” on the sign-in screen, and enter this single-use token:\n\n` +
          `${inviteResult.token}\n\nExpires: ${new Date(inviteResult.expiresAt).toLocaleString()}`,
        title: 'Customer Activation Token',
      });
    } catch {
      // User cancelled share — ignore
    }
  };
  const customerReturns = useMemo(() => {
    return (returnsData?.returns || []).filter(r => r.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [returnsData, id]);
  const customerRefunds = useMemo(() => {
    return (refundsData?.refunds || []).filter(rf => rf.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [refundsData, id]);

  const timeline = useMemo(() => {
    const arr: any[] = [];
    customerRepairs.forEach(r => {
      let stage = 'In Repair';
      if (r.status === 'received') stage = 'Received';
      else if (r.status === 'delivered') stage = 'Delivered';
      else if (r.status === 'cancelled') stage = 'Cancelled';
      arr.push({ ...r, type: 'repair', stage, date: r.createdAt });
    });
    customerReturns.forEach(r => {
      arr.push({ ...r, type: 'return', stage: 'After-Sales', date: r.createdAt });
    });
    return arr.sort((a, b) => b.date.localeCompare(a.date));
  }, [customerRepairs, customerReturns]);

  const anims = useStaggerAnim(4);

  if (!customer) {
    return (
      <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.textMuted, fontFamily: 'Inter_400Regular' }}>Customer not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: topPad + 10, backgroundColor: theme.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text, fontFamily: 'Inter_700Bold' }]}>Profile</Text>
        <TouchableOpacity onPress={() => setShowEdit(true)} style={styles.backBtn} accessibilityLabel="Edit customer">
          <Feather name="edit-2" size={18} color={theme.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}>
        {/* Profile Card */}
        <FlatCard animValue={anims[0]} style={[styles.profileCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Avatar name={customer.name} size={56} />
          {customer.isSample && <SampleBadge style={{ alignSelf: 'center', marginTop: 4 }} />}
          <Text style={[styles.name, { color: theme.text, fontFamily: 'Inter_700Bold' }]}>{customer.name}</Text>
          <Text style={[styles.mobile, { color: theme.primary, fontFamily: 'Inter_500Medium' }]}>{customer.mobile}</Text>
          {(customer as any).alternateMobile && (
            <Text style={{ fontSize: 12, color: theme.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 }}>Alt: {(customer as any).alternateMobile}</Text>
          )}
          {customer.email && (
            <Text style={[styles.email, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]}>{customer.email}</Text>
          )}
          {customer.address && (
            <View style={styles.addressRow}>
              <Feather name="map-pin" size={12} color={theme.textMuted} />
              <Text style={[styles.address, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]}>{customer.address}</Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, width: '100%' }}>
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: theme.primary, paddingVertical: 10, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
              onPress={() =>
                router.push(
                  `/(tabs)/customers/chat/${customer.id}?targetId=${customer.id}&type=customer&name=${encodeURIComponent(customer.name)}`,
                )
              }
              activeOpacity={0.8}
            >
              <Feather name="message-square" size={14} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 13 }}>Message</Text>
            </TouchableOpacity>
            {canAccess('payments') && (
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, paddingVertical: 10, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                onPress={() => router.push(`/(tabs)/khata/party/customer/${customer.id}?name=${encodeURIComponent(customer.name)}`)}
                activeOpacity={0.8}
              >
                <Feather name="book" size={14} color={theme.text} />
                <Text style={{ color: theme.text, fontWeight: '600', fontSize: 13 }}>Khata</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Customer invite — dealer/owner only */}
          {(canAccess('customers')) && (
            <View style={{ width: '100%', marginTop: 8 }}>
              {showInvite && inviteResult ? (
                <View style={{ backgroundColor: theme.inputBg, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: theme.border, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Feather name="check-circle" size={14} color={theme.success} />
                    <Text style={{ fontSize: 12, color: theme.text, fontFamily: 'Inter_600SemiBold' }}>
                      Invite created — shown once
                    </Text>
                  </View>
                  <Text
                    selectable
                    style={{
                      fontSize: 11, color: theme.primary, fontFamily: 'Inter_500Medium',
                      backgroundColor: theme.card, borderRadius: 6, padding: 8,
                      borderWidth: 1, borderColor: theme.border,
                    }}
                  >
                    {inviteResult.token}
                  </Text>
                  <Text style={{ fontSize: 10, color: theme.textMuted, fontFamily: 'Inter_400Regular' }}>
                    Expires: {new Date(inviteResult.expiresAt).toLocaleString()}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                    <TouchableOpacity
                      onPress={handleCopyToken}
                      style={{ flex: 1, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, paddingVertical: 8, borderRadius: 6, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                    >
                      <Feather name="copy" size={12} color={theme.text} />
                      <Text style={{ fontSize: 12, color: theme.text, fontFamily: 'Inter_500Medium' }}>Copy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleShareToken}
                      style={{ flex: 1, backgroundColor: theme.primary, paddingVertical: 8, borderRadius: 6, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                    >
                      <Feather name="share-2" size={12} color="#FFFFFF" />
                      <Text style={{ fontSize: 12, color: '#FFFFFF', fontFamily: 'Inter_500Medium' }}>Share</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => { setShowInvite(false); setInviteResult(null); }}>
                    <Text style={{ fontSize: 10, color: theme.textMuted, textAlign: 'center', marginTop: 4 }}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={handleInvite}
                  disabled={inviteMutation.isPending}
                  style={{
                    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
                    paddingVertical: 10, borderRadius: 8,
                    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
                    opacity: inviteMutation.isPending ? 0.6 : 1,
                  }}
                  activeOpacity={0.8}
                >
                  <Feather name="user-plus" size={14} color={theme.primary} />
                  <Text style={{ color: theme.primary, fontWeight: '600', fontSize: 13 }}>
                    {inviteMutation.isPending ? 'Generating…' : 'Invite Customer'}
                  </Text>
                </TouchableOpacity>
              )}
              {inviteError && (
                <Text style={{ fontSize: 11, color: theme.danger, fontFamily: 'Inter_400Regular', marginTop: 4, textAlign: 'center' }}>
                  {inviteError}
                </Text>
              )}
            </View>
          )}

          {summary && (
            <View style={{ width: '100%', marginTop: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: theme.text, fontFamily: 'Inter_700Bold' }}>{summary.totalRepairs}</Text>
                  <Text style={{ fontSize: 9, color: theme.textMuted, textAlign: 'center' }}>Total Repairs</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: theme.primary, fontFamily: 'Inter_700Bold' }}>{summary.activeRepairs}</Text>
                  <Text style={{ fontSize: 9, color: theme.textMuted, textAlign: 'center' }}>Active</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: theme.success, fontFamily: 'Inter_700Bold' }}>{summary.deliveredRepairs}</Text>
                  <Text style={{ fontSize: 9, color: theme.textMuted, textAlign: 'center' }}>Delivered</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: summary.outstandingBalance > 0 ? theme.warning : theme.success, fontFamily: 'Inter_700Bold' }}>{formatCurrency(summary.outstandingBalance)}</Text>
                  <Text style={{ fontSize: 9, color: theme.textMuted, textAlign: 'center' }}>Balance</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: theme.text, fontFamily: 'Inter_700Bold' }}>{formatCurrency(summary.paymentsTotal)}</Text>
                  <Text style={{ fontSize: 9, color: theme.textMuted, textAlign: 'center' }}>Payments</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: theme.info, fontFamily: 'Inter_700Bold' }}>{summary.warrantyActiveCount || 0}</Text>
                  <Text style={{ fontSize: 9, color: theme.textMuted, textAlign: 'center' }}>Active Warranties</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: theme.danger, fontFamily: 'Inter_700Bold' }}>{summary.afterSalesCases}</Text>
                  <Text style={{ fontSize: 9, color: theme.textMuted, textAlign: 'center' }}>Returns</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: theme.warning, fontFamily: 'Inter_700Bold' }}>{formatCurrency(summary.refundsTotal)}</Text>
                  <Text style={{ fontSize: 9, color: theme.textMuted, textAlign: 'center' }}>Refunds</Text>
                </View>
              </View>
            </View>
          )}
        </FlatCard>

        {/* Payment Ledger — per-repair bill / paid / due */}
        {customerRepairs.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: theme.textMuted, fontFamily: 'Inter_600SemiBold' }]}>
              PAYMENT LEDGER
            </Text>
            <Card style={{ backgroundColor: theme.card, borderColor: theme.border, padding: 12 }}>
              {customerRepairs.map((r, idx) => {
                const bill = (r as any).totalAmount ?? (r.repairCharge + r.partsCharge);
                const paid = (r as any).paidAmount ?? r.advance ?? 0;
                const due = Math.max(0, ((r as any).balance ?? (bill - paid)));
                return (
                  <TouchableOpacity
                    key={r.id}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/(tabs)/repairs/${r.id}`)}
                    style={{ paddingVertical: 8, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: theme.border }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                      <Text style={{ fontSize: 12, color: theme.primary, fontFamily: 'Inter_600SemiBold' }}>{r.repairId}</Text>
                      <Text style={{ fontSize: 10, color: due > 0 ? theme.warning : theme.success, fontFamily: 'Inter_600SemiBold' }}>
                        {due > 0 ? `Due ${formatCurrency(due)}` : 'Settled'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 10, color: theme.textMuted }}>Bill {formatCurrency(bill)}</Text>
                      <Text style={{ fontSize: 10, color: theme.textMuted }}>Paid {formatCurrency(paid)}</Text>
                      <Text style={{ fontSize: 10, color: theme.textMuted }}>{r.status === 'delivered' ? 'Delivered' : 'In Process'}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </Card>
          </>
        )}

        {/* Activity Timeline */}
        <Text style={[styles.sectionTitle, { color: theme.textMuted, fontFamily: 'Inter_600SemiBold' }]}>
          ACTIVITY TIMELINE ({timeline.length})
        </Text>

        {timeline.length === 0 ? (
          <Card style={{ backgroundColor: theme.card, borderColor: theme.border, padding: 16 }}>
            <Text style={[styles.emptyText, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]}>
              No activity yet
            </Text>
          </Card>
        ) : (
          timeline.map((item) => (
            <TouchableOpacity
              key={`${item.type}-${item.id}`}
              onPress={() => item.type === 'return' ? router.push(`/(tabs)/repairs/return/${item.id}`) : router.push(`/(tabs)/repairs/${item.id}`)}
              activeOpacity={0.8}
            >
              <Card style={{ ...styles.repairCard, backgroundColor: theme.card, borderColor: theme.border }}>
                <View style={styles.repairRow}>
                  <View style={[styles.repairIdBadge, { backgroundColor: item.type === 'return' ? theme.warning + '15' : theme.primary + '15' }]}>
                    <Text style={[styles.repairId, { color: item.type === 'return' ? theme.warning : theme.primary, fontFamily: 'Inter_700Bold' }]}>
                      {item.type === 'return' ? item.returnId : item.repairId}
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
                    <Text style={{ fontSize: 10, color: theme.text, fontFamily: 'Inter_600SemiBold' }}>{item.stage}</Text>
                  </View>
                  {item.isSample && <SampleBadge />}
                  <Text style={[styles.repairDate, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]}>
                    {formatDate(item.date)}
                  </Text>
                </View>
                <Text style={[styles.deviceLine, { color: theme.text, fontFamily: 'Inter_500Medium' }]}>
                  {item.brand} {item.model}
                </Text>
                {item.type === 'repair' ? (
                  <>
                    <Text style={[styles.problemLine, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
                      {item.problem}
                    </Text>
                    <Text style={[styles.chargeText, { color: theme.text, fontFamily: 'Inter_600SemiBold' }]}>
                      {formatCurrency(item.repairCharge + item.partsCharge)}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.problemLine, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
                      Reason: {item.reason.replace(/_/g, ' ')}
                    </Text>
                    {customerRefunds.filter(rf => rf.returnCaseId === item.id).map(rf => (
                      <Text key={rf.id} style={{ fontSize: 12, color: theme.info, fontFamily: 'Inter_600SemiBold', marginTop: 2 }}>
                        Refund: {formatCurrency(rf.amount)} ({rf.status.replace('_', ' ')})
                      </Text>
                    ))}
                  </>
                )}
              </Card>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <CustomerFormSheet visible={showEdit} onClose={() => setShowEdit(false)} customer={customer} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: 'transparent',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16 },
  scroll: { padding: 16, gap: 12 },
  profileCard: { alignItems: 'center', gap: 4, padding: 16 },
  name: { fontSize: 20, marginTop: 4, letterSpacing: -0.5 },
  mobile: { fontSize: 14 },
  email: { fontSize: 12 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  address: { fontSize: 11 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignSelf: 'stretch' },
  statBadge: { flex: 1, borderRadius: 8, padding: 10, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 16 },
  statLabel: { fontSize: 10 },
  sectionTitle: { fontSize: 10, letterSpacing: 1, marginTop: 4 },
  emptyText: { textAlign: 'center', fontSize: 13 },
  repairCard: { gap: 4, padding: 12 },
  repairRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  repairIdBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  repairId: { fontSize: 10 },
  repairDate: { fontSize: 10, marginLeft: 'auto' },
  deviceLine: { fontSize: 13 },
  problemLine: { fontSize: 11 },
  chargeText: { fontSize: 13 },
});
