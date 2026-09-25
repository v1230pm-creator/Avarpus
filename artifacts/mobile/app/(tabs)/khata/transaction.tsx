import React, { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useCustomersKhataGet,
  useDealerTransactionsGet,
  type CustomerKhataLedgerEntry,
  type CustomerKhataLedger,
  type DealerTransactionsGet200,
  type Refund,
  type RepairPayment,
} from '@workspace/api-client-react';
import { FlatCard } from '@/components/ui/FlatCard';
import { AvarpusLoadingScreen } from '@/components/ui/AvarpusSpinner';
import { DataErrorState } from '@/components/ui/DataStates';
import { useColors } from '@/hooks/useColors';
import { useReachHoldOff } from '@/components/ui/ReachDown';
import { formatCurrency, formatDate } from '@/utils/helpers';
import { dealerBalanceLabel, formatDateTime } from '@/utils/dealer-ledger';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

type Scope = 'dealer' | 'customer';

interface Row { label: string; value: string }
interface Link { label: string; icon: 'tool' | 'book-open' | 'briefcase'; onPress: () => void }

/**
 * Dynamic details for ONE ledger entry (bill / payment / void / refund /
 * manual), whether it came from a dealer-to-dealer ledger or a customer's
 * khata. Only fields that were actually saved are rendered — there are no
 * placeholder rows — and every related record is one tap away.
 */
export default function KhataTransactionDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useColors();
  // Selectable text keeps its own hold (copy handles); it never takes the page.
  const holdOff = useReachHoldOff();
  const params = useLocalSearchParams<{
    scope?: string;
    entryId?: string;
    repairId?: string;
    shopId?: string;
    direction?: string;
    customerId?: string;
    name?: string;
  }>();
  const scope: Scope = params.scope === 'customer' ? 'customer' : 'dealer';
  const entryId = params.entryId ?? '';
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const dealerQuery = useDealerTransactionsGet(params.repairId ?? '', {
    query: { enabled: scope === 'dealer' && !!params.repairId },
  } as any);
  const customerQuery = useCustomersKhataGet(params.customerId ?? '', {
    query: { enabled: scope === 'customer' && !!params.customerId },
  } as any);
  const dealerData = dealerQuery.data as DealerTransactionsGet200 | undefined;
  const customerData = customerQuery.data as CustomerKhataLedger | undefined;

  const view = useMemo(() => {
    if (scope === 'dealer') return dealerView(dealerData, entryId);
    return customerView(customerData, entryId);
  }, [scope, dealerData, customerData, entryId]);

  const isLoading = scope === 'dealer' ? dealerQuery.isLoading : customerQuery.isLoading;
  const error = scope === 'dealer' ? dealerQuery.error : customerQuery.error;
  const refetch = scope === 'dealer' ? dealerQuery.refetch : customerQuery.refetch;

  const links: Link[] = [];
  if (view?.repairRowId) {
    if (scope === 'dealer') {
      links.push({
        label: 'Open transaction',
        icon: 'briefcase',
        onPress: () => router.push(`/(tabs)/repairs/dealer-transactions/${view.repairRowId}` as any),
      });
      // Only the repairing shop holds the ordinary repair record.
      if (dealerData?.side === 'receiver') {
        links.push({ label: 'Open repair record', icon: 'tool', onPress: () => router.push(`/(tabs)/repairs/${view.repairRowId}` as any) });
      }
    } else {
      links.push({ label: 'Open repair record', icon: 'tool', onPress: () => router.push(`/(tabs)/repairs/${view.repairRowId}` as any) });
    }
  }
  if (scope === 'dealer' && dealerData?.counterpart) {
    const counterpart = dealerData.counterpart;
    links.push({
      label: `${counterpart.businessName} ledger`,
      icon: 'book-open',
      onPress: () => router.push({
        pathname: '/(tabs)/khata/dealer/[shopId]',
        params: {
          shopId: counterpart.shopId,
          direction: dealerData.side === 'sender' ? 'payable' : 'receivable',
          name: counterpart.businessName,
        },
      } as any),
    });
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + layout.rowPaddingVertical }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]} accessibilityLabel="Go back">
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>{view?.title ?? 'Entry'}</Text>
          {!!view?.subtitle && (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]} numberOfLines={1}>{view.subtitle}</Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      {isLoading && !view ? (
        <AvarpusLoadingScreen background={colors.background} size={40} />
      ) : error && !view ? (
        <DataErrorState onRetry={() => { void refetch(); }} />
      ) : !view ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>This entry is no longer available.</Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: layout.screenPadding, paddingBottom: insets.bottom + size.avatarSm, gap: space.md }} showsVerticalScrollIndicator={false}>
          <FlatCard style={{ padding: space.lg, gap: space.sm, alignItems: 'center' }}>
            <Text style={[styles.amount, { color: view.tone === 'in' ? colors.success : view.tone === 'out' ? colors.destructive : colors.foreground }]}>
              {formatCurrency(view.amount)}
            </Text>
            <Text style={[styles.direction, { color: colors.foreground }]}>{view.directionLabel}</Text>
            {!!view.statusLine && (
              <Text style={[styles.statusLine, { color: colors.mutedForeground }]}>{view.statusLine}</Text>
            )}
          </FlatCard>

          <FlatCard style={{ padding: space.lg, gap: 0 }}>
            {view.rows.map((row, i) => (
              <View key={row.label} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                <Text style={[styles.rowValue, { color: colors.foreground }]} selectable onPressIn={holdOff}>{row.value}</Text>
              </View>
            ))}
          </FlatCard>

          {links.length > 0 && (
            <FlatCard style={{ padding: 4 }}>
              {links.map((link, i) => (
                <TouchableOpacity
                  key={link.label}
                  onPress={link.onPress}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  style={[styles.linkRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                >
                  <View style={[styles.linkIcon, { backgroundColor: colors.primary + '14' }]}>
                    <Feather name={link.icon} size={16} color={colors.primary} />
                  </View>
                  <Text style={[styles.linkLabel, { color: colors.foreground }]}>{link.label}</Text>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </FlatCard>
          )}
        </ScrollView>
      )}
    </View>
  );
}

interface EntryView {
  title: string;
  subtitle?: string;
  amount: number;
  directionLabel: string;
  tone: 'in' | 'out' | 'neutral';
  statusLine?: string;
  rows: Row[];
  repairRowId?: string;
}

function push(rows: Row[], label: string, value: unknown) {
  if (value === undefined || value === null) return;
  const text = typeof value === 'number' ? String(value) : String(value).trim();
  if (!text) return;
  rows.push({ label, value: text });
}

function dealerView(
  data: DealerTransactionsGet200 | undefined,
  entryId: string,
): EntryView | null {
  if (!data) return null;
  const [kind, rawId] = entryId.split(':');
  // Direction comes from which side the SERVER says we are, never from a
  // route parameter that could be edited.
  const payable = data.side === 'sender';
  const ledgerDirection = payable ? 'payable' : 'receivable';
  const repair = data.repair;
  const device = `${repair.brand} ${repair.model}`.trim();
  const rows: Row[] = [];
  const common = () => {
    push(rows, 'Transaction', data.transactionCode);
    push(rows, 'Ticket', repair.repairId);
    push(rows, 'Device', device);
    push(rows, payable ? 'Repairing shop' : 'Source dealer', data.counterpart?.businessName);
  };

  if (kind === 'bill') {
    const f = data.financials;
    if (!f) return null;
    common();
    push(rows, 'Repair charge', repair.repairCharge ? formatCurrency(repair.repairCharge) : undefined);
    push(rows, 'Parts', repair.partsCharge ? formatCurrency(repair.partsCharge) : undefined);
    push(rows, 'Service', repair.serviceCharge ? formatCurrency(repair.serviceCharge) : undefined);
    push(rows, 'Other', repair.otherCharge ? formatCurrency(repair.otherCharge) : undefined);
    push(rows, 'Discount', repair.discount ? formatCurrency(repair.discount) : undefined);
    push(rows, 'Tax', repair.taxPercent ? `${repair.taxPercent}%` : undefined);
    push(rows, 'Posted on', repair.deliveryDate ? formatDate(repair.deliveryDate) : repair.readyAt ? formatDateTime(repair.readyAt) : undefined);
    push(rows, 'Paid so far', formatCurrency(f.paid));
    push(rows, 'Balance', `${formatCurrency(Math.abs(f.balance))}${f.balance === 0 ? '' : ` · ${dealerBalanceLabel(ledgerDirection, f.balance)}`}`);
    return {
      title: 'Repair Bill',
      subtitle: `${data.transactionCode} · ${device}`,
      amount: f.billed,
      directionLabel: payable ? 'You Owe' : 'They Owe You',
      tone: payable ? 'out' : 'in',
      statusLine: f.billPosted ? undefined : 'Bill not posted yet',
      rows,
      repairRowId: repair.id,
    };
  }

  if (kind === 'payment') {
    const p: RepairPayment | undefined = (data.payments ?? []).find((x) => x.id === rawId);
    if (!p) return null;
    const voided = !!p.voidedAt;
    common();
    push(rows, 'Method', p.method);
    push(rows, 'Reference no.', p.referenceNo);
    push(rows, 'Note', p.note);
    push(rows, 'Recorded on', formatDateTime(p.createdAt));
    push(rows, 'Recorded by', p.recordedByName);
    push(rows, 'Received by', p.receivedByName && p.receivedByName !== p.recordedByName ? p.receivedByName : undefined);
    if (voided) {
      push(rows, 'Voided on', p.voidedAt ? formatDateTime(p.voidedAt) : undefined);
      push(rows, 'Voided by', p.voidedByName);
      push(rows, 'Void reason', p.voidReason);
    }
    return {
      title: voided ? 'Payment Voided' : 'Payment',
      subtitle: `${data.transactionCode} · ${device}`,
      amount: p.amount,
      directionLabel: voided ? 'Voided — no longer counted' : payable ? 'You Paid' : 'You Received',
      tone: voided ? 'neutral' : payable ? 'out' : 'in',
      statusLine: voided ? 'The original payment stays on record for audit.' : undefined,
      rows,
      repairRowId: repair.id,
    };
  }

  if (kind === 'refund') {
    const r: Refund | undefined = (data.refunds ?? []).find((x) => x.id === rawId);
    if (!r) return null;
    common();
    push(rows, 'Method', r.method);
    push(rows, 'Reference no.', r.referenceNo);
    push(rows, 'Reason', r.reason);
    push(rows, 'Status', r.status);
    push(rows, 'Requested by', r.requestedByName);
    push(rows, 'Approved by', r.approvedByName);
    push(rows, 'Approved on', r.approvedAt ? formatDateTime(r.approvedAt) : undefined);
    push(rows, 'Paid by', r.paidByName);
    push(rows, 'Paid on', r.paidAt ? formatDateTime(r.paidAt) : undefined);
    return {
      title: 'Refund',
      subtitle: `${data.transactionCode} · ${device}`,
      amount: r.amount,
      directionLabel: payable ? 'Refund To You' : 'Refund By You',
      tone: payable ? 'in' : 'out',
      rows,
      repairRowId: repair.id,
    };
  }
  return null;
}

function customerView(
  data: CustomerKhataLedger | undefined,
  entryId: string,
): EntryView | null {
  if (!data) return null;
  const entry: CustomerKhataLedgerEntry | undefined = data.ledger.find((e: CustomerKhataLedgerEntry) => e.id === entryId);
  if (!entry) return null;
  const rows: Row[] = [];
  push(rows, 'Customer', data.customer.name);
  push(rows, 'Ticket', entry.repairId);
  push(rows, 'Method', entry.method);
  push(rows, 'Note', entry.note);
  push(rows, 'Date', formatDate(entry.bookDate));
  push(rows, 'Recorded on', formatDateTime(entry.createdAt));
  push(rows, 'Balance after', `${formatCurrency(Math.abs(entry.runningBalance))}${entry.runningBalance > 0 ? ' Due' : entry.runningBalance < 0 ? ' Advance' : ''}`);

  const isVoid = entry.type === 'repair_payment_void';
  const title =
    entry.type === 'repair_bill' ? 'Repair Bill'
      : entry.type === 'repair_payment' ? 'Payment Received'
        : isVoid ? 'Payment Voided'
          : entry.type === 'refund' ? 'Refund'
            : entry.direction === 'given' ? 'Payment Given' : 'Payment Received';
  const directionLabel =
    isVoid ? 'Voided — no longer counted'
      : entry.direction === 'given' ? 'They Owe You' : 'You Received';
  return {
    title,
    subtitle: data.customer.name,
    amount: entry.amount,
    directionLabel,
    tone: isVoid ? 'neutral' : entry.direction === 'given' ? 'in' : 'out',
    rows,
    repairRowId: entry.repairRowId,
  };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: layout.headerHeight, paddingHorizontal: layout.screenPadding, gap: space.sm },
  backBtn: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  headerSub: { ...font.caption },
  amount: { ...font.title },
  direction: { ...font.bodyStrong },
  statusLine: { ...font.caption, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md },
  rowLabel: { ...font.captionStrong, flexShrink: 0 },
  rowValue: { ...font.bodyStrong, flex: 1, textAlign: 'right' },
  linkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: space.md, paddingHorizontal: space.md },
  linkIcon: { width: size.chip, height: size.chip, borderRadius: size.chip / 2, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { flex: 1, ...font.bodyStrong },
  emptyText: { ...font.body, textAlign: 'center', marginTop: 40 },
});
