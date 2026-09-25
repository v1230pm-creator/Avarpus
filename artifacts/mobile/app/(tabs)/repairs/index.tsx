import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useAuthToken } from '@/hooks/useAuthToken';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space, hitSlop } from '@/constants/spacing';
import { RepairStatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { FlatCard } from '@/components/ui/FlatCard';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { Avatar } from '@/components/ui/Avatar';
import { DevicePlaceholderPhoto } from '@/components/ui/DevicePlaceholderPhoto';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PhotoViewerModal, type ViewerPhoto } from '@/components/ui/PhotoViewerModal';
import { Repair, isDealerPortalRole, isLinkedCustomerPortalUser } from '@/types';
import { formatDate, formatCurrency, getReturnStatusColor } from '@/utils/helpers';
import { storageUrlFor } from '@/utils/storageUrl';
import * as Network from 'expo-network';
import { offlineQueue, QueuedRepair } from '@/utils/offlineQueue';
import { useQueryClient } from '@tanstack/react-query';

import { useReturnsList, useRepairsList, getRepairsListQueryKey, useDealersList, useDealersMe, useDealersOverview, useCustomersKhataGet, useDealersSuppliersList } from '@workspace/api-client-react';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

// The four summary tiles double as the status filter; "All" is the default and
// means no tile is selected.
const FILTERS = ['All', 'Received', 'Repair', 'Ready', 'Delivered'] as const;
type Filter = (typeof FILTERS)[number];
// Dealer-portal accounts see a simplified read-only view of their own repairs.
const PORTAL_FILTERS = ['All', 'Received', 'Repair', 'Ready', 'Delivered'] as const;
// Dealers and After-Sales Service used to be extra filter tabs; they are now
// modes reached from the header's options sheet.
type Mode = 'repairs' | 'dealers' | 'returns';

const REPAIR_STAGE_STATUSES = 'diagnosing,waiting_parts,repairing,testing,customer_approval,cannot_repair';
const OPEN_AND_DELIVERED_STATUSES = `received,${REPAIR_STAGE_STATUSES},ready,delivered`;

const SUMMARY_TILES: Array<{ filter: Exclude<Filter, 'All'>; label: string; icon: FeatherName; status: string }> = [
  { filter: 'Received', label: 'Received', icon: 'file-text', status: 'received' },
  { filter: 'Repair', label: 'Repair', icon: 'tool', status: REPAIR_STAGE_STATUSES },
  { filter: 'Ready', label: 'Ready', icon: 'check-circle', status: 'ready' },
  { filter: 'Delivered', label: 'Delivered', icon: 'box', status: 'delivered' },
];

function transferBadge(repair: Repair, colors: ReturnType<typeof useColors>) {
  const t = repair.transfer;
  if (!t) return null;
  const who = t.receiverBusinessName || t.receiverOwnerName || 'the dealer';
  if (t.status === 'pending') return { icon: 'clock' as const, color: colors.warning, label: `Waiting for ${who} to accept` };
  if (t.status === 'accepted') {
    const live = t.resultStatus ? ` · ${t.resultStatus.replace(/_/g, ' ')}` : '';
    return { icon: 'check-circle' as const, color: colors.success, label: `Accepted by ${who}${live}` };
  }
  if (t.status === 'declined') return { icon: 'x-circle' as const, color: colors.destructive, label: `Declined by ${who} · you can send again` };
  return null;
}

function RepairCard({ repair, token, retryKey, onPress, onSendToDealer, onViewPhoto }: {
  repair: Repair;
  /** Bearer token for the cover photo request; the thumbnail waits for it. */
  token: string | null;
  /** Changes whenever the list refetches; a cover that failed to load is retried once per change. */
  retryKey: number;
  onPress: () => void;
  /** Offers the device to another dealer; present only while the action is allowed (the ⋮ button then shows). */
  onSendToDealer?: () => void;
  onViewPhoto: (photo: ViewerPhoto) => void;
}) {
  const colors = useColors();
  const badge = transferBadge(repair, colors);
  const cover = repair.coverPhoto ?? null;
  // A cover that fails to load (missing object, offline, expired session) falls
  // back to the placeholder instead of leaving an empty frame in the photo
  // column; the next list refetch retries it, so a transient failure never
  // hides a valid photo for the rest of the screen's life.
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const coverAttempt = cover ? `${retryKey}:${cover.objectPath}` : null;
  const showCover = !!cover && !!token && failedCover !== coverAttempt;
  const total = repair.totalAmount ?? repair.repairCharge + repair.partsCharge;
  const paid = repair.paidAmount ?? repair.advance ?? 0;
  const rawBalance = repair.balance ?? total - paid;
  // Due stays red only while money is pending; a settled row shows "Due: ₹0" in gray.
  const balanceLabel = rawBalance < 0 ? 'Advance' : 'Due';
  const balanceColor = rawBalance > 0 ? colors.destructive : rawBalance < 0 ? colors.success : colors.mutedForeground;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      testID={`repair-card-${repair.id}`}
    >
      <View style={[styles.repairCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Device thumbnail: the repair's front photo (else its first upload) — tap to view it
            full screen; a repair without photos shows a stand-in device picture and the tap
            opens the repair like the rest of the card. */}
        {showCover ? (
          <TouchableOpacity
            onPress={() => onViewPhoto({ uri: storageUrlFor(cover.objectPath), label: cover.kind.replace(/_/g, ' ') })}
            activeOpacity={0.8}
            accessibilityRole="imagebutton"
            accessibilityLabel={`View photo of ${repair.repairId}`}
            testID={`repair-cover-${repair.id}`}
            style={[styles.thumb, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
          >
            <Image
              source={{ uri: storageUrlFor(cover.objectPath), headers: { Authorization: `Bearer ${token}` } }}
              style={styles.thumbImage}
              contentFit="cover"
              transition={120}
              onError={() => setFailedCover(coverAttempt)}
            />
          </TouchableOpacity>
        ) : (
          <View
            style={[styles.thumb, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
            testID={`repair-cover-placeholder-${repair.id}`}
          >
            <DevicePlaceholderPhoto deviceType={repair.deviceType} />
          </View>
        )}

        <View style={styles.cardBody}>
          <Text style={[styles.ticket, { color: colors.foreground }]} numberOfLines={1}>{repair.repairId}</Text>
          <Text style={[styles.cardLine, { color: colors.foreground }]} numberOfLines={1}>{repair.problem}</Text>
          <Text style={[styles.cardLine, { color: colors.mutedForeground }]} numberOfLines={1}>
            {repair.deviceType} • {repair.brand} {repair.model}
          </Text>
          <Text style={[styles.cardLine, { color: colors.mutedForeground }]} numberOfLines={1}>{repair.customerName}</Text>
          {!!repair.sourceDealerBusinessName && (
            <View style={styles.inlineNote}>
              <Feather name="briefcase" size={11} color={colors.primary} />
              <Text style={{ ...font.captionStrong, color: colors.primary, flexShrink: 1 }} numberOfLines={1}>
                Received from {repair.sourceDealerBusinessName}
                {repair.sourceRepairTicket ? ` · ${repair.sourceRepairTicket}` : ''}
              </Text>
            </View>
          )}
          {!!badge && (
            <View style={styles.inlineNote} testID={`repair-transfer-badge-${repair.id}`}>
              <Feather name={badge.icon} size={11} color={badge.color} />
              <Text style={{ ...font.captionStrong, color: badge.color, flexShrink: 1 }} numberOfLines={1}>
                {badge.label}
              </Text>
            </View>
          )}
          <Text style={[styles.cardLine, { color: colors.mutedForeground }]}>{formatDate(repair.createdAt)}</Text>
        </View>

        <View style={styles.cardAside}>
          {/* The pill keeps clear of the ⋮ corner; the money lines may use the full column. */}
          <View style={styles.cardAsideTop}>
            <RepairStatusBadge status={repair.status} compact />
          </View>
          <View style={styles.money}>
            <Text style={[styles.price, { color: colors.success }]}>{formatCurrency(total)}</Text>
            <Text style={[styles.paid, { color: colors.mutedForeground }]}>Paid / Deposit: {formatCurrency(paid)}</Text>
            <Text style={[styles.due, { color: balanceColor }]}>
              {balanceLabel}: {formatCurrency(Math.abs(rawBalance))}
            </Text>
          </View>
        </View>

        {onSendToDealer && (
          <TouchableOpacity
            onPress={onSendToDealer}
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${repair.repairId}`}
            accessibilityHint="Send this device to another dealer"
            testID={`repair-menu-${repair.id}`}
            style={styles.menuButton}
          >
            <Feather name="more-vertical" size={size.inlineIcon + 2} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

function SummaryTile({
  label, count, icon, color, active, onPress,
}: { label: string; count: number | undefined; icon: FeatherName; color: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={active ? { selected: true } : {}}
      accessibilityLabel={`${label}${count === undefined ? '' : `, ${count}`}`}
      testID={`repairs-summary-${label.toLowerCase()}`}
      style={[styles.tile, { backgroundColor: `${color}24`, borderColor: active ? color : 'transparent' }]}
    >
      <View style={styles.tileTop}>
        <View style={[styles.tileIcon, { backgroundColor: `${color}3D` }]}>
          <Feather name={icon} size={size.statIcon} color={color} />
        </View>
        <Text style={[styles.tileCount, { color }]}>{count === undefined ? '–' : count}</Text>
      </View>
      <Text style={[styles.tileLabel, { color: colors.foreground }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function HeaderCircleButton({ icon, onPress, label, testID }: { icon: FeatherName; onPress: () => void; label: string; testID?: string }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={[styles.circleButton, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Feather name={icon} size={size.headerIcon} color={colors.foreground} />
    </TouchableOpacity>
  );
}

interface SheetOption {
  key: string;
  icon: FeatherName;
  color: string;
  title: string;
  detail: string;
  onPress: () => void;
  testID?: string;
}

/** Slide-up list behind the header gear: everything that used to be a filter tab or an entry card. */
function OptionsSheet({ visible, onClose, options }: { visible: boolean; onClose: () => void; options: SheetOption[] }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close options" />
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Repairs</Text>
            <TouchableOpacity onPress={onClose} style={styles.sheetClose} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={size.headerIcon} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <View style={[styles.sheetList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {options.map((option, index) => (
              <TouchableOpacity
                key={option.key}
                onPress={() => { onClose(); option.onPress(); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={option.title}
                testID={option.testID}
                style={[styles.sheetRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
              >
                <View style={[styles.sheetRowIcon, { backgroundColor: `${option.color}1A` }]}>
                  <Feather name={option.icon} size={size.statIcon} color={option.color} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...font.itemTitle, color: colors.foreground }} numberOfLines={1}>{option.title}</Text>
                  <Text style={{ ...font.caption, color: colors.mutedForeground }} numberOfLines={1}>{option.detail}</Text>
                </View>
                <Feather name="chevron-right" size={size.inlineIcon + 2} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function RepairsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { canAccess, user } = useAuth();
  const isDealerPortal = isDealerPortalRole(user?.role);
  const isCustomerPortal = isLinkedCustomerPortalUser(user);
  const isPortal = isDealerPortal || isCustomerPortal;
  const isOwner = user?.role === 'dealer' || user?.role === 'super_admin';
  const { confirm } = useConfirmDialog();
  // Cover photos are fetched straight from the storage route, so the cards
  // need the bearer token; the tapped one opens in the shared viewer.
  const token = useAuthToken();
  const [viewerPhoto, setViewerPhoto] = useState<ViewerPhoto | null>(null);
  // "Send to Dealer" is a staff action on the shop's own open repairs: never
  // for portal viewers, never without the repairs_update toggle, never on a
  // row already waiting for (or held by) another dealer, never on closed rows.
  const canSendToDealer = !isPortal && canAccess('repairs_update');
  const sendToDealerFor = (repair: Repair): (() => void) | undefined => {
    if (!canSendToDealer) return undefined;
    if (repair.status === 'delivered' || repair.status === 'cancelled') return undefined;
    const t = repair.transfer;
    if (t?.status === 'pending') return undefined;
    if (t?.status === 'accepted' && t.resultStatus && !['delivered', 'cancelled'].includes(t.resultStatus)) return undefined;
    return () => {
      confirm({
        title: 'Send to Dealer',
        message: `${repair.repairId} · ${repair.brand} ${repair.model}`,
        caption: 'The other dealer must accept before it appears in their queue. Your record stays unchanged.',
        icon: 'send',
        actions: [
          {
            label: 'Choose dealer',
            description: 'Search by name, shop, mobile or Dealer ID',
            icon: 'search',
            tone: 'neutral',
            onPress: () => {
              router.push({ pathname: '/(tabs)/repairs/dealer-transactions/send', params: { repairId: repair.id } } as any);
            },
          },
        ],
      });
    };
  };
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [mode, setMode] = useState<Mode>('repairs');
  const [menuOpen, setMenuOpen] = useState(false);
  const [portalFilter, setPortalFilter] = useState<(typeof PORTAL_FILTERS)[number]>('All');
  const [showCancelled, setShowCancelled] = useState(false);
  // Technicians now see the full shop list by default; "Assigned to me only"
  // stays available as an optional filter.
  const [techOnly, setTechOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [accumulatedRepairs, setAccumulatedRepairs] = useState<Repair[]>([]);

  const queryClient = useQueryClient();
  const [offlineItems, setOfflineItems] = useState<QueuedRepair[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  const loadOfflineQueue = async () => {
    const q = await offlineQueue.getQueue();
    setOfflineItems(q);
  };

  const handleSync = async () => {
    if (isSyncing || offlineItems.length === 0) return;
    const net = await Network.getNetworkStateAsync();
    if (!net.isConnected) return;

    setIsSyncing(true);
    const { success, failed } = await offlineQueue.flush();
    setIsSyncing(false);
    await loadOfflineQueue();
    if (success > 0) {
      setPage(1);
      queryClient.invalidateQueries();
    }
  };

  React.useEffect(() => {
    loadOfflineQueue();
    Network.getNetworkStateAsync().then(state => setIsConnected(!!state.isConnected));
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    setPage(1);
  }, [filter, mode, portalFilter, debouncedSearch, showCancelled, techOnly]);

  const { data: returnsData, isLoading: returnsLoading, error: returnsError, refetch: returnsRefetch } = useReturnsList({ query: { enabled: !isPortal } } as any);

  // Dealer directory (staff view) — live counts per dealer.
  const dealersParams: any = { q: debouncedSearch || undefined };
  const { data: dealersData, isLoading: dealersLoading, error: dealersError, refetch: dealersRefetch, isFetching: dealersFetching } =
    useDealersList(dealersParams, { query: { enabled: !isPortal && mode === 'dealers' } } as any);

  // Admin overview stats across all dealer repairs (owner only).
  const { data: overviewData } = useDealersOverview({ query: { enabled: !isPortal && mode === 'dealers' && isOwner } } as any);

  // Dealer-portal: own dealer profile + stats.
  const { data: myDealer } = useDealersMe({ query: { enabled: isDealerPortal } } as any);
  // Business accounts: other shops that file this person as THEIR dealer.
  const { data: suppliersData } = useDealersSuppliersList({ query: { enabled: !isPortal } } as any);
  const supplierLinks = suppliersData?.suppliers ?? [];
  const { data: myKhata } = useCustomersKhataGet('me', { query: { enabled: isCustomerPortal } } as any);

  const techFilterActive = user?.role === 'technician' && techOnly;

  const getStatusQuery = () => {
    if (isPortal) {
      if (portalFilter === 'Received') return 'received';
      if (portalFilter === 'Repair') return REPAIR_STAGE_STATUSES;
      if (portalFilter === 'Ready') return 'ready';
      if (portalFilter === 'Delivered') return 'delivered';
      return undefined;
    }
    if (filter === 'Received') return 'received';
    if (filter === 'Repair') return REPAIR_STAGE_STATUSES;
    if (filter === 'Ready') return 'ready';
    if (filter === 'Delivered') return showCancelled ? 'delivered,cancelled' : 'delivered';
    // "All" lists every stage; cancelled rows stay out unless asked for.
    return showCancelled ? `${OPEN_AND_DELIVERED_STATUSES},cancelled` : OPEN_AND_DELIVERED_STATUSES;
  };

  const repairsParams: any = {
    q: debouncedSearch || undefined,
    status: getStatusQuery(),
    page,
    limit: 20,
  };

  if (techFilterActive) {
    repairsParams.technicianId = 'me';
  }

  const {
    data: repairsData,
    dataUpdatedAt: repairsUpdatedAt,
    isLoading: repairsLoading,
    error: repairsError,
    refetch: repairsRefetch,
    isFetching: repairsFetching
  } = useRepairsList(repairsParams, {
    query: {
      enabled: isPortal || mode === 'repairs',
      queryKey: getRepairsListQueryKey(repairsParams)
    }
  });

  // Summary tile counts: one lightweight page-1/limit-1 list per status group
  // (the list endpoint is the only source of per-status totals). They follow
  // the technician's "assigned to me" toggle but not the search box, run only
  // while the tiles are on screen, and stay fresh for a minute across
  // remounts; any repairs-list invalidation still refreshes them.
  const countParams = SUMMARY_TILES.map((tile) => {
    const params: any = { status: tile.status, page: 1, limit: 1 };
    if (techFilterActive) params.technicianId = 'me';
    return params;
  });
  const countOptions = (params: any) => ({
    query: { enabled: !isPortal && mode === 'repairs', staleTime: 60_000, queryKey: getRepairsListQueryKey(params) },
  });
  const receivedCount = useRepairsList(countParams[0], countOptions(countParams[0]));
  const repairCount = useRepairsList(countParams[1], countOptions(countParams[1]));
  const readyCount = useRepairsList(countParams[2], countOptions(countParams[2]));
  const deliveredCount = useRepairsList(countParams[3], countOptions(countParams[3]));
  const countQueries = [receivedCount, repairCount, readyCount, deliveredCount];

  const searchBusy =
    (mode === 'dealers' ? dealersFetching : repairsFetching) && search.trim().length > 0;

  React.useEffect(() => {
    if (repairsData?.repairs) {
      if (page === 1) setAccumulatedRepairs(repairsData.repairs as Repair[]);
      else setAccumulatedRepairs(prev => {
        const newItems = (repairsData.repairs as Repair[]).filter(r => !prev.find(p => p.id === r.id));
        return [...prev, ...newItems];
      });
    }
  }, [repairsData, page]);

  const onRefresh = async () => {
    if (isPortal) await repairsRefetch();
    else if (mode === 'returns') await returnsRefetch();
    else if (mode === 'dealers') await dealersRefetch();
    else await Promise.all([repairsRefetch(), ...countQueries.map((q) => q.refetch())]);
  };

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const filteredReturns = useMemo(() => {
    if (mode !== 'returns') return [];
    let list = returnsData?.returns || [];
    // Technicians see the full after-sales list (same view as reception).

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.customerName?.toLowerCase().includes(q) ||
        r.returnId.toLowerCase().includes(q) ||
        r.repairTicket?.toLowerCase().includes(q) ||
        r.brand?.toLowerCase().includes(q) ||
        r.model?.toLowerCase().includes(q) ||
        r.mobile?.includes(q) ||
        r.imei?.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [returnsData, mode, search, user]);

  // Create button follows the owner-configured repairs_create toggle.
  const canCreateRepair = !isPortal && canAccess('repairs_create');

  const headerAnims = useStaggerAnim(3);

  const dealers = dealersData?.dealers || [];

  const totalCount = isPortal
    ? repairsData?.total || 0
    : mode === 'returns' ? filteredReturns.length
    : mode === 'dealers' ? dealers.length
    : repairsData?.total || 0;
  const isGlobalLoading = isPortal ? repairsLoading : mode === 'returns' ? returnsLoading : mode === 'dealers' ? dealersLoading : repairsLoading;
  const isGlobalError = isPortal ? repairsError : mode === 'returns' ? returnsError : mode === 'dealers' ? dealersError : repairsError;

  // Header copy. Business accounts see their shop's name; portal viewers keep
  // "My Repairs" with the party they belong to.
  const title = isPortal ? 'My Repairs' : (user?.businessName || 'Repairs').toUpperCase();
  const subtitle = isPortal
    ? (isDealerPortal && myDealer?.dealer ? `${myDealer.dealer.dealerCode} · ${myDealer.dealer.name}` : `${totalCount} jobs`)
    : mode === 'dealers' ? `Dealers · ${totalCount}`
    : mode === 'returns' ? `After-Sales Service · ${totalCount}`
    : 'All Repairs';

  // The Shop tab opens this screen directly, so leaving the Repairs root
  // returns to Chats, where the main footer (Chats / Status / Shop / Calls)
  // takes over again.
  const exitWorkspace = () => router.navigate('/(tabs)');

  const sheetOptions: SheetOption[] = [
    { key: 'scan', icon: 'maximize', color: colors.primary, title: 'Scan QR', detail: 'Open a repair from its ticket code', onPress: () => router.push('/(tabs)/repairs/scanner') },
    { key: 'dealers', icon: 'briefcase', color: colors.primary, title: 'Dealers', detail: 'B2B dealers and their bulk repairs', testID: 'dealers-mode-entry', onPress: () => setMode('dealers') },
    { key: 'returns', icon: 'corner-up-left', color: colors.warning, title: 'After-Sales Service', detail: 'Return cases and warranty claims', testID: 'returns-mode-entry', onPress: () => setMode('returns') },
    { key: 'transactions', icon: 'repeat', color: colors.primary, title: 'Dealer Transactions', detail: 'Devices sent to and received from other shops', testID: 'dealer-transactions-entry', onPress: () => router.push('/(tabs)/repairs/dealer-transactions') },
    ...(supplierLinks.length > 0 ? [{
      key: 'suppliers',
      icon: 'truck' as const,
      color: colors.info,
      title: `My repairs at ${supplierLinks.length === 1 ? supplierLinks[0].supplier.businessName : `${supplierLinks.length} supplier shops`}`,
      detail: (() => {
        const inProgress = supplierLinks.reduce((n, link) => n + link.stats.received + link.stats.repairing, 0);
        const ready = supplierLinks.reduce((n, link) => n + link.stats.ready, 0);
        return `${inProgress} in progress · ${ready} ready to collect`;
      })(),
      testID: 'supplier-repairs-entry',
      onPress: () => router.push('/(tabs)/repairs/suppliers'),
    }] : []),
    { key: 'settings', icon: 'settings', color: colors.mutedForeground, title: 'Business settings', detail: 'Staff, permissions and shop details', onPress: () => router.push({ pathname: '/(tabs)/more', params: { scope: 'business' } }) },
  ];

  const showNewRepairFab = canCreateRepair && (mode === 'returns' || (mode === 'repairs' && (filter === 'All' || filter === 'Received')));
  const showNewDealerFab = canCreateRepair && mode === 'dealers';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <FadeInView animValue={headerAnims[0]} style={[styles.header, { paddingTop: topPad }]}>
        <View style={styles.headerRow}>
          {!isPortal && (
            <HeaderCircleButton icon="arrow-left" label="Back" testID="repairs-back" onPress={exitWorkspace} />
          )}
          <View style={styles.headerText}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]} numberOfLines={1}>{subtitle}</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/more')}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
            style={[styles.circleButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Avatar name={user?.name ?? 'User'} size={size.avatarSm} url={user?.profilePhoto} />
            <View style={[styles.avatarBadge, { backgroundColor: colors.card }]}>
              <Feather name="menu" size={10} color={colors.primary} />
            </View>
          </TouchableOpacity>
          {!isPortal && (
            <HeaderCircleButton icon="settings" label="Repairs options" testID="repairs-options" onPress={() => setMenuOpen(true)} />
          )}
        </View>

        {/* Search */}
        <FlatCard style={styles.searchBar}>
          <Feather name="search" size={size.headerIcon} color={colors.mutedForeground} />
          <View style={{ width: 16, alignItems: 'center' }}>
            {searchBusy ? <AvarpusSpinner size={14} /> : null}
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search tickets, names, mobile..."
            placeholderTextColor={colors.placeholder}
            style={[styles.searchInput, { color: colors.foreground, fontFamily: fontFamily.regular }]}
          />
          {!!search && (
            <TouchableOpacity
              onPress={() => setSearch('')}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={size.inlineIcon} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </FlatCard>

        {/* Summary tiles — also the status filter. Tap the selected tile again to return to All. */}
        {!isPortal && mode === 'repairs' && (
          <View style={styles.tiles}>
            {SUMMARY_TILES.map((tile, index) => {
              const color = tile.filter === 'Received' ? colors.primary
                : tile.filter === 'Repair' ? colors.warning
                : tile.filter === 'Ready' ? colors.success
                : colors.purple;
              return (
                <SummaryTile
                  key={tile.filter}
                  label={tile.label}
                  icon={tile.icon}
                  color={color}
                  count={countQueries[index].data?.total}
                  active={filter === tile.filter}
                  onPress={() => setFilter(filter === tile.filter ? 'All' : tile.filter)}
                />
              );
            })}
          </View>
        )}

        {/* Dealers / After-Sales Service mode strip; ✕ returns to the repairs list. */}
        {!isPortal && mode !== 'repairs' && (
          <View style={[styles.modeStrip, { backgroundColor: colors.card, borderColor: colors.border }]} testID="repairs-mode-strip">
            <View style={[styles.sheetRowIcon, { backgroundColor: `${mode === 'dealers' ? colors.primary : colors.warning}1A` }]}>
              <Feather name={mode === 'dealers' ? 'briefcase' : 'corner-up-left'} size={size.statIcon} color={mode === 'dealers' ? colors.primary : colors.warning} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...font.itemTitle, color: colors.foreground }} numberOfLines={1}>
                {mode === 'dealers' ? 'Dealers' : 'After-Sales Service'}
              </Text>
              <Text style={{ ...font.caption, color: colors.mutedForeground }} numberOfLines={1}>
                {mode === 'dealers' ? `${totalCount} dealers` : `${totalCount} cases`}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setMode('repairs')}
              accessibilityRole="button"
              accessibilityLabel="Back to all repairs"
              testID="repairs-mode-close"
              style={styles.modeClose}
            >
              <Feather name="x" size={size.headerIcon} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        )}

        {!isPortal && offlineItems.length > 0 && (
          <View style={{ backgroundColor: colors.warning + '22', borderWidth: 1, borderColor: colors.warning + '44', padding: 12, borderRadius: 8, marginHorizontal: layout.listInset, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...font.bodyStrong, color: colors.warning }}>
                {offlineItems.length} repair{offlineItems.length > 1 ? 's' : ''} saved offline
              </Text>
              <Text style={{ ...font.caption, color: colors.warning, marginTop: 2 }}>
                Photos/signatures will need to be re-added once synced.
              </Text>
              {offlineItems.some(i => i.status === 'failed') && (
                <Text style={{ ...font.caption, color: colors.destructive, marginTop: 2 }}>
                  Some items failed to sync due to errors.
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={handleSync}
              disabled={isSyncing || !isConnected}
              style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: (isSyncing || !isConnected) ? colors.muted : colors.warning, borderRadius: 6 }}
            >
              {isSyncing ? (
                <AvarpusSpinner size={20} color="#FFF" />
              ) : (
                <Text style={{ ...font.captionStrong, color: '#FFF' }}>
                  {isConnected ? 'Sync Now' : 'Offline'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Dealer-portal supplier card: the repair shop, from the dealer's side */}
        {isDealerPortal && myDealer?.supplier && (
          <FlatCard testID="portal-supplier-card" style={{ padding: 12, marginHorizontal: layout.listInset, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primary + '1A', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="tool" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...font.overline, color: colors.mutedForeground }}>SUPPLIER</Text>
              <Text style={{ ...font.itemTitle, color: colors.foreground }} numberOfLines={1}>
                {myDealer.supplier.businessName}
              </Text>
              <Text style={{ ...font.caption, color: colors.mutedForeground }} numberOfLines={1}>
                {myDealer.supplier.ownerName} · {myDealer.supplier.ownerMobile}
              </Text>
            </View>
            <TouchableOpacity
              testID="portal-supplier-call"
              accessibilityRole="button"
              accessibilityLabel={`Call ${myDealer.supplier.businessName}`}
              onPress={() => { void Linking.openURL(`tel:${myDealer.supplier?.ownerMobile ?? ''}`); }}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.success + '1A', alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="phone-call" size={16} color={colors.success} />
            </TouchableOpacity>
          </FlatCard>
        )}

        {/* Dealer-portal stats header */}
        {isDealerPortal && myDealer?.stats && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: layout.listInset }}>
            {[
              { label: 'Total', value: String(myDealer.stats.totalRepairs), color: colors.primary },
              { label: 'In Progress', value: String(myDealer.stats.received + myDealer.stats.repairing), color: colors.warning },
              { label: 'Ready', value: String(myDealer.stats.ready), color: colors.info },
              { label: 'Delivered', value: String(myDealer.stats.delivered), color: colors.success },
            ].map((s) => (
              <FlatCard key={s.label} style={{ flex: 1, minWidth: '22%', padding: 10, alignItems: 'center', gap: 2 }}>
                <Text style={{ ...font.heading, color: s.color }}>{s.value}</Text>
                <Text style={{ ...font.caption, color: colors.mutedForeground }}>{s.label}</Text>
              </FlatCard>
            ))}
          </View>
        )}

        {isCustomerPortal && myKhata?.totals && (() => {
          const balance = myKhata.totals.balance;
          const label = balance > 0 ? 'Due' : balance < 0 ? 'Advance' : 'Paid / Settled';
          const color = balance > 0 ? colors.destructive : colors.success;
          return (
            <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: layout.listInset }}>
              <FlatCard style={{ flex: 1, padding: 12, gap: 3 }}>
                <Text style={{ ...font.overline, color: colors.mutedForeground }}>TOTAL REPAIR VALUE</Text>
                <Text style={{ ...font.heading, color: colors.foreground }}>
                  {formatCurrency(myKhata.totals.totalGiven)}
                </Text>
              </FlatCard>
              <FlatCard style={{ flex: 1, padding: 12, gap: 3 }}>
                <Text style={{ ...font.overline, color: colors.mutedForeground }}>{label.toUpperCase()}</Text>
                <Text style={{ ...font.heading, color }}>
                  {formatCurrency(Math.abs(balance))}
                </Text>
              </FlatCard>
            </View>
          );
        })()}

        {/* Portal accounts keep their compact status chips */}
        {isPortal && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: layout.listInset, paddingBottom: space.xs }}>
            {PORTAL_FILTERS.map((item) => {
              const active = portalFilter === item;
              return (
                <TouchableOpacity hitSlop={hitSlop.chip}
                  key={item}
                  onPress={() => setPortalFilter(item)}
                  activeOpacity={0.8}
                  style={[styles.filterTab, {
                    backgroundColor: active ? colors.primary : colors.secondary,
                    borderColor: active ? colors.primary : colors.secondary,
                  }]}
                >
                  <Text style={[styles.filterText, {
                    color: active ? colors.primaryForeground : colors.foreground,
                  }]}>{item}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {(user?.role === 'technician' || (mode === 'repairs' && (filter === 'All' || filter === 'Delivered'))) && !isPortal && (
          <View style={styles.toggles}>
            {user?.role === 'technician' && (
              <TouchableOpacity onPress={() => setTechOnly(!techOnly)} style={styles.toggle} hitSlop={hitSlop.chip} accessibilityRole="checkbox" accessibilityState={{ checked: techOnly }}>
                <View style={[styles.checkbox, { borderColor: colors.primary, backgroundColor: techOnly ? colors.primary : 'transparent' }]}>
                  {techOnly && <Feather name="check" size={12} color="#FFF" />}
                </View>
                <Text style={{ ...font.captionStrong, color: colors.mutedForeground }}>Assigned to me only</Text>
              </TouchableOpacity>
            )}
            {mode === 'repairs' && (filter === 'All' || filter === 'Delivered') && (
              <TouchableOpacity onPress={() => setShowCancelled(!showCancelled)} style={styles.toggle} hitSlop={hitSlop.chip} accessibilityRole="checkbox" accessibilityState={{ checked: showCancelled }}>
                <View style={[styles.checkbox, { borderColor: colors.primary, backgroundColor: showCancelled ? colors.primary : 'transparent' }]}>
                  {showCancelled && <Feather name="check" size={12} color="#FFF" />}
                </View>
                <Text style={{ ...font.captionStrong, color: colors.mutedForeground }}>Include Cancelled</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </FadeInView>

      {isGlobalLoading && totalCount === 0 ? (
        <DataLoadingState />
      ) : isGlobalError && totalCount === 0 ? (
        <DataErrorState onRetry={onRefresh} />
      ) : (
      <>
      {!!isGlobalError && <DataErrorBanner onRetry={onRefresh} />}

      {!isPortal && mode === 'dealers' ? (
        <FlatList
          data={dealers}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={dealersLoading} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            isOwner && overviewData?.stats ? (
              <FlatCard style={{ padding: 14, gap: 10, marginHorizontal: layout.listInset, marginBottom: 2 }}>
                <Text style={{ ...font.overline, color: colors.mutedForeground }}>DEALER REPAIRS OVERVIEW</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {[
                    { label: 'Total Repairs', value: String(overviewData.stats.totalDealerRepairs), color: colors.primary },
                    { label: 'Active', value: String(overviewData.stats.activeRepairs), color: colors.warning },
                    { label: 'Delivered', value: String(overviewData.stats.deliveredRepairs), color: colors.success },
                    { label: 'Returns', value: String(overviewData.stats.afterSaleReturns), color: colors.destructive },
                    { label: 'Revenue', value: formatCurrency(overviewData.stats.totalRepairRevenue), color: colors.success },
                    { label: 'Pending', value: formatCurrency(overviewData.stats.pendingPayments), color: colors.warning },
                  ].map((s) => (
                    <View key={s.label} style={{ minWidth: '28%' }}>
                      <Text style={{ ...font.heading, color: s.color }}>{s.value}</Text>
                      <Text style={{ ...font.caption, color: colors.mutedForeground }}>{s.label}</Text>
                    </View>
                  ))}
                </View>
              </FlatCard>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="briefcase"
              title="No dealers yet"
              description={search ? 'Try a different search term' : 'Add your B2B dealers to track their bulk repairs'}
              actionLabel={canCreateRepair ? 'Add Dealer' : undefined}
              onAction={canCreateRepair ? () => router.push('/(tabs)/repairs/dealer-new') : undefined}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => router.push(`/(tabs)/repairs/dealer/${item.id}`)} activeOpacity={0.8}>
              <FlatCard style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.repairIdBadge, { backgroundColor: colors.primary + '15' }]}>
                    <Text style={[styles.repairId, { color: colors.primary, fontFamily: fontFamily.bold }]}>{item.dealerCode}</Text>
                  </View>
                  {!item.isActive && (
                    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.destructive + '22' }}>
                      <Text style={{ ...font.smallStrong, color: colors.destructive }}>INACTIVE</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.customerName, { color: colors.foreground, fontFamily: fontFamily.semibold }]}>{item.name}</Text>
                <Text style={[styles.deviceLine, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
                  {[item.shopName, item.location].filter(Boolean).join(' · ') || item.mobile}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
                  <Text style={{ ...font.caption, color: colors.mutedForeground }}>Total: <Text style={{ color: colors.foreground, fontFamily: fontFamily.semibold }}>{item.totalRepairs}</Text></Text>
                  <Text style={{ ...font.caption, color: colors.warning }}>In Progress: {item.received + item.repairing}</Text>
                  <Text style={{ ...font.caption, color: colors.info }}>Ready: {item.ready}</Text>
                  <Text style={{ ...font.caption, color: colors.success }}>Delivered: {item.delivered}</Text>
                </View>
              </FlatCard>
            </TouchableOpacity>
          )}
        />
      ) : !isPortal && mode === 'returns' ? (
        <FlatList
          data={filteredReturns}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={returnsLoading} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="corner-up-left"
              title="No after-sales cases"
              description={search ? 'Try a different search term' : 'No return cases match the current filter'}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => router.push(`/(tabs)/repairs/return/${item.id}`)} activeOpacity={0.8}>
              <FlatCard style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.repairIdBadge, { backgroundColor: colors.warning + '15' }]}>
                    <Text style={[styles.repairId, { color: colors.warning, fontFamily: fontFamily.bold }]}>{item.returnId}</Text>
                  </View>
                  <View style={[{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: getReturnStatusColor(item.status, colors) + '15' }]}>
                    <Text style={{ ...font.captionStrong, color: getReturnStatusColor(item.status, colors), textTransform: 'capitalize' }}>
                      {item.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.customerName, { color: colors.foreground, fontFamily: fontFamily.semibold }]}>{item.customerName || 'Unknown'}</Text>
                <Text style={[styles.deviceLine, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
                  {item.brand} {item.model}
                </Text>
                <Text style={[styles.problem, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]} numberOfLines={1}>
                  Reason: {item.reason.replace(/_/g, ' ')}
                </Text>
                <View style={styles.cardBottom}>
                  {item.underWarranty ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Feather name="shield" size={12} color={colors.success} />
                      <Text style={{ ...font.captionStrong, color: colors.success }}>Warranty</Text>
                    </View>
                  ) : (
                    <Text style={{ ...font.captionStrong, color: colors.mutedForeground }}>Out of Warranty</Text>
                  )}
                  <View style={styles.cardBottomRight}>
                    <Text style={[styles.dateText, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
                      {formatDate(item.createdAt)}
                    </Text>
                  </View>
                </View>
              </FlatCard>
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          data={accumulatedRepairs}
          keyExtractor={(r) => r.id}
          // Rows read the token and the refetch stamp from the render closure;
          // the list only re-renders them when this value changes.
          extraData={`${token ?? ''}:${repairsUpdatedAt}`}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={repairsLoading && page === 1} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="tool"
              title="No repairs found"
              description={search ? 'Try a different search term' : 'No repairs match the current filter'}
              actionLabel={showNewRepairFab ? 'Create Repair' : undefined}
              onAction={showNewRepairFab ? () => router.push('/(tabs)/repairs/new') : undefined}
            />
          }
          ListFooterComponent={
             repairsFetching && (repairsData?.repairs?.length || 0) > 0 ? (
               <AvarpusSpinner size={20} style={{ marginVertical: 20 }} />
             ) : null
          }
          onEndReached={() => {
             if (repairsData?.total && accumulatedRepairs.length < repairsData.total && !repairsFetching) {
               setPage(p => p + 1);
             }
          }}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => {
            // Portal accounts get a read-only card: variant derived from the
            // repair's own status, never the staff 'ready' variant (which
            // shows Notify/Payment/Hand Over actions).
            return (
              <RepairCard
                repair={item}
                token={token}
                retryKey={repairsUpdatedAt}
                onPress={() => router.push(`/(tabs)/repairs/${item.id}`)}
                onSendToDealer={sendToDealerFor(item)}
                onViewPhoto={setViewerPhoto}
              />
            );
          }}
        />
      )}
      </>
      )}

      {/* Floating create button, bottom-right above the workspace footer */}
      {showNewDealerFab && (
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/repairs/dealer-new')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="New dealer"
          testID="repairs-fab"
          style={[styles.fab, { backgroundColor: colors.primary, shadowColor: colors.primary }]}
        >
          <Feather name="plus" size={size.headerIcon} color={colors.primaryForeground} />
          <Text style={[styles.fabText, { color: colors.primaryForeground }]}>Dealer</Text>
        </TouchableOpacity>
      )}
      {showNewRepairFab && (
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/repairs/new')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="New repair"
          testID="repairs-fab"
          style={[styles.fab, { backgroundColor: colors.primary, shadowColor: colors.primary }]}
        >
          <Feather name="plus" size={size.headerIcon} color={colors.primaryForeground} />
          <Text style={[styles.fabText, { color: colors.primaryForeground }]}>New</Text>
        </TouchableOpacity>
      )}

      {!isPortal && <OptionsSheet visible={menuOpen} onClose={() => setMenuOpen(false)} options={sheetOptions} />}
      <PhotoViewerModal photo={viewerPhoto} token={token} onClose={() => setViewerPhoto(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingBottom: layout.rowPaddingVertical, gap: space.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: layout.headerHeight, paddingHorizontal: layout.listInset },
  headerText: { flex: 1, marginLeft: space.xs },
  headerTitle: { ...font.heading, fontFamily: fontFamily.bold, letterSpacing: 0.3 },
  headerSub: { ...font.caption },
  circleButton: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  avatarBadge: { position: 'absolute', bottom: -2, right: -2, borderRadius: 10, padding: 2 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: size.searchGap, paddingLeft: size.searchPadding, paddingRight: space.md, minHeight: size.searchField, borderRadius: size.searchRadius, marginHorizontal: layout.listInset },
  searchInput: { flex: 1, ...font.search, paddingVertical: 0 },
  tiles: { flexDirection: 'row', gap: space.sm, marginHorizontal: layout.listInset },
  tile: { flex: 1, alignItems: 'center', paddingVertical: space.sm, paddingHorizontal: space.xs, borderRadius: radius.md, borderWidth: 1, gap: space.xs },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tileIcon: { width: size.statBox, height: size.statBox, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  tileCount: { ...font.itemTitle, fontFamily: fontFamily.bold },
  tileLabel: { ...font.caption },
  modeStrip: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: layout.listInset, paddingLeft: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  modeClose: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  toggles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginHorizontal: layout.listInset },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: size.chip },
  checkbox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  filterTab: { paddingHorizontal: space.lg, minHeight: size.chip, justifyContent: 'center', borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  filterText: { ...font.captionStrong },
  list: { paddingBottom: size.fab + space.xxxl, gap: space.sm },
  // Ticket card: thumbnail | details | status + money, ⋮ in the top-right corner.
  repairCard: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: layout.listInset, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  // Portrait, like the detail screen's device tile, so a phone photo reads at a glance.
  thumb: { width: size.coverThumbWidth, height: size.coverThumbHeight, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbImage: { width: '100%', height: '100%' },
  cardBody: { flex: 1, marginLeft: space.md, marginRight: space.sm },
  ticket: { ...font.itemTitle, fontFamily: fontFamily.bold, marginBottom: layout.rowLineGap },
  cardLine: { ...font.caption },
  inlineNote: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  cardAside: { alignItems: 'flex-end' },
  // The ⋮ sits in the card's top-right corner (8dp in); the pill row stays out from under it.
  cardAsideTop: { paddingRight: size.headerIcon },
  // A full 44dp box in the card's corner: hit slop would be clipped by the card's edge, so the box itself is the target.
  menuButton: { position: 'absolute', top: 0, right: 0, width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  money: { alignItems: 'flex-end', gap: space.xs, marginTop: space.sm },
  price: { ...font.bodyStrong, fontFamily: fontFamily.bold },
  paid: { ...font.small },
  due: { ...font.smallStrong },
  fab: {
    position: 'absolute',
    right: layout.listInsetEnd,
    bottom: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    height: size.buttonSm,
    borderRadius: radius.sm,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  fabText: { ...font.button },
  // Options sheet
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(6, 10, 18, 0.72)' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: layout.listInset, paddingTop: space.sm },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, marginBottom: space.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.xs, marginBottom: space.sm },
  sheetTitle: { ...font.heading },
  sheetClose: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  sheetList: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md },
  sheetRowIcon: { width: size.avatarSm, height: size.avatarSm, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  // Dealer / after-sales cards (unchanged look)
  card: { padding: space.lg, marginHorizontal: layout.listInset, gap: space.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  repairIdBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  repairId: { ...font.smallStrong },
  customerName: { ...font.itemTitle },
  deviceLine: { ...font.body },
  problem: { ...font.caption },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  cardBottomRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateText: { ...font.caption },
});
