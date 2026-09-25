import React, { useMemo, useState } from 'react';
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCurrency } from '@/utils/helpers';
import { Avatar } from '@/components/ui/Avatar';
import { AvarpusLoadingScreen } from '@/components/ui/AvarpusSpinner';
import { DataErrorBanner, DataErrorState } from '@/components/ui/DataStates';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { useKhataLedger } from '@/hooks/useKhataLedger';
import { foldDealerEntriesIntoCustomers, groupLedgerByParty, type KhataPartyType } from '@/utils/khata-ledger';
import { CustomerFormSheet } from '@/components/forms/CustomerFormSheet';
import { useDealerTransactionsLedger, type DealerLedgerParty } from '@workspace/api-client-react';
import { dealerBalanceLabel } from '@/utils/dealer-ledger';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space, hitSlop } from '@/constants/spacing';

type FilterState = 'all' | KhataPartyType | 'supplier' | 'due' | 'today';

// One row in the overview list. Customers and B2B dealer records are local
// parties; `shop` rows are other Avarpus shops linked to us by real
// dealer-to-dealer transactions (one row per shop per direction).
type OverviewParty = {
  key: string;
  partyId: string;
  partyIds: string[];
  partyName: string;
  partyType: KhataPartyType | 'shop';
  /** Positive = they owe me; negative = I owe them. */
  balance: number;
  lastActivity: string;
  amountLabel: string;
  subtitle?: string;
  /** The person is a dealer: a dealer row, or a customer row that also carries dealer-posted repairs. */
  isDealer: boolean;
  shop?: DealerLedgerParty;
};

function RepairOnlyKhataScreen() {
  const { canAccess } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { repairs } = useData();
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const inProgress = repairs.filter((repair) => !['ready', 'delivered', 'cancelled'].includes(repair.status)).length;
  const completed = repairs.filter((repair) => ['ready', 'delivered'].includes(repair.status)).length;
  const items = [
    { label: 'All Repairs', value: repairs.length, icon: 'tool' as const, route: '/(tabs)/repairs' },
    { label: 'In Progress', value: inProgress, icon: 'clock' as const, route: '/(tabs)/repairs' },
    { label: 'Completed', value: completed, icon: 'check-circle' as const, route: '/(tabs)/repairs' },
    ...(canAccess('repairs_create')
      ? [{ label: 'Add Repair', value: 'New', icon: 'plus-circle' as const, route: '/(tabs)/repairs/new' }]
      : []),
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + space.lg }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Khata</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>Repair book</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { gap: space.md, paddingHorizontal: layout.screenPadding }]} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Repairs</Text>
        {items.map((item) => (
          <TouchableOpacity
            key={item.label}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.75}
            style={[styles.repairHubRow, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.repairHubIcon, { backgroundColor: colors.primary + '14' }]}>
              <Feather name={item.icon} size={19} color={colors.primary} />
            </View>
            <Text style={[styles.repairHubLabel, { color: colors.foreground }]}>{item.label}</Text>
            <Text style={[styles.repairHubValue, { color: colors.primary }]}>{item.value}</Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function FullKhataOverviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ledger, totals, isLoading, error, reload } = useKhataLedger();
  const { customers, loadAll } = useData();
  const dealerLedger = useDealerTransactionsLedger();
  const shopParties: DealerLedgerParty[] = dealerLedger.data?.parties ?? [];
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterState>('all');
  const [showSearch, setShowSearch] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([reload(), loadAll(), dealerLedger.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  // A person who is both a customer record and a dealer record is one party.
  // Dealer-posted repairs that are linked to a customer record are already in
  // that customer's server-computed due (and on the customer's khata page), so
  // they are shown inside the customer's row; only dealer entries no customer
  // record carries get a row of their own. Nothing is listed or added twice.
  const { customerActivity, foldedDealers, dealerParties } = useMemo(() => {
    const customerIds = new Set(customers.map((customer) => customer.id));
    const { folded, unlinked } = foldDealerEntriesIntoCustomers(ledger, customerIds);
    const activity = new Map(
      groupLedgerByParty(ledger.filter((entry) => entry.partyType === 'customer'))
        .map((party) => [party.partyId, party.lastActivity]),
    );
    return { customerActivity: activity, foldedDealers: folded, dealerParties: groupLedgerByParty(unlinked) };
  }, [customers, ledger]);

  const visibleParties = useMemo(() => {
    const dueLabel = (balance: number) => (balance > 0 ? 'Due' : balance < 0 ? 'Advance' : 'Settled');
    const latest = (...dates: Array<string | undefined>) =>
      dates.reduce<string>((newest, date) => (date && date > newest ? date : newest), '');
    let result: OverviewParty[] = [
      ...customers.map((customer): OverviewParty => {
        const dealerActivity = foldedDealers.get(customer.id);
        return {
          key: `customer:${customer.id}`,
          partyId: customer.id,
          partyIds: [customer.id],
          partyName: customer.name,
          partyType: 'customer',
          balance: customer.dueAmount,
          lastActivity:
            latest(customerActivity.get(customer.id), dealerActivity?.lastActivity) || customer.createdAt,
          amountLabel: dueLabel(customer.dueAmount),
          subtitle: dealerActivity ? 'Dealer' : undefined,
          isDealer: !!dealerActivity,
        };
      }),
      ...dealerParties.map((party): OverviewParty => ({
        key: `dealer:${party.partyId}`,
        partyId: party.partyId,
        partyIds: party.partyIds,
        partyName: party.partyName,
        partyType: 'dealer',
        balance: party.balance,
        lastActivity: party.lastActivity,
        amountLabel: dueLabel(party.balance),
        subtitle: 'Dealer',
        isDealer: true,
      })),
      ...shopParties.map((shop): OverviewParty => {
        // Normalise to "positive = they owe me" so sorting and the Pending
        // filter treat both directions consistently.
        const signed = shop.direction === 'payable' ? -shop.balance : shop.balance;
        return {
          key: `shop:${shop.direction}:${shop.shopId}`,
          partyId: shop.shopId,
          partyIds: [shop.shopId],
          partyName: shop.businessName,
          partyType: 'shop',
          balance: signed,
          lastActivity: shop.lastActivityAt,
          amountLabel: dealerBalanceLabel(shop.direction, shop.balance),
          subtitle: shop.direction === 'payable' ? 'Supplier · repairs your devices' : 'Dealer shop · you repair theirs',
          isDealer: false,
          shop,
        };
      }),
    ];
    if (filter === 'customer') result = result.filter(p => p.partyType === 'customer');
    else if (filter === 'dealer') result = result.filter(p => p.isDealer || (p.partyType === 'shop' && p.shop?.direction === 'receivable'));
    else if (filter === 'supplier') result = result.filter(p => p.partyType === 'shop' && p.shop?.direction === 'payable');
    else if (filter === 'due') result = result.filter(p => p.balance !== 0);
    else if (filter === 'today') {
      const todayString = new Date().toDateString();
      result = result.filter(p => p.balance !== 0 && new Date(p.lastActivity).toDateString() === todayString);
    }

    const query = search.trim().toLowerCase();
    if (query) {
      result = result.filter((p) => p.partyName.toLowerCase().includes(query));
    }

    // Sort by outstanding amount (largest first, either direction), then by newest activity
    return result.sort((a, b) => {
      const da = Math.abs(a.balance), db = Math.abs(b.balance);
      if (db !== da) return db - da;
      return b.lastActivity.localeCompare(a.lastActivity);
    });
  }, [customers, customerActivity, foldedDealers, dealerParties, shopParties, filter, search]);

  // Each due is counted once: customer records (which already include the
  // dealer-posted repairs linked to them), dealer entries no customer record
  // carries, and other shops' dealer-to-dealer balances.
  const receivableTotal = useMemo(() => {
    const dealerBalances = dealerParties.reduce((sum, party) => sum + Math.max(party.balance, 0), 0);
    const local = customers.reduce((sum, customer) => sum + Math.max(customer.dueAmount, 0), dealerBalances);
    return local + (dealerLedger.data?.totals.receivable ?? 0);
  }, [customers, dealerParties, dealerLedger.data]);

  // What I still owe other shops for repairing my devices.
  const payableTotal = dealerLedger.data?.totals.payable ?? 0;

  const openParty = (party: OverviewParty) => {
    if (party.partyType === 'shop' && party.shop) {
      router.push({
        pathname: '/(tabs)/khata/dealer/[shopId]',
        params: { shopId: party.shop.shopId, direction: party.shop.direction, name: party.shop.businessName },
      } as any);
      return;
    }
    const mergedIds =
      party.partyType === 'dealer' && party.partyIds.length > 1
        ? `&ids=${encodeURIComponent(party.partyIds.join(','))}`
        : '';
    router.push(
      `/(tabs)/khata/party/${party.partyType}/${party.partyId}?name=${encodeURIComponent(party.partyName)}${mergedIds}`,
    );
  };

  const formatDateLabel = (isoDate: string) => {
    const d = new Date(isoDate);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return `Today`;
    }
    return d.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short'
    });
  };

  if (isLoading && ledger.length === 0) {
    return <AvarpusLoadingScreen background={colors.background} size={40} />;
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
      <View style={[styles.header, { paddingTop: topPadding + space.lg }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/(tabs)/more')}>
          <Feather name="menu" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: space.lg }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Shop Khata</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>Ledger Book</Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setShowSearch((visible) => !visible)}
          accessibilityLabel="Search Khata"
        >
          <Feather name="search" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {showSearch && (
        <View style={styles.searchContainer}>
          <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={size.headerIcon} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search customer or supplier..."
              placeholderTextColor={colors.placeholder}
              style={[styles.searchInput, { color: colors.foreground }]}
              autoFocus
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search">
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {(!!error || !!dealerLedger.error) && <DataErrorBanner onRetry={onRefresh} />}

        {/* Balance summary: payable on the left, receivable on the right, in
            the same red/green language as the rows below (red = owed to me). */}
        <View
          style={[styles.netBalanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityRole="summary"
        >
          <View style={styles.netBalanceCell}>
            <View style={styles.netBalanceHeader}>
              <View style={[styles.netBalanceMark, { backgroundColor: colors.successLight }]}>
                <Feather name="arrow-up-right" size={size.eyebrowIcon} color={colors.success} />
              </View>
              <Text style={[styles.netBalanceLabel, { color: colors.mutedForeground }]}>To pay</Text>
            </View>
            <Text style={[styles.netBalanceValue, { color: colors.success }]}>{formatCurrency(payableTotal)}</Text>
            <Text style={[styles.netBalanceHint, { color: colors.mutedForeground }]} numberOfLines={1}>
              Owed to suppliers
            </Text>
          </View>
          <View style={[styles.netBalanceDivider, { backgroundColor: colors.border }]} />
          <View style={styles.netBalanceCell}>
            <View style={styles.netBalanceHeader}>
              <View style={[styles.netBalanceMark, { backgroundColor: colors.redSoft }]}>
                <Feather name="arrow-down-left" size={size.eyebrowIcon} color={colors.destructive} />
              </View>
              <Text style={[styles.netBalanceLabel, { color: colors.mutedForeground }]}>To receive</Text>
            </View>
            <Text style={[styles.netBalanceValue, { color: colors.destructive }]}>{formatCurrency(receivableTotal)}</Text>
            <Text style={[styles.netBalanceHint, { color: colors.mutedForeground }]} numberOfLines={1}>
              Customer & dealer dues
            </Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {(['all', 'customer', 'dealer', 'supplier', 'due', 'today'] as const).map((value) => {
            const active = filter === value;
            const labels: Record<string, string> = { all: 'All', customer: 'Customers', dealer: 'Dealers', supplier: 'Suppliers', due: 'Pending', today: 'Due Today' };
            return (
              <TouchableOpacity hitSlop={hitSlop.chip}
                key={value}
                onPress={() => setFilter(value)}
                style={[styles.filterChip, { backgroundColor: active ? colors.primary + '15' : colors.card, borderColor: active ? colors.primary : colors.border }]}
              >
                <Text style={{ color: active ? colors.primary : colors.mutedForeground, ...font.label, fontFamily: active ? fontFamily.semibold : fontFamily.medium }}>
                  {labels[value]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.partyList}>
          {visibleParties.length > 0 ? (
            visibleParties.map((party) => (
              <TouchableOpacity
                key={party.key}
                activeOpacity={0.7}
                onPress={() => openParty(party)}
                style={[styles.partyRow, { borderBottomColor: colors.border }]}
              >
                <Avatar name={party.partyName} size={size.avatar} />
                <View style={styles.partyInfo}>
                  <Text style={[styles.partyName, { color: colors.foreground }]} numberOfLines={1}>
                    {party.partyName}
                  </Text>
                  <Text style={[styles.partyDate, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {party.subtitle ? `${party.subtitle} · ` : ''}{formatDateLabel(party.lastActivity)}
                  </Text>
                </View>
                <View style={styles.partyAmountBox}>
                  {party.balance > 0 ? (
                    <Text style={[styles.partyAmount, { color: colors.destructive }]}>
                      {formatCurrency(party.balance)}
                    </Text>
                  ) : party.balance < 0 ? (
                    <Text style={[styles.partyAmount, { color: colors.success }]}>
                      {formatCurrency(Math.abs(party.balance))}
                    </Text>
                  ) : (
                    <Text style={[styles.partyAmount, { color: colors.mutedForeground }]}>
                      {formatCurrency(0)}
                    </Text>
                  )}
                  <Text style={[styles.partyDueLabel, { color: colors.mutedForeground }]}>
                    {party.amountLabel}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {search ? 'No matches found' : 'No ledger entries'}
            </Text>
          )}
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => setShowAddCustomer(true)}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel="Add customer"
      >
        <Feather name="user-plus" size={size.fabIconSm} color={colors.primaryForeground} />
      </TouchableOpacity>

      <CustomerFormSheet visible={showAddCustomer} onClose={() => setShowAddCustomer(false)} />
    </View>
  );
}

export default function KhataOverviewScreen() {
  const { canAccess } = useAuth();
  return canAccess('payments') ? <FullKhataOverviewScreen /> : <RepairOnlyKhataScreen />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.headerHeight,
    paddingLeft: layout.listInset,
    paddingRight: space.xs,
  },
  iconBtn: {
    width: size.iconButton, height: size.iconButton,
    alignItems: 'center', justifyContent: 'center',
  },
  searchContainer: {
    marginLeft: layout.listInset,
    marginRight: layout.screenPadding,
    marginTop: layout.headerGap,
    marginBottom: layout.searchGap,
  },
  searchBox: {
    minHeight: size.searchField,
    borderWidth: 1,
    borderRadius: size.searchRadius,
    paddingLeft: size.searchPadding,
    paddingRight: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: size.searchGap,
  },
  searchInput: { flex: 1, ...font.search, paddingVertical: 0 },
  filterScroll: {
    paddingHorizontal: layout.screenPadding,
    gap: space.sm,
    marginBottom: space.lg,
  },
  filterChip: {
    minHeight: size.chip,
    borderWidth: 1,
    borderRadius: size.chip / 2,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
  },
  headerTitle: { ...font.display },
  headerSubtitle: { ...font.caption, marginTop: space.xs },
  scroll: { paddingBottom: 100 },
  sectionTitle: { ...font.heading, marginBottom: space.md, marginHorizontal: layout.screenPadding },

  // Compact two-column statement: eyebrow label, amount, one-line meaning.
  netBalanceCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginHorizontal: layout.screenPadding,
    marginBottom: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  netBalanceCell: {
    flex: 1,
    paddingHorizontal: space.lg,
    gap: space.xs,
  },
  netBalanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  netBalanceMark: {
    width: size.eyebrowMark,
    height: size.eyebrowMark,
    borderRadius: size.eyebrowMark / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  netBalanceLabel: { ...font.overline },
  netBalanceValue: { ...font.heading },
  netBalanceHint: { ...font.small },
  netBalanceDivider: { width: StyleSheet.hairlineWidth },

  partyList: { paddingBottom: size.fab + space.xxxl },
  partyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: layout.rowPaddingVertical,
    paddingLeft: layout.listInset,
    paddingRight: layout.listInsetEnd,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: layout.avatarGap,
  },
  partyInfo: { flex: 1, justifyContent: 'center' },
  partyName: { ...font.itemTitle, marginBottom: space.xs },
  partyDate: { ...font.caption },
  partyAmountBox: { alignItems: 'flex-end', justifyContent: 'center' },
  partyAmount: { ...font.bodyStrong, marginBottom: space.xs },
  partyDueLabel: { ...font.captionStrong },

  emptyText: { ...font.body, textAlign: 'center', marginTop: 40 },
  
  // Icon-only compact floating button (48dp keeps the 44dp touch minimum).
  fab: {
    position: 'absolute',
    right: layout.listInsetEnd,
    bottom: space.lg,
    width: size.fabSm,
    height: size.fabSm,
    borderRadius: size.fabRadius,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },

  repairHubRow: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: layout.screenPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  repairHubIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repairHubLabel: { flex: 1, ...font.bodyStrong },
  repairHubValue: { ...font.captionStrong },
});