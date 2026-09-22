import React, { useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDealerTransactionsLedgerGet, type DealerLedgerEntry } from '@workspace/api-client-react';
import { formatCurrency } from '@/utils/helpers';
import {
  DEALER_DIRECTION_LABELS,
  DEALER_ENTRY_KIND_ICONS,
  DEALER_ENTRY_KIND_LABELS,
  dealerBalanceLabel,
  dealerEntryEffect,
  dealerPartyRoleLabel,
  formatDateTime,
} from '@/utils/dealer-ledger';
import { Avatar } from '@/components/ui/Avatar';
import { AvarpusLoadingScreen } from '@/components/ui/AvarpusSpinner';
import { DataErrorBanner, DataErrorState } from '@/components/ui/DataStates';
import { useColors } from '@/hooks/useColors';
import { useDealerChat } from '@/hooks/useDealerChat';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

type Direction = 'payable' | 'receivable';

// One shop's dealer-to-dealer ledger with me, in ONE direction. The same
// shop can appear twice in Khata (as my supplier and as my dealer); those are
// separate books and are never netted against each other.
export default function DealerLedgerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useColors();
  const { shopId, direction: rawDirection, name } = useLocalSearchParams<{
    shopId: string;
    direction?: string;
    name?: string;
  }>();
  const direction: Direction = rawDirection === 'receivable' ? 'receivable' : 'payable';
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const { data, isLoading, error, refetch, isFetching } = useDealerTransactionsLedgerGet(
    shopId ?? '',
    { direction },
    { query: { enabled: !!shopId } } as any,
  );
  const { openChat, busy: chatBusy } = useDealerChat();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const party = data?.party;
  const entries = data?.entries ?? [];
  const totals = data?.totals;
  const partyName = party?.businessName ?? name ?? 'Dealer';

  const openEntry = (entry: DealerLedgerEntry) => {
    router.push({
      pathname: '/(tabs)/khata/transaction',
      params: {
        scope: 'dealer',
        entryId: entry.id,
        repairId: entry.repairId,
        shopId: shopId ?? '',
        direction,
        name: partyName,
      },
    } as any);
  };

  if (isLoading && !data) {
    return <AvarpusLoadingScreen background={colors.background} size={40} />;
  }

  if (error && !data) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPadding }]}>
        <DataErrorState onRetry={() => { void refetch(); }} />
      </View>
    );
  }

  const balance = totals?.balance ?? 0;
  const balanceLabel = dealerBalanceLabel(direction, balance);
  const balanceColor = balance === 0 ? colors.foreground : balanceLabel === 'You Owe' ? colors.destructive : colors.success;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()} accessibilityLabel="Go back">
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Avatar name={partyName} size={36} />
        <View style={{ flex: 1, paddingHorizontal: 12 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>{partyName}</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {dealerPartyRoleLabel({ direction })}
          </Text>
        </View>
        {!!party && (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => { void openChat(party); }}
            disabled={chatBusy}
            accessibilityLabel={`Chat with ${partyName}`}
          >
            <Feather name="message-circle" size={22} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing || isFetching} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {!!error && <DataErrorBanner onRetry={onRefresh} />}

        <View style={[styles.summaryBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.summaryBox}>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Due</Text>
            <Text style={[styles.summaryValue, { color: balanceColor }]}>{formatCurrency(Math.abs(balance))}</Text>
            <Text style={[styles.summaryDirection, { color: balanceColor }]}>{balanceLabel}</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryRow}>
            <View style={styles.summaryMiniBox}>
              <Text style={[styles.summaryMiniLabel, { color: colors.mutedForeground }]}>Total Bills</Text>
              <Text style={[styles.summaryMiniValue, { color: colors.foreground }]}>{formatCurrency(totals?.billed ?? 0)}</Text>
            </View>
            <View style={styles.summaryMiniBox}>
              <Text style={[styles.summaryMiniLabel, { color: colors.mutedForeground }]}>
                {direction === 'payable' ? 'You Paid' : 'You Received'}
              </Text>
              <Text style={[styles.summaryMiniValue, { color: colors.foreground }]}>{formatCurrency(totals?.paid ?? 0)}</Text>
            </View>
            {(totals?.refunded ?? 0) > 0 && (
              <View style={styles.summaryMiniBox}>
                <Text style={[styles.summaryMiniLabel, { color: colors.mutedForeground }]}>Refunded</Text>
                <Text style={[styles.summaryMiniValue, { color: colors.foreground }]}>{formatCurrency(totals?.refunded ?? 0)}</Text>
              </View>
            )}
          </View>
        </View>

        {!!party && (
          <Text style={[styles.metaLine, { color: colors.mutedForeground }]}>
            {party.repairCount} {party.repairCount === 1 ? 'job' : 'jobs'}
            {party.openRepairCount > 0 ? ` · ${party.openRepairCount} in progress` : ''}
            {' · '}{party.ownerName} · {party.ownerMobile}
          </Text>
        )}

        <View style={styles.activityList}>
          {entries.length > 0 ? (
            [...entries].reverse().map((entry) => {
              const effect = dealerEntryEffect(entry);
              const amountColor = effect === 'in' ? colors.success : effect === 'out' ? colors.destructive : colors.mutedForeground;
              const runningLabel = dealerBalanceLabel(direction, entry.runningBalance);
              return (
                <TouchableOpacity
                  key={entry.id}
                  activeOpacity={0.75}
                  onPress={() => openEntry(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`${DEALER_ENTRY_KIND_LABELS[entry.kind]} ${formatCurrency(entry.amount)} ${DEALER_DIRECTION_LABELS[entry.direction]}`}
                  style={[styles.entryRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.entryIcon, { backgroundColor: amountColor + '1A' }]}>
                    <Feather name={DEALER_ENTRY_KIND_ICONS[entry.kind]} size={16} color={amountColor} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.entryTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {DEALER_ENTRY_KIND_LABELS[entry.kind]}
                    </Text>
                    <Text style={[styles.entryMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {entry.transactionCode} · {entry.device}
                    </Text>
                    <Text style={[styles.entryMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {formatDateTime(entry.at)}
                      {entry.actorName ? ` · ${entry.actorName}` : ''}
                      {entry.method ? ` · ${entry.method}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text style={[styles.entryAmount, { color: amountColor }]}>
                      {effect === 'out' ? '−' : effect === 'in' ? '+' : ''}{formatCurrency(entry.amount)}
                    </Text>
                    <Text style={[styles.entryDirection, { color: amountColor }]}>{DEALER_DIRECTION_LABELS[entry.direction]}</Text>
                    <Text style={[styles.entryRunning, { color: colors.mutedForeground }]}>
                      Bal {formatCurrency(Math.abs(entry.runningBalance))}{runningLabel === 'Settled' ? '' : ` · ${runningLabel}`}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {party && party.openRepairCount > 0
                ? 'No bills yet — the bill posts when the repair is marked ready.'
                : 'No ledger entries yet'}
            </Text>
          )}
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
    paddingHorizontal: layout.screenPadding,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  iconBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  headerSubtitle: { ...font.caption },
  scroll: { padding: layout.screenPadding, paddingBottom: 40 },
  summaryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 10,
  },
  summaryBox: { flex: 1, gap: 2 },
  summaryLabel: { ...font.captionStrong },
  summaryValue: { ...font.heading },
  summaryDirection: { ...font.captionStrong },
  summaryDivider: { width: 1, height: '100%', marginHorizontal: 16 },
  summaryRow: { flex: 1.2, gap: 10 },
  summaryMiniBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryMiniLabel: { ...font.captionStrong },
  summaryMiniValue: { ...font.bodyStrong },
  metaLine: { ...font.caption, marginBottom: space.lg },
  activityList: { gap: 10 },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  entryIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  entryTitle: { ...font.bodyStrong },
  entryMeta: { ...font.caption },
  entryAmount: { ...font.bodyStrong },
  entryDirection: { ...font.captionStrong },
  entryRunning: { ...font.caption },
  emptyText: { ...font.body, textAlign: 'center', marginVertical: 40 },
});
