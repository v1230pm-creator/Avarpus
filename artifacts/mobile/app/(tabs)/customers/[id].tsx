import React, { useMemo, useState } from 'react';
import { Alert, Clipboard, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useReachHoldOff } from '@/components/ui/ReachDown';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { RepairStatusBadge, SampleBadge } from '@/components/ui/Badge';
import { FlatCard, useStaggerAnim } from '@/components/ui/Glass';
import { CustomerFormSheet } from '@/components/forms/CustomerFormSheet';
import { formatCurrency, formatDate, getReturnStatusColor } from '@/utils/helpers';

import { useReturnsList, useRefundsList, useCustomerSummary, getCustomerSummaryQueryKey, useCustomerInviteCreate } from '@workspace/api-client-react';
import type { CustomerInviteResult } from '@workspace/api-client-react';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

export default function CustomerDetailScreen() {
  const colors = useColors();
  // Selectable text keeps its own hold (copy handles); it never takes the page.
  const holdOff = useReachHoldOff();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const theme = {
    bg: colors.background,
    card: colors.card,
    border: colors.border,
    primary: colors.primary,
    text: colors.foreground,
    textMuted: colors.mutedForeground,
    inputBg: isDark ? colors.input : colors.backgroundSecondary,
    warning: colors.warning,
    success: colors.success,
    info: colors.info,
    danger: colors.destructive,
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
        <Text style={{ color: theme.textMuted, fontFamily: fontFamily.regular }}>Customer not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: topPad, backgroundColor: theme.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={size.headerIcon} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text, fontFamily: fontFamily.bold }]}>Profile</Text>
        <TouchableOpacity onPress={() => setShowEdit(true)} style={styles.backBtn} accessibilityLabel="Edit customer">
          <Feather name="edit-2" size={18} color={theme.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}>
        {/* Profile Card */}
        <FlatCard animValue={anims[0]} style={[styles.profileCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Avatar name={customer.name} size={56} />
          {customer.isSample && <SampleBadge style={{ alignSelf: 'center', marginTop: 4 }} />}
          <Text style={[styles.name, { color: theme.text, fontFamily: fontFamily.bold }]}>{customer.name}</Text>
          <Text style={[styles.mobile, { color: theme.primary, fontFamily: fontFamily.medium }]}>{customer.mobile}</Text>
          {(customer as any).alternateMobile && (
            <Text style={{ ...font.caption, color: theme.textMuted, marginTop: space.xs }}>Alt: {(customer as any).alternateMobile}</Text>
          )}
          {customer.email && (
          <Text style={[styles.email, { color: theme.textMuted, fontFamily: fontFamily.regular }]}>{customer.email}</Text>
          )}
          {customer.address && (
            <View style={styles.addressRow}>
              <Feather name="map-pin" size={12} color={theme.textMuted} />
              <Text style={[styles.address, { color: theme.textMuted, fontFamily: fontFamily.regular }]}>{customer.address}</Text>
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
              <Text style={{ color: '#FFFFFF', ...font.button }}>Message</Text>
            </TouchableOpacity>
            {canAccess('payments') && (
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, paddingVertical: 10, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                onPress={() => router.push(`/(tabs)/khata/party/customer/${customer.id}?name=${encodeURIComponent(customer.name)}`)}
                activeOpacity={0.8}
              >
                <Feather name="book" size={14} color={theme.text} />
                <Text style={{ color: theme.text, ...font.button }}>Khata</Text>
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
                    <Text style={{ ...font.captionStrong, color: theme.text }}>
                      Invite created — shown once
                    </Text>
                  </View>
                  <Text
                    selectable
                    onPressIn={holdOff}
                    style={{
                      ...font.captionStrong, color: theme.primary,
                      backgroundColor: theme.card, borderRadius: 6, padding: 8,
                      borderWidth: 1, borderColor: theme.border,
                    }}
                  >
                    {inviteResult.token}
                  </Text>
                  <Text style={{ ...font.caption, color: theme.textMuted }}>
                    Expires: {new Date(inviteResult.expiresAt).toLocaleString()}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                    <TouchableOpacity
                      onPress={handleCopyToken}
                      style={{ flex: 1, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, paddingVertical: 8, borderRadius: 6, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                    >
                      <Feather name="copy" size={12} color={theme.text} />
                      <Text style={{ ...font.captionStrong, color: theme.text }}>Copy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleShareToken}
                      style={{ flex: 1, backgroundColor: theme.primary, paddingVertical: 8, borderRadius: 6, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                    >
                      <Feather name="share-2" size={12} color="#FFFFFF" />
                      <Text style={{ ...font.captionStrong, color: '#FFFFFF' }}>Share</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => { setShowInvite(false); setInviteResult(null); }}>
                    <Text style={{ ...font.caption, color: theme.textMuted, textAlign: 'center', marginTop: space.xs }}>Dismiss</Text>
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
                  <Text style={{ color: theme.primary, ...font.button }}>
                    {inviteMutation.isPending ? 'Generating…' : 'Invite Customer'}
                  </Text>
                </TouchableOpacity>
              )}
              {inviteError && (
                <Text style={{ ...font.caption, color: theme.danger, marginTop: space.xs, textAlign: 'center' }}>
                  {inviteError}
                </Text>
              )}
            </View>
          )}

          {summary && (
            <View style={{ width: '100%', marginTop: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ ...font.bodyStrong, color: theme.text }}>{summary.totalRepairs}</Text>
                  <Text style={{ ...font.caption, color: theme.textMuted, textAlign: 'center' }}>Total Repairs</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ ...font.bodyStrong, color: theme.primary }}>{summary.activeRepairs}</Text>
                  <Text style={{ ...font.caption, color: theme.textMuted, textAlign: 'center' }}>Active</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ ...font.bodyStrong, color: theme.success }}>{summary.deliveredRepairs}</Text>
                  <Text style={{ ...font.caption, color: theme.textMuted, textAlign: 'center' }}>Delivered</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ ...font.bodyStrong, color: summary.outstandingBalance > 0 ? theme.warning : theme.success }}>{formatCurrency(summary.outstandingBalance)}</Text>
                  <Text style={{ ...font.caption, color: theme.textMuted, textAlign: 'center' }}>Balance</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ ...font.bodyStrong, color: theme.text }}>{formatCurrency(summary.paymentsTotal)}</Text>
                  <Text style={{ ...font.caption, color: theme.textMuted, textAlign: 'center' }}>Payments</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ ...font.bodyStrong, color: theme.info }}>{summary.warrantyActiveCount || 0}</Text>
                  <Text style={{ ...font.caption, color: theme.textMuted, textAlign: 'center' }}>Active Warranties</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ ...font.bodyStrong, color: theme.danger }}>{summary.afterSalesCases}</Text>
                  <Text style={{ ...font.caption, color: theme.textMuted, textAlign: 'center' }}>Returns</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: theme.card, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                  <Text style={{ ...font.bodyStrong, color: theme.warning }}>{formatCurrency(summary.refundsTotal)}</Text>
                  <Text style={{ ...font.caption, color: theme.textMuted, textAlign: 'center' }}>Refunds</Text>
                </View>
              </View>
            </View>
          )}
        </FlatCard>

        {/* Payment Ledger — per-repair bill / paid / due */}
        {customerRepairs.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: theme.textMuted, fontFamily: fontFamily.semibold }]}>
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
                      <Text style={{ ...font.captionStrong, color: theme.primary }}>{r.repairId}</Text>
                      <Text style={{ ...font.captionStrong, color: due > 0 ? theme.warning : theme.success }}>
                        {due > 0 ? `Due ${formatCurrency(due)}` : 'Settled'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ ...font.caption, color: theme.textMuted }}>Bill {formatCurrency(bill)}</Text>
                      <Text style={{ ...font.caption, color: theme.textMuted }}>Paid {formatCurrency(paid)}</Text>
                      <Text style={{ ...font.caption, color: theme.textMuted }}>{r.status === 'delivered' ? 'Delivered' : 'In Process'}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </Card>
          </>
        )}

        {/* Activity Timeline */}
        <Text style={[styles.sectionTitle, { color: theme.textMuted, fontFamily: fontFamily.semibold }]}>
          ACTIVITY TIMELINE ({timeline.length})
        </Text>

        {timeline.length === 0 ? (
          <Card style={{ backgroundColor: theme.card, borderColor: theme.border, padding: 16 }}>
            <Text style={[styles.emptyText, { color: theme.textMuted, fontFamily: fontFamily.regular }]}>
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
                    <Text style={[styles.repairId, { color: item.type === 'return' ? theme.warning : theme.primary, fontFamily: fontFamily.bold }]}>
                      {item.type === 'return' ? item.returnId : item.repairId}
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
                    <Text style={{ ...font.captionStrong, color: theme.text }}>{item.stage}</Text>
                  </View>
                  {item.isSample && <SampleBadge />}
                  <Text style={[styles.repairDate, { color: theme.textMuted, fontFamily: fontFamily.regular }]}>
                    {formatDate(item.date)}
                  </Text>
                </View>
                <Text style={[styles.deviceLine, { color: theme.text, fontFamily: fontFamily.medium }]}>
                  {item.brand} {item.model}
                </Text>
                {item.type === 'repair' ? (
                  <>
                    <Text style={[styles.problemLine, { color: theme.textMuted, fontFamily: fontFamily.regular }]} numberOfLines={1}>
                      {item.problem}
                    </Text>
                    <Text style={[styles.chargeText, { color: theme.text, fontFamily: fontFamily.semibold }]}>
                      {formatCurrency(item.repairCharge + item.partsCharge)}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.problemLine, { color: theme.textMuted, fontFamily: fontFamily.regular }]} numberOfLines={1}>
                      Reason: {item.reason.replace(/_/g, ' ')}
                    </Text>
                    {customerRefunds.filter(rf => rf.returnCaseId === item.id).map(rf => (
                      <Text key={rf.id} style={{ ...font.captionStrong, color: theme.info, marginTop: space.xs }}>
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
    minHeight: layout.headerHeight, paddingHorizontal: layout.screenPadding, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent',
  },
  backBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  scroll: { padding: layout.screenPadding, gap: space.md },
  profileCard: { alignItems: 'center', gap: space.xs, padding: space.lg },
  name: { ...font.title, marginTop: space.xs },
  mobile: { ...font.body },
  email: { ...font.caption },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  address: { ...font.caption },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignSelf: 'stretch' },
  statBadge: { flex: 1, borderRadius: 8, padding: 10, alignItems: 'center', gap: 2 },
  statValue: { ...font.bodyStrong },
  statLabel: { ...font.caption },
  sectionTitle: { ...font.overline, marginTop: space.xs },
  emptyText: { textAlign: 'center', ...font.caption },
  repairCard: { gap: 4, padding: 12 },
  repairRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  repairIdBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  repairId: { ...font.smallStrong },
  repairDate: { ...font.caption, marginLeft: 'auto' },
  deviceLine: { ...font.bodyStrong },
  problemLine: { ...font.caption },
  chargeText: { ...font.bodyStrong },
});
