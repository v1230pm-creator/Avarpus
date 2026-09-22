import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  TextInput,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useQueryClient } from '@tanstack/react-query';

import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';
import { ConfirmDialogHost, useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RepairStatusBadge, PriorityBadge, SampleBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { Repair, RepairStatus, isDealerPortalRole, isLinkedCustomerPortalUser } from '@/types';
import { formatDate, formatCurrency, REPAIR_STATUS_LABELS, REPAIR_STATUSES, getReturnStatusColor } from '@/utils/helpers';
import { storage, KEYS } from '@/utils/storage';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { KeyboardAvoidingCompat } from '@/components/KeyboardAvoidingCompat';
import {
  useRepairPhotosList, getRepairPhotosListQueryKey,
  useRepairEventsList, getRepairEventsListQueryKey,
  requestUploadUrl, repairPhotosAdd,
  useReturnsList, getReturnsListQueryKey,
  useRepairPartsList, getRepairPartsListQueryKey, repairPartsAdd,
  useRepairPaymentsList, getRepairPaymentsListQueryKey, repairPaymentsCreate, repairPaymentVoid, repairPaymentsVoidAll,
  useStaffList, getStaffListQueryKey, repairAssignTechnician,
  repairNotesAdd, useEstimateApprovalsList, getEstimateApprovalsListQueryKey, estimateApprovalsCreate,
  estimateApprovalsDecide, repairNotifyReady, estimateApprovalsSendOtp,
  repairsUpdate, useRepairsGet, getRepairsGetQueryKey, UploadUrlRequestContentType } from '@workspace/api-client-react';
import { AvarpusLoadingScreen, AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { fetch as expoFetch } from 'expo/fetch';
import { File as ExpoFile } from 'expo-file-system';

const STATUS_FLOW: string[] = ['received', 'diagnosing', 'waiting_parts', 'repairing', 'testing', 'customer_approval', 'ready', 'delivered'];

const CHECKLIST_ITEMS = [
  { id: 'dead_condition', label: 'Dead Condition' },
  { id: 'power_on', label: 'Power On' },
  { id: 'display', label: 'Display' },
  { id: 'touch', label: 'Touch' },
  { id: 'camera', label: 'Camera' },
  { id: 'speaker', label: 'Speaker' },
  { id: 'microphone', label: 'Microphone' },
  { id: 'charging', label: 'Charging' },
  { id: 'fingerprint', label: 'Fingerprint' },
  { id: 'face_unlock', label: 'Face Unlock' },
  { id: 'wifi', label: 'WiFi' },
  { id: 'bluetooth', label: 'Bluetooth' },
  { id: 'sim', label: 'SIM' },
  { id: 'network', label: 'Network' },
  { id: 'battery_health', label: 'Battery Health' },
  { id: 'vibration', label: 'Vibration' },
  { id: 'flash', label: 'Flash' },
  { id: 'sensors', label: 'Sensors' },
  { id: 'volume_buttons', label: 'Volume Buttons' },
  { id: 'power_button', label: 'Power Button' },
];

function InfoRow({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: color ?? colors.foreground, fontFamily: bold ? fontFamily.semibold : fontFamily.medium }]}>{value}</Text>
    </View>
  );
}

function SummaryRow({ icon, label, value, color, bold, rightElement }: { icon: any, label: string, value: string, color?: string, bold?: boolean, rightElement?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border + '55' }}>
      <Feather name={icon} size={16} color={colors.mutedForeground} style={{ width: 28 }} />
      <Text style={{ fontSize: 13, color: colors.mutedForeground, flex: 1 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 13, color: color || colors.foreground, fontFamily: bold ? fontFamily.semibold : fontFamily.medium }}>{value}</Text>
        {rightElement}
      </View>
    </View>
  );
}

function ReadOnlyRepairDetail({ repair, topPad }: { repair: Repair; topPad: number }) {
  const colors = useColors();
  const router = useRouter();
  const total = repair.totalAmount ?? repair.repairCharge + repair.partsCharge;
  const paid = repair.paidAmount ?? repair.advance ?? 0;
  const rawBalance = repair.balance ?? total - paid;
  const balanceLabel = rawBalance > 0 ? 'Due' : rawBalance < 0 ? 'Advance' : 'Paid / Settled';
  const balanceAmount = rawBalance === 0 ? formatCurrency(0) : formatCurrency(Math.abs(rawBalance));
  const balanceColor = rawBalance > 0 ? colors.destructive : rawBalance < 0 ? colors.success : colors.success;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={[styles.detailHeader, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.detailTitle, { color: colors.foreground }]}>Repair Details</Text>
          <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Read-only repair portal</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { padding: 16, paddingBottom: 36 }]} showsVerticalScrollIndicator={false}>
        <Card>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>REPAIR</Text>
          <InfoRow label="Ticket" value={repair.repairId} bold />
          <InfoRow label="Status" value={REPAIR_STATUS_LABELS[repair.status] || repair.status} />
          <InfoRow label="Customer" value={repair.customerName} />
          <InfoRow label="Device" value={[repair.deviceType, repair.brand, repair.model].filter(Boolean).join(' · ')} />
          {!!repair.problem && <InfoRow label="Problem" value={repair.problem} />}
        </Card>
        {/* Legacy jobs only: the structured work field older repairs carry.
            Work notes are internal timeline events, which portals cannot read. */}
        {!!repair.workPerformed?.trim() && (
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>REPAIR WORK</Text>
            <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 20 }}>{repair.workPerformed.trim()}</Text>
          </Card>
        )}
        <Card>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>PAYMENT SUMMARY</Text>
          <InfoRow label="Charges / Price" value={formatCurrency(total)} bold />
          <InfoRow label="Paid / Deposit" value={formatCurrency(paid)} color={colors.success} />
          <InfoRow label={balanceLabel} value={balanceAmount} color={balanceColor} bold />
        </Card>
      </ScrollView>
    </View>
  );
}

export default function RepairDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { repairs, updateRepair, deleteRepair, inventory, loadAll, isLoading: shopDataLoading } = useData();
  const { user, canAccess } = useAuth();
  const queryClient = useQueryClient();
  const { confirm } = useConfirmDialog();

  const [updating, setUpdating] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  const [showDeliveryHandover, setShowDeliveryHandover] = useState(false);
  const [handoverPaymentMethod, setHandoverPaymentMethod] = useState('Cash');

  // Add Part
  const [showAddPart, setShowAddPart] = useState(false);
  const [selectedInventoryId, setSelectedInventoryId] = useState('');
  const [partName, setPartName] = useState('');
  const [partCost, setPartCost] = useState('');
  const [partQty, setPartQty] = useState('1');

  // Financial Edits
  const [showFinancialEdit, setShowFinancialEdit] = useState(false);
  const [editRepairCharge, setEditRepairCharge] = useState('');
  const [editServiceCharge, setEditServiceCharge] = useState('');
  const [editOtherCharge, setEditOtherCharge] = useState('');
  const [editDiscount, setEditDiscount] = useState('');
  const [editTaxPercent, setEditTaxPercent] = useState('');

  // Payment Collection
  const [showPayment, setShowPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentKind, setPaymentKind] = useState('partial');
  const [paymentKindTouched, setPaymentKindTouched] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ id: string; amount: number; method: string } | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  // Owner-only "mark the whole job unpaid" on a delivered repair: every live
  // payment is voided with one shared reason (rows are never deleted).
  const [showMarkUnpaid, setShowMarkUnpaid] = useState(false);
  const [markUnpaidReason, setMarkUnpaidReason] = useState('');
  const [markUnpaidSubmitting, setMarkUnpaidSubmitting] = useState(false);
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState<{
    amount: number; method: string; kind: string; referenceNo?: string; createdAt: string;
    totalPaidAfter: number; remainingAfter: number;
  } | null>(null);
  const paymentSubmitRef = useRef(false);

  // Technician Assignment
  const [showAssign, setShowAssign] = useState(false);

  // Estimate Approval
  const [showApproval, setShowApproval] = useState(false);
  const [newEstimate, setNewEstimate] = useState('');
  const [approvalReason, setApprovalReason] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  // Warranty
  const [deliveryWarranty, setDeliveryWarranty] = useState('0');
  const [customWarrantyDays, setCustomWarrantyDays] = useState('');

  // More details sheet
  const [showMore, setShowMore] = useState(false);
  // Photos sheet (view + add) and the copy-mobile confirmation tick.
  const [showPhotos, setShowPhotos] = useState(false);
  const [photoUploading, setPhotoUploading] = useState<'camera' | 'library' | null>(null);
  const [mobileCopied, setMobileCopied] = useState(false);

  // Work notes (free text, append-only) — composed inside a sheet
  const [showNotes, setShowNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  const qrRef = useRef<any>(null);
  useEffect(() => {
    storage.get<string>(KEYS.AUTH_TOKEN).then(setToken);
  }, []);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  // The tab bar is position:'absolute' (see (tabs)/_layout.tsx), so screen
  // content renders behind it. Offset the sticky action bar above the tab bar:
  // Keep fixed actions above the custom tab bar's visible content and the
  // system navigation safe area.
  const tabBarHeight = Platform.OS === 'web' ? 84 : 62 + Math.max(insets.bottom, 8);
  const anims = useStaggerAnim(16);

  const repairFromList = useMemo(() => repairs.find((r) => r.id === id), [repairs, id]);
  // The shared shop list is a bulk snapshot; a repair opened from a
  // notification, a deep link or a search result may not be in it yet (or at
  // all). Fetch the row directly so the detail never depends on list contents.
  const {
    data: repairDetailData,
    isLoading: repairDetailLoading,
    error: repairDetailError,
  } = useRepairsGet(id as string, {
    query: { enabled: !!id, queryKey: getRepairsGetQueryKey(id as string) },
  });
  const repairFromServer = repairDetailData?.repair as Repair | undefined;
  const repairResolved = repairFromList ?? repairFromServer;
  const [repairSnapshot, setRepairSnapshot] = useState<Repair | undefined>(repairResolved);
  useEffect(() => {
    if (repairResolved) setRepairSnapshot(repairResolved);
  }, [repairResolved]);
  // A status transition can immediately remove the repair from the currently
  // filtered list (for example received -> repairing). Keep the open detail
  // anchored to the last server-confirmed record instead of rendering the
  // misleading "Repair not found" state. The snapshot is only ever valid for
  // the id currently on screen — never carry one repair over to another route.
  const repair = repairResolved ?? (repairSnapshot?.id === id ? repairSnapshot : undefined);
  // Only a request that is genuinely in flight may show the loader.
  const repairResolving = !repair && !repairDetailError && (repairDetailLoading || shopDataLoading);
  const isReadOnlyPortal = isDealerPortalRole(user?.role) || isLinkedCustomerPortalUser(user);

  const portalQueriesEnabled = !!id && !isReadOnlyPortal;
  const { data: photosData } = useRepairPhotosList(id as string, { query: { enabled: portalQueriesEnabled, queryKey: getRepairPhotosListQueryKey(id as string) } });
  // Fullscreen viewer for receiving photos / signatures — tap a thumbnail to open.
  const [viewerImage, setViewerImage] = useState<{ uri: string; label: string } | null>(null);
  const { data: eventsData } = useRepairEventsList(id as string, { query: { enabled: portalQueriesEnabled, queryKey: getRepairEventsListQueryKey(id as string) } });
  const { data: returnsData } = useReturnsList({ query: { enabled: !isReadOnlyPortal, queryKey: getReturnsListQueryKey() } });
  const { data: partsData, refetch: partsRefetch } = useRepairPartsList(id as string, { query: { enabled: portalQueriesEnabled, queryKey: getRepairPartsListQueryKey(id as string) } });

  const { data: paymentsData, refetch: paymentsRefetch } = useRepairPaymentsList(id as string, { query: { enabled: portalQueriesEnabled, queryKey: getRepairPaymentsListQueryKey(id as string) } });
  const { data: staffData } = useStaffList({ query: { enabled: !isReadOnlyPortal, queryKey: getStaffListQueryKey() } });
  const { data: approvalsData, refetch: approvalsRefetch } = useEstimateApprovalsList(id as string, { query: { enabled: portalQueriesEnabled, queryKey: getEstimateApprovalsListQueryKey(id as string) } });

  const repairReturns = useMemo(() => returnsData?.returns?.filter(r => r.repairId === id) || [], [returnsData, id]);
  const parts = partsData?.parts || [];
  const payments = paymentsData?.payments || [];
  const refunds = paymentsData?.refunds || [];
  const visibleRefunds = refunds.filter(f => f.status !== 'rejected');
  const paidRefundsTotal = refunds.filter(f => f.status === 'paid').reduce((s, f) => s + f.amount, 0);
  const approvals = approvalsData?.estimateApprovals || [];
  const technicians = staffData?.staff?.filter(s => s.role === 'technician') || [];

  const getAbsoluteUrl = (path: string) => `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/storage${path}`;

  if (!repair) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>

        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        {repairResolving ? (
          <AvarpusLoadingScreen background={colors.background} size={40} />
        ) : (
          <View style={styles.notFound}>
            <Text style={[styles.notFoundText, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
              Repair not found
            </Text>
          </View>
        )}
      </View>
    );
  }

  // Portal sessions are deliberately rendered by a separate, action-free
  // screen. They consume only the repair returned by the server-scoped list.
  if (isReadOnlyPortal) {
    return <ReadOnlyRepairDetail repair={repair} topPad={topPad} />;
  }

  const balance = repair.balance !== undefined
    ? Math.max(0, repair.balance)
    : Math.max(0, repair.repairCharge + repair.partsCharge - repair.advance);
  const canUpdateStatus = canAccess('repairs_update') || (canAccess('repairs') && user?.role !== 'reception');
  // Money visibility + payment collection follow the shop's per-role feature
  // toggles (finance OR payment collection). Owner roles pass via canAccess.
  const canSeeFinance = canAccess('finance') || canAccess('payments');
  const isActiveRepair = repair.status !== 'delivered' && repair.status !== 'cancelled' && repair.status !== 'cannot_repair';
  const isDealer = user?.role === 'dealer' || user?.role === 'super_admin';
  // Dealer/owner may correct or delete a delivered job — staff cannot.
  const dealerDeliveredEdit = isDealer && repair.status === 'delivered';

  // Simplified 5-step flow: Received → Repairing → Testing → Ready → Delivered
  const stageIndex =
    repair.status === 'received' ? 0
    : ['diagnosing', 'waiting_parts', 'repairing'].includes(repair.status as string) ? 1
    : ['testing', 'customer_approval'].includes(repair.status as string) ? 2
    : repair.status === 'ready' ? 3
    : repair.status === 'delivered' ? 4
    : -1;
  const nextStep =
    repair.status === 'received' ? { id: 'repairing', label: 'Repairing', desc: 'Start repairing — add work notes as you go' }
    : ['diagnosing', 'waiting_parts', 'repairing'].includes(repair.status as string) ? { id: 'testing', label: 'Testing', desc: 'Move job to testing' }
    : ['testing', 'customer_approval'].includes(repair.status as string) ? { id: 'ready', label: 'Ready', desc: 'Ready for customer pickup' }
    : repair.status === 'ready' ? { id: 'delivered', label: 'Delivered', desc: 'Complete delivery and choose Due or Mark as Paid' }
    : null;
  const continueButtonLabel =
    nextStep?.id === 'repairing' ? 'Continue as Repairing'
    : nextStep?.id === 'testing' ? 'Continue as Testing'
    : nextStep?.id === 'ready' ? 'Continue as Ready'
    : nextStep?.id === 'delivered' ? 'Continue to Deliver'
    : 'Continue';

  // Intake-completion gate (mirrors the server): a job cannot leave
  // 'received' until the intake record itself is complete. Later stages are
  // never gated — work is described through free-text notes.
  const stageMissing: string[] = (() => {
    if (!nextStep) return [];
    if (stageIndex === 0) {
      const miss: string[] = [];
      if (!repair.customerName?.trim()) miss.push('Customer name');
      if (!repair.mobile?.trim()) miss.push('Phone number');
      if (!(repair.brand?.trim() || repair.model?.trim())) miss.push('Device details');
      if (!repair.problem?.trim()) miss.push('Complaint / problem');
      return miss;
    }
    return [];
  })();
  const nextStepBlocked = stageMissing.length > 0;

  const showIncompleteAlert = (missing?: string[]) => {
    const list = (missing && missing.length ? missing : stageMissing).map(m => `• ${m}`).join('\n');
    Alert.alert(
      'Please complete this step first.',
      list ? `Yeh required kaam pehle complete karke save karein:\n\n${list}` : 'Pehle current stage ka required kaam complete karke save karein.',
    );
  };

  // ── Receive Payment: real financials from the repair + payments ledger ──
  const payTotal = repair.totalAmount || (repair.repairCharge + repair.partsCharge);
  const payPaid = repair.paidAmount ?? repair.advance ?? 0;
  const payRemaining = repair.balance !== undefined ? Math.max(0, repair.balance) : Math.max(0, payTotal - payPaid);
  // Money math in integer paise to avoid floating-point boundary bugs
  const payRemainingCents = Math.round(payRemaining * 100);
  // Owner-only corrections surfaced in the "more" sheet next to Invoice.
  // Same gates the bottom action bar used to apply.
  const canMarkUnpaid = repair.status === 'delivered' && isDealer && canSeeFinance && payPaid > 0;
  const canDeleteRepair = isDealer && (repair.status === 'delivered' || repair.status === 'cancelled' || repair.status === 'cannot_repair');
  const parseAmountCents = (s: string): number | null => {
    const t = s.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    return Math.round(Number(t) * 100);
  };
  const paymentAmountCents = parseAmountCents(paymentAmount);
  const paymentAmountNum = paymentAmountCents !== null ? paymentAmountCents / 100 : NaN;
  const paymentAmountError = !paymentAmount.trim()
    ? ''
    : paymentAmountCents === null || paymentAmountCents <= 0
      ? 'Enter a valid amount greater than 0 (max 2 decimals)'
      : paymentAmountCents > payRemainingCents
        ? `Amount exceeds remaining ${formatCurrency(payRemaining)}`
        : '';
  const paymentAmountValid = !!paymentAmount.trim() && !paymentAmountError;
  const paymentReferenceLabel =
    paymentMethod === 'UPI' ? 'UPI Transaction ID / Reference'
    : paymentMethod === 'Card' ? 'Card Transaction / Reference ID'
    : paymentMethod === 'Bank Transfer' ? 'UTR / Transaction ID'
    : paymentMethod === 'Other' ? 'Reference / Details (Optional)'
    : null;
  const paymentReferenceRequired = ['UPI', 'Card', 'Bank Transfer'].includes(paymentMethod);
  const paymentFormValid = paymentAmountValid && (!paymentReferenceRequired || paymentReference.trim().length > 0);

  const suggestPaymentKind = (amtStr: string) => {
    if (repair.status === 'delivered') return 'due';
    const cents = parseAmountCents(amtStr);
    const clearsBalance = cents !== null && cents > 0 && payRemainingCents > 0 && cents >= payRemainingCents;
    if (clearsBalance) return 'final';
    return payPaid > 0 ? 'partial' : 'advance';
  };

  // Void/reverse a payment — dealer/owner only, reason required. The row is
  // never removed; it stays struck through with the audit trail.
  const handleVoidPayment = (pmt: { id: string; amount: number; method: string }) => {
    setVoidReason('');
    setVoidTarget(pmt);
  };

  const submitVoidPayment = async () => {
    if (!voidTarget || voidSubmitting) return;
    if (!voidReason.trim()) { Alert.alert('Reason Required', 'Void karne ke liye reason zaroori hai.'); return; }
    setVoidSubmitting(true);
    try {
      await repairPaymentVoid(repair.id, voidTarget.id, { reason: voidReason.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setVoidTarget(null);
      await loadAll();
      await paymentsRefetch();
      queryClient.invalidateQueries();
    } catch (e: any) {
      Alert.alert('Void Failed', e.message || 'Could not void payment.');
    } finally {
      setVoidSubmitting(false);
    }
  };

  // Reverse the whole job in one server transaction so it goes back to unpaid.
  // The server locks the repair and voids every live payment together — a
  // client-side loop over single voids could miss a payment recorded midway
  // and leave the job silently paid.
  const submitMarkUnpaid = async () => {
    const reason = markUnpaidReason.trim();
    if (!reason || markUnpaidSubmitting) return;
    setMarkUnpaidSubmitting(true);
    try {
      const res = await repairPaymentsVoidAll(repair.id, { reason });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setShowMarkUnpaid(false);
      setMarkUnpaidReason('');
      if (res.voidedCount === 0) {
        Alert.alert('Pehle se Unpaid', 'Is job par koi live payment nahi tha.');
      }
    } catch (e: any) {
      Alert.alert('Unpaid Nahi Ho Paya', e?.message || 'Payments reverse nahi ho paye.');
    } finally {
      await loadAll();
      await paymentsRefetch();
      queryClient.invalidateQueries();
      setMarkUnpaidSubmitting(false);
    }
  };

  const openPaymentModal = () => {
    const prefill = payRemaining > 0 ? String(Math.round(payRemaining * 100) / 100) : '';
    setPaymentAmount(prefill);
    setPaymentMethod('Cash');
    setPaymentKind(suggestPaymentKind(prefill));
    setPaymentKindTouched(false);
    setPaymentNote('');
    setPaymentReference('');
    setPaymentSuccess(null);
    setShowPayment(true);
  };

  const onPaymentAmountChange = (t: string) => {
    const clean = t.replace(/[^0-9.]/g, '');
    setPaymentAmount(clean);
    if (!paymentKindTouched) setPaymentKind(suggestPaymentKind(clean));
  };

  const handleCollectPayment = async () => {
    if (paymentSubmitRef.current || !paymentFormValid || paymentAmountCents === null) return;
    paymentSubmitRef.current = true;
    setUpdating(true);
    try {
      const res = await repairPaymentsCreate(repair.id, {
        amount: paymentAmountCents / 100,
        method: paymentMethod,
        kind: paymentKind as any,
        note: paymentNote.trim() || undefined,
        referenceNo: paymentReference.trim() || undefined,
      });
      // Immutable post-transaction snapshot for the success view + receipt
      setPaymentSuccess({
        amount: res.payment.amount,
        method: res.payment.method,
        kind: res.payment.kind,
        referenceNo: res.payment.referenceNo,
        createdAt: res.payment.createdAt,
        totalPaidAfter: (Math.round(payPaid * 100) + paymentAmountCents) / 100,
        remainingAfter: Math.max(0, payRemainingCents - paymentAmountCents) / 100,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await loadAll();
      await paymentsRefetch();
      queryClient.invalidateQueries();
    } catch (e: any) {
      Alert.alert('Payment Failed', e.message || 'Could not record payment.');
    } finally {
      paymentSubmitRef.current = false;
      setUpdating(false);
    }
  };

  const sharePaymentReceipt = async (print: boolean) => {
    if (!paymentSuccess) return;
    try {
      const html = `
        <html>
          <body style="font-family: sans-serif; padding: 24px; color: #111;">
            <h2 style="text-align: center; margin-bottom: 4px;">Avarpus</h2>
            <p style="text-align: center; margin-top: 0;">Payment Receipt</p>
            <hr />
            <p><strong>Ticket:</strong> ${repair.repairId}</p>
            <p><strong>Customer:</strong> ${repair.customerName} (${repair.mobile})</p>
            <p><strong>Device:</strong> ${repair.brand} ${repair.model}</p>
            <hr />
            <p><strong>Amount Received:</strong> ₹${paymentSuccess.amount}</p>
            <p><strong>Payment Method:</strong> ${paymentSuccess.method}</p>
            <p><strong>Payment Type:</strong> ${paymentSuccess.kind}</p>
            ${paymentSuccess.referenceNo ? `<p><strong>Reference:</strong> ${paymentSuccess.referenceNo}</p>` : ''}
            <p><strong>Date &amp; Time:</strong> ${formatDate(paymentSuccess.createdAt)}</p>
            <hr />
            <p><strong>Total Amount:</strong> ₹${payTotal}</p>
            <p><strong>Total Paid:</strong> ₹${paymentSuccess.totalPaidAfter}</p>
            <p><strong>Remaining:</strong> ₹${paymentSuccess.remainingAfter}</p>
          </body>
        </html>
      `;
      if (Platform.OS === 'web' || print) {
        await Print.printAsync({ html });
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
        } else {
          await Print.printAsync({ html });
        }
      }
    } catch {
      Alert.alert('Error', 'Could not generate the receipt.');
    }
  };

  const uploadToGcs = async (fileUri: string, mimeType: UploadUrlRequestContentType) => {
    try {
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      const size = fileInfo.exists ? fileInfo.size : 0;
      const name = fileUri.split('/').pop() || 'upload.png';
      const { uploadURL, objectPath } = await requestUploadUrl({ name, size, contentType: mimeType });
      const file = new ExpoFile(fileUri);
      const res = await expoFetch(uploadURL, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: file });
      if (!res.ok) throw new Error('Upload failed');
      return objectPath;
    } catch (err) {
      console.warn('Upload error', err);
      return null;
    }
  };

  const completeDelivery = async (markPaid: boolean) => {
    if (updating) return;
    if (markPaid && payRemainingCents > 0 && !canSeeFinance) {
      Alert.alert('Not Allowed', 'You do not have permission to record payments.');
      return;
    }
    setUpdating(true);
    let paymentRecorded = false;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (markPaid && payRemainingCents > 0) {
        await repairPaymentsCreate(repair.id, {
          amount: payRemainingCents / 100,
          method: handoverPaymentMethod,
          kind: 'final',
          note: 'Payment received at delivery',
        });
        paymentRecorded = true;
      }

      const deliveryDate = new Date().toISOString().split('T')[0];
      let warrantyExpiry = undefined;
      const wd = deliveryWarranty === 'Custom' ? parseInt(customWarrantyDays || '0') : parseInt(deliveryWarranty);
      if (wd > 0) {
        const exp = new Date();
        exp.setDate(exp.getDate() + wd);
        warrantyExpiry = exp.toISOString().split('T')[0];
      }

      await updateRepair({
        ...repair,
        status: 'delivered',
        deliveryDate,
        warrantyExpiry,
        warrantyDays: wd,
        paymentMethod: markPaid ? handoverPaymentMethod : repair.paymentMethod,
      }, repair);
      setShowDeliveryHandover(false);
      await paymentsRefetch();
      await loadAll();
      queryClient.invalidateQueries();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      if (paymentRecorded) {
        await paymentsRefetch();
        await loadAll();
        queryClient.invalidateQueries();
        Alert.alert('Payment Saved', 'Payment save ho gaya, lekin delivery complete nahi hui. Continue to Deliver dobara tap karein.');
      } else if (err?.message?.includes('APPROVAL_REQUIRED') || err?.code === 'APPROVAL_REQUIRED') {
         Alert.alert('Restricted', 'Dealer/Owner approval required to finalize this update.');
      } else if (err?.code === 'STAGE_INCOMPLETE' || err?.message?.includes('STAGE_INCOMPLETE')) {
         showIncompleteAlert(Array.isArray(err?.missing) ? err.missing : undefined);
      } else {
         Alert.alert('Update failed', err.message || "Couldn't mark the repair as delivered. Please try again.");
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleStatusUpdate = async (newStatus: string) => {
    if (newStatus === 'delivered') {
      setShowStatusPicker(false);
      setShowDeliveryHandover(true);
      return;
    }
    if (updating) return;
    setUpdating(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const updatedRepair = await updateRepair({
        ...repair,
        status: newStatus as RepairStatus,
      }, repair);
      setRepairSnapshot(updatedRepair);
      setShowStatusPicker(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      if (e?.code === 'STAGE_INCOMPLETE' || e?.message?.includes('STAGE_INCOMPLETE')) {
        setShowStatusPicker(false);
        setTimeout(() => showIncompleteAlert(Array.isArray(e?.missing) ? e.missing : undefined), 350);
      } else if (e?.code === 'INVALID_STATUS_TRANSITION' || e?.message?.includes('INVALID_STATUS_TRANSITION')) {
        setShowStatusPicker(false);
        setTimeout(() => Alert.alert('Complete the current task first.', 'Yeh stage abhi locked hai — workflow ke hisaab se pehle current stage complete karein.'), 350);
      } else if (e?.code === 'DEALER_RECEIPT_REQUIRED' || e?.data?.code === 'DEALER_RECEIPT_REQUIRED' || e?.message?.includes('DEALER_RECEIPT_REQUIRED')) {
        setShowStatusPicker(false);
        setTimeout(() => Alert.alert(
          'Confirm receipt first',
          `Mark the device as received from ${repair.sourceDealerBusinessName ?? 'the source dealer'} before changing its status.`,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open transaction', onPress: () => router.push(`/(tabs)/repairs/dealer-transactions/${repair.id}` as any) },
          ],
        ), 350);
      } else {
        Alert.alert('Update failed', e.message || "Couldn't update the repair status.");
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleAddPart = async () => {
    if (!selectedInventoryId && !partName) {
      Alert.alert('Required', 'Please select or enter a part name');
      return;
    }
    setUpdating(true);
    try {
      await repairPartsAdd(id as string, {
        inventoryItemId: selectedInventoryId || undefined,
        partName: selectedInventoryId ? undefined : partName,
        quantity: Number(partQty) || 1,
        unitCost: selectedInventoryId ? undefined : (Number(partCost) || 0),
      });
      setShowAddPart(false);
      setPartName('');
      setPartCost('');
      setSelectedInventoryId('');
      setPartQty('1');
      await partsRefetch();
      await loadAll();
      queryClient.invalidateQueries();
    } catch (e: any) {
      if (e.message?.includes('APPROVAL_REQUIRED') || e.code === 'APPROVAL_REQUIRED' || e?.data?.code === 'APPROVAL_REQUIRED') {
        Alert.alert('Restricted', 'Dealer/Owner approval required. Cannot add parts to a delivered/cancelled repair.');
      } else {
        Alert.alert('Add Part failed', e.message || 'Not enough stock?');
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveFinancials = async () => {
    setUpdating(true);
    try {
      await updateRepair({
        ...repair,
        repairCharge: Number(editRepairCharge),
        serviceCharge: Number(editServiceCharge),
        otherCharge: Number(editOtherCharge),
        discount: Number(editDiscount),
        taxPercent: Number(editTaxPercent)
      }, repair);
      setShowFinancialEdit(false);
      await loadAll();
      queryClient.invalidateQueries();
    } catch (e: any) {
      if (e.message?.includes('APPROVAL_REQUIRED') || e.code === 'APPROVAL_REQUIRED' || e?.data?.code === 'APPROVAL_REQUIRED') {
         Alert.alert('Restricted', 'Dealer/Owner approval required to modify financials of a delivered repair.');
      } else {
         Alert.alert('Error', e.message);
      }
    } finally {
      setUpdating(false);
    }
  };

  // Work notes shown newest first: note_added timeline events, then any
  // legacy structured fields older jobs still carry (read-only), then the
  // intake note. Portal viewers never see this card's composer.
  const canAddNote = !isReadOnlyPortal && canUpdateStatus;
  const workNotes: Array<{ id: string; kind: 'note' | 'legacy' | 'intake'; label?: string; text: string; meta?: string }> = [
    ...(eventsData?.events ?? [])
      .filter((ev) => ev.action === 'note_added' && typeof ev.details?.text === 'string' && ev.details.text)
      .map((ev) => ({
        id: ev.id,
        kind: 'note' as const,
        text: String(ev.details!.text),
        meta: `${ev.userName} · ${new Date(ev.createdAt).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', day: '2-digit', month: 'short' })}`,
      })),
    ...(repair.workPerformed?.trim() ? [{ id: 'legacy-work', kind: 'legacy' as const, label: 'WORK PERFORMED', text: repair.workPerformed.trim() }] : []),
    ...(repair.diagnosis?.trim() ? [{ id: 'legacy-diagnosis', kind: 'legacy' as const, label: 'DIAGNOSIS', text: repair.diagnosis.trim() }] : []),
    ...(repair.notes?.trim() ? [{ id: 'intake-note', kind: 'intake' as const, label: 'INTAKE NOTE', text: repair.notes.trim() }] : []),
  ];
  // The compact row only renders when there is something to read or add;
  // it never shows an empty "no notes" placeholder.
  const showNotesRow = canAddNote || workNotes.length > 0;

  // Dealer/owner only — permanently remove this repair and all its records.
  const confirmDeleteRepair = () => {
    confirm({
      title: 'Delete repair?',
      message: `${repair.repairId} and its payments, parts, photos and history will be removed for good.`,
      actions: [
        {
          label: 'Delete repair',
          description: 'Remove permanently with all its records',
          tone: 'destructive',
          onPress: handleDeleteRepair,
        },
      ],
    });
  };
  const handleDeleteRepair = async () => {
    if (updating) return;
    setUpdating(true);
    try {
      await deleteRepair(repair.id);
      queryClient.invalidateQueries();
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setUpdating(false);
    }
  };

  // Continue directly to the stage named on the primary button. Only the
  // intake record is gated (server mirrors this); work details are free
  // text notes and never block a stage change.
  const handleContinue = async () => {
    if (updating || !nextStep) return;
    if (stageMissing.length > 0) {
      showIncompleteAlert(stageMissing);
      return;
    }
    await handleStatusUpdate(nextStep.id);
  };

  const handleAddNote = async () => {
    const text = noteDraft.trim();
    if (!text || noteSaving) return;
    setNoteSaving(true);
    try {
      await repairNotesAdd(repair.id, { text });
      setNoteDraft('');
      await queryClient.invalidateQueries({ queryKey: getRepairEventsListQueryKey(repair.id) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Note not saved', e?.message || 'Could not save the note. Please try again.');
    } finally {
      setNoteSaving(false);
    }
  };

  const generatePDF = async () => {
    try {
      let qrBase64 = '';
      if (qrRef.current) {
        qrBase64 = await new Promise((resolve) => {
          qrRef.current.getDataURL((dataURL: string) => {
            resolve(`data:image/png;base64,${dataURL}`);
          });
        });
      }

      const html = `
        <html>
          <body style="font-family: sans-serif; padding: 20px;">
            <h1 style="text-align: center;">Avarpus - Job Card</h1>
            <hr />
            <div style="display: flex; justify-content: space-between;">
              <div>
                <p><strong>Ticket:</strong> ${repair.repairId}</p>
                <p><strong>Customer:</strong> ${repair.customerName} (${repair.mobile})</p>
                <p><strong>Device:</strong> ${repair.brand} ${repair.model}</p>
                <p><strong>Problem:</strong> ${repair.problem}</p>
                <p><strong>Estimate:</strong> ₹${repair.repairCharge}</p>
                <p><strong>Advance:</strong> ₹${repair.advance}</p>
                <p><strong>Warranty:</strong> ${repair.warrantyDays} Days</p>
              </div>
              <div>
                ${qrBase64 ? `<img src="${qrBase64}" width="150" height="150" />` : ''}
              </div>
            </div>
            <hr />
            <p><strong>Checklist:</strong></p>
            <ul>
              ${Object.keys(repair.checklist || {}).map(k => {
                const label = CHECKLIST_ITEMS.find(c => c.id === k)?.label || k;
                return `<li>${label}: ${repair.checklist?.[k] ? 'Pass' : 'Fail'}</li>`;
              }).join('')}
            </ul>
          </body>
        </html>
      `;
      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
        } else {
          await Print.printAsync({ html });
        }
      }
    } catch (e) {
      Alert.alert('Error', 'Could not generate PDF.');
    }
  };


  // ── Redesigned header cards: derived display state ──
  const isTerminalStatus = repair.status === 'cancelled' || repair.status === 'cannot_repair';
  const statusTone =
    isTerminalStatus ? colors.destructive
    : repair.status === 'delivered' ? colors.success
    : repair.status === 'ready' ? colors.warning
    : repair.status === 'received' ? colors.primary
    : colors.warning;
  const paymentStatusLabel = (payRemaining <= 0 && payTotal > 0) ? 'Paid' : payPaid > 0 ? 'Partially Paid' : 'Pending';
  const paymentTone = (payRemaining <= 0 && payTotal > 0) ? colors.success : colors.warning;

  // First moment a stage was reached, from the append-only event log; the
  // repair row's own timestamps are the fallback for older jobs.
  const statusEvents = (eventsData?.events ?? [])
    .filter((ev) => ev.action === 'status_changed')
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const stageReachedAt = (targets: string[], fallback?: string): string | undefined => {
    const hit = statusEvents.find((ev) => targets.includes(String(ev.details?.to ?? '')));
    return hit?.createdAt ?? fallback;
  };
  // Date-only values (receiveDate / deliveryDate) never get an invented time.
  const formatStamp = (iso?: string) => {
    if (!iso) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDate(iso);
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return formatDate(iso);
    const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    return `${formatDate(iso)}\n${time}`;
  };
  // A backdated intake shows its booked receive date; otherwise the exact creation moment.
  const receivedStamp = repair.receiveDate && formatDate(repair.receiveDate) !== formatDate(repair.createdAt) ? repair.receiveDate : repair.createdAt;
  // For a cancelled / cannot-repair job, only the stops actually reached
  // before the stop are ticked — taken from the terminal transition's origin.
  const stopForStatus = (status: string | undefined): number =>
    status === 'received' ? 0
    : ['diagnosing', 'waiting_parts', 'repairing', 'testing', 'customer_approval'].includes(status ?? '') ? 1
    : status === 'ready' ? 2
    : status === 'delivered' ? 3
    : 0;
  const terminalEvent = isTerminalStatus
    ? statusEvents.slice().reverse().find((ev) => ['cancelled', 'cannot_repair'].includes(String(ev.details?.to ?? '')))
    : undefined;
  const lastReachedStop = isTerminalStatus ? stopForStatus(terminalEvent ? String(terminalEvent.details?.from ?? '') : undefined) : -1;
  // Four visible stops over the five internal stages: testing is folded into
  // "In Progress" and terminal failures replace the Delivered stop.
  const currentStop = stageIndex <= 1 ? stageIndex : stageIndex === 2 ? 1 : stageIndex === 3 ? 2 : 3;
  const stageSteps = ([
    { key: 'received', label: 'Received', color: colors.success, reached: receivedStamp },
    { key: 'repairing', label: 'In Progress', color: colors.primary, reached: stageReachedAt(['diagnosing', 'waiting_parts', 'repairing'], repair.repairStartedAt) },
    { key: 'ready', label: 'Ready', color: colors.warning, reached: stageReachedAt(['ready'], repair.readyAt) },
    { key: 'delivered', label: 'Delivered', color: colors.purple, reached: stageReachedAt(['delivered'], repair.deliveryDate) },
  ] as const).map((step, index, arr) => {
    let state: 'completed' | 'current' | 'upcoming' | 'error' = 'upcoming';
    let label: string = step.label;
    if (isTerminalStatus) {
      if (index === arr.length - 1) { state = 'error'; label = repair.status === 'cancelled' ? 'Cancelled' : 'Failed'; }
      else state = index <= lastReachedStop ? 'completed' : 'upcoming';
    } else if (currentStop > index || (index === arr.length - 1 && repair.status === 'delivered')) state = 'completed';
    else if (currentStop === index) state = 'current';
    const sub =
      state === 'error' ? 'Stopped'
      : state === 'completed' ? (formatStamp(step.reached) || 'Done')
      : state === 'current' ? (index === 0 ? (formatStamp(step.reached) || 'Current Stage') : 'Current Stage')
      : 'Pending';
    return { ...step, label, state, sub };
  });

  // Device thumbnail: prefer the front shot, else the first photo on file.
  const devicePhoto = photosData?.photos?.find(p => p.kind === 'front') ?? photosData?.photos?.[0];
  // Anyone who may update the repair may attach photos to it.
  const canAddPhoto = canUpdateStatus;

  const copyMobile = async () => {
    if (!repair.mobile) return;
    try {
      await Clipboard.setStringAsync(repair.mobile);
      setMobileCopied(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTimeout(() => setMobileCopied(false), 1500);
    } catch {
      Alert.alert('Copy failed', 'Could not copy the mobile number.');
    }
  };

  const openPhotoFromSheet = (photo: { objectPath: string; kind: string }) => {
    // Sibling native Modals do not stack reliably on iOS: dismiss the sheet
    // first, then present the fullscreen viewer.
    setShowPhotos(false);
    setTimeout(() => setViewerImage({ uri: getAbsoluteUrl(photo.objectPath), label: photo.kind.replace(/_/g, ' ') }), 350);
  };

  const handleAddPhoto = async (source: 'camera' | 'library') => {
    if (photoUploading) return;
    // The native picker must not be presented on top of the sheet Modal.
    setShowPhotos(false);
    await new Promise<void>((resolve) => setTimeout(resolve, 350));
    try {
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', source === 'camera' ? 'Allow camera access to take a photo.' : 'Allow photo library access to pick a photo.');
        return;
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      setPhotoUploading(source);
      setShowPhotos(true);
      // Upload the bytes under their real type; the server re-verifies them.
      const mime = (asset.mimeType && asset.mimeType in UploadUrlRequestContentType && asset.mimeType !== 'application/pdf'
        ? asset.mimeType
        : 'image/jpeg') as UploadUrlRequestContentType;
      const objectPath = await uploadToGcs(asset.uri, mime);
      if (!objectPath) throw new Error('Upload failed. Please try again.');
      await repairPhotosAdd(repair.id, { kind: 'other', objectPath });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getRepairPhotosListQueryKey(repair.id) }),
        queryClient.invalidateQueries({ queryKey: getRepairEventsListQueryKey(repair.id) }),
      ]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setShowPhotos(true);
      Alert.alert('Photo not added', e?.message || 'Could not add the photo. Please try again.');
    } finally {
      setPhotoUploading(null);
    }
  };
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      {/* HEADER: back | title + subtitle | edit · more */}
      <View style={[styles.header, { paddingTop: topPad + 6, paddingBottom: 10 }]}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={[styles.roundBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 22, lineHeight: 26, color: colors.foreground, fontFamily: fontFamily.bold }} numberOfLines={1}>Repair Details</Text>
            <Text style={{ fontSize: 13, lineHeight: 16, color: colors.mutedForeground, fontFamily: fontFamily.regular }} numberOfLines={1}>Track and manage repair process</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit repair" onPress={() => setShowMore(true)} style={[styles.roundBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="edit-2" size={16} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="More actions" onPress={() => setShowMore(true)} style={[styles.roundBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="more-vertical" size={20} color={colors.foreground} />
            {/* Hidden QR Code for PDF Generation */}
            <View style={{ position: 'absolute', opacity: 0 }} pointerEvents="none">
               <QRCode value={repair.id} size={150} getRef={(c) => (qrRef.current = c)} />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAwareScrollViewCompat showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingTop: 6, paddingBottom: tabBarHeight + 16, paddingHorizontal: 16, gap: 10 }]} bottomOffset={24}>

        {/* ── CARD 1: status · customer · device ── */}
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Header band: status pill on the left, job code + created date right. */}
          <View style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.border + '55', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flexShrink: 1, minWidth: 0, backgroundColor: statusTone + '33', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 }}>
              <Text style={{ fontSize: 13, lineHeight: 17, color: statusTone, fontFamily: fontFamily.semibold }} numberOfLines={1}>{REPAIR_STATUS_LABELS[repair.status] || repair.status}</Text>
            </View>
            <Text style={{ flexShrink: 0, fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium }} numberOfLines={1}>
              {repair.repairId} · {formatDate(repair.createdAt)}
            </Text>
          </View>

          {/* Customer: avatar, name + Dealer/Customer tag, mobile + copy, call + chat */}
          <View style={{ paddingHorizontal: 12, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 22, color: '#FFFFFF', fontFamily: fontFamily.bold }}>{repair.customerName?.charAt(0).toUpperCase() || 'U'}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flexShrink: 1, fontSize: 16, lineHeight: 20, color: colors.foreground, fontFamily: fontFamily.bold }} numberOfLines={1}>{repair.customerName}</Text>
                <View style={{ flexShrink: 0, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: repair.dealerId ? colors.primary + '33' : colors.muted + '55' }}>
                  <Text style={{ fontSize: 13, lineHeight: 12, color: repair.dealerId ? colors.primary : colors.mutedForeground, fontFamily: fontFamily.bold, letterSpacing: 0.5 }}>
                    {repair.dealerId ? 'DEALER' : 'CUSTOMER'}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
                <Text style={{ flexShrink: 1, fontSize: 13, lineHeight: 16, color: colors.mutedForeground, fontFamily: fontFamily.medium }} numberOfLines={1}>{repair.mobile}</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Copy mobile number" onPress={copyMobile} hitSlop={8}>
                  <Feather name={mobileCopied ? 'check' : 'copy'} size={14} color={mobileCopied ? colors.success : colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Call customer" onPress={() => Linking.openURL(`tel:${repair.mobile}`)} style={[styles.contactBtn, { backgroundColor: colors.primary + '1F', borderColor: colors.primary + '55' }]}>
                <Feather name="phone" size={17} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Message customer" onPress={() => Linking.openURL(`sms:${repair.mobile}`)} style={[styles.contactBtn, { backgroundColor: colors.primary + '1F', borderColor: colors.primary + '55' }]}>
                <Feather name="message-square" size={17} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Received From (dealer-to-dealer transfer, receiving side) */}
          {!!repair.sourceDealerShopId && (
            <TouchableOpacity
              onPress={() => router.push(`/(tabs)/repairs/dealer-transactions/${repair.id}` as any)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Open dealer transaction"
              testID="repair-received-from"
              style={{ marginHorizontal: 12, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.background + '66', flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary + '1A', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="briefcase" size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, letterSpacing: 0.3 }}>RECEIVED FROM</Text>
                <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: fontFamily.semibold }} numberOfLines={1}>
                  {repair.sourceDealerBusinessName}
                  {repair.sourceRepairTicket ? ` · their ticket ${repair.sourceRepairTicket}` : ''}
                </Text>
                <Text style={{ fontSize: 13, color: repair.sourceDealerReceivedAt ? colors.success : colors.warning, fontFamily: fontFamily.semibold, marginTop: 1 }} numberOfLines={2}>
                  {repair.sourceDealerReceivedAt
                    ? `Received by ${repair.receivedByName ?? 'your shop'} on ${formatDate(repair.sourceDealerReceivedAt)}`
                    : 'Waiting for acceptance — confirm receipt before starting work'}
                  {repair.transactionCode ? ` · ${repair.transactionCode}` : ''}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}

          {/* Sent to another dealer (sending side) */}
          {!!repair.transfer && (
            <TouchableOpacity
              onPress={() => router.push(`/(tabs)/repairs/dealer-transactions/request/${repair.transfer!.requestId}` as any)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Open transfer request"
              testID="repair-transfer-state"
              style={{ marginHorizontal: 12, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.background + '66', flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary + '1A', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="send" size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, letterSpacing: 0.3 }}>SENT TO DEALER</Text>
                <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: fontFamily.semibold }} numberOfLines={1}>{repair.transfer.receiverBusinessName}</Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: repair.transfer.status === 'pending' ? colors.warning : repair.transfer.status === 'accepted' ? colors.success : colors.destructive,
                    fontFamily: fontFamily.semibold,
                    marginTop: 1,
                  }}
                  numberOfLines={2}
                >
                  {repair.transfer.status === 'pending'
                    ? `Waiting for ${repair.transfer.receiverBusinessName} to accept`
                    : repair.transfer.status === 'accepted'
                      ? `Accepted${repair.transfer.resultStatus ? ` · ${repair.transfer.resultStatus.replace(/_/g, ' ')}` : ''}`
                      : repair.transfer.status === 'declined'
                        ? 'Declined — you can send it again'
                        : 'Request cancelled'}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}

          {/* Device sub-card: thumbnail · DEVICE / Model / IMEI | PROBLEM · View Details */}
          <View style={{ margin: 12, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background + '66', flexDirection: 'row', alignItems: 'stretch', gap: 12 }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={devicePhoto ? 'View device photo' : 'Device photos'}
              onPress={() => (devicePhoto ? setViewerImage({ uri: getAbsoluteUrl(devicePhoto.objectPath), label: devicePhoto.kind.replace(/_/g, ' ') }) : setShowPhotos(true))}
              activeOpacity={0.8}
              style={{ width: 50, height: 82, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.muted + '44', borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
            >
              {devicePhoto ? (
                <Image source={{ uri: getAbsoluteUrl(devicePhoto.objectPath), headers: { Authorization: `Bearer ${token}` } }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <Feather name="smartphone" size={24} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>
            <View style={{ flex: 1, minWidth: 0, flexDirection: 'row' }}>
              <View style={{ flex: 1.3, minWidth: 0, paddingRight: 6, justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ fontSize: 13, lineHeight: 14, color: colors.mutedForeground, fontFamily: fontFamily.semibold, letterSpacing: 0.5 }}>DEVICE</Text>
                  <Text style={{ fontSize: 18, lineHeight: 22, color: colors.foreground, fontFamily: fontFamily.bold, marginTop: 4 }} numberOfLines={1}>{[repair.brand, repair.model].filter(Boolean).join(' ') || repair.deviceType || '—'}</Text>
                </View>
                {/* Model on its own line, IMEI directly beneath it (never side by side). */}
                <View style={{ gap: 2 }}>
                  <Text style={{ fontSize: 13, lineHeight: 15, color: colors.mutedForeground, fontFamily: fontFamily.regular }} numberOfLines={1}>
                    Model <Text style={{ color: colors.foreground, fontFamily: fontFamily.medium }}>{repair.model?.trim() || '—'}</Text>
                  </Text>
                  <Text style={{ fontSize: 13, lineHeight: 15, color: colors.mutedForeground, fontFamily: fontFamily.regular }} numberOfLines={1} testID="device-imei">
                    IMEI <Text style={{ color: colors.foreground, fontFamily: fontFamily.medium }}>{repair.imei?.trim() || '—'}</Text>
                  </Text>
                </View>
              </View>
              <View style={{ width: 1, backgroundColor: colors.border, marginRight: 10 }} />
              <View style={{ flex: 1, minWidth: 0, justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ fontSize: 13, lineHeight: 14, color: colors.mutedForeground, fontFamily: fontFamily.semibold, letterSpacing: 0.5 }}>PROBLEM</Text>
                  <Text style={{ fontSize: 16, lineHeight: 20, color: colors.foreground, fontFamily: fontFamily.semibold, marginTop: 4 }} numberOfLines={1}>{repair.problem?.trim() || '—'}</Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="View full device details"
                  onPress={() => setShowMore(true)}
                  style={{ alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.background }}
                >
                  <Text style={{ flexShrink: 1, fontSize: 13, lineHeight: 15, color: colors.foreground, fontFamily: fontFamily.semibold }} numberOfLines={1}>View Details</Text>
                  <Feather name="chevron-right" size={13} color={colors.foreground} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* ── CARD 2: repair status timeline ── */}
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30, marginBottom: 12 }}>
            <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: fontFamily.bold, letterSpacing: 0.3 }}>REPAIR STATUS</Text>
            {canUpdateStatus && nextStep && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Update status"
                testID="update-status-button"
                onPress={() => setShowStatusPicker(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.primary + '1F', borderWidth: 1, borderColor: colors.primary + '66' }}
              >
                <Feather name="edit-2" size={12} color={colors.primary} />
                <Text style={{ fontSize: 13, lineHeight: 15, color: colors.primary, fontFamily: fontFamily.semibold }}>Update Status</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            {stageSteps.map((step, index, arr) => {
              const isCompleted = step.state === 'completed';
              const isCurrent = step.state === 'current';
              const isError = step.state === 'error';
              const tone = isError ? colors.destructive : step.color;
              const leftFilled = index > 0 && (isCompleted || isCurrent);
              const rightFilled = index < arr.length - 1 && isCompleted;
              return (
                <View key={step.key} style={{ flex: 1, alignItems: 'center' }} testID={`stage-${step.key}-${step.state}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                    <View style={{ flex: 1, height: 2.5, borderRadius: 2, backgroundColor: index === 0 ? 'transparent' : leftFilled ? arr[index - 1].color : colors.border }} />
                    {/* Outer ring in the stage colour; reached stages get a filled
                        centre with a white glyph (check = done, dot = current). */}
                    <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 2, borderColor: tone }}>
                      {(isCompleted || isCurrent || isError) && (
                        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: tone, alignItems: 'center', justifyContent: 'center' }}>
                          {isCompleted ? <Feather name="check" size={12} color="#FFFFFF" />
                            : isError ? <Feather name="x" size={12} color="#FFFFFF" />
                            : <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#FFFFFF' }} />}
                        </View>
                      )}
                    </View>
                    <View style={{ flex: 1, height: 2.5, borderRadius: 2, backgroundColor: index === arr.length - 1 ? 'transparent' : rightFilled ? tone : colors.border }} />
                  </View>
                  <Text style={{ fontSize: 13.5, lineHeight: 15, color: isError ? colors.destructive : colors.foreground, marginTop: 7, fontFamily: fontFamily.semibold, textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{step.label}</Text>
                  <Text style={{ fontSize: 13, lineHeight: 14, color: isCurrent ? colors.primary : isCompleted ? colors.mutedForeground : isError ? colors.destructive : tone, marginTop: 2, fontFamily: fontFamily.medium, textAlign: 'center' }} numberOfLines={2}>{step.sub}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── CARD 3: estimate & payment (warranty for staff who cannot see money) ── */}
        {canSeeFinance ? (
          <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30, marginBottom: 10 }}>
              <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 8 }}>
                <Text style={{ flexShrink: 1, fontSize: 14, color: colors.foreground, fontFamily: fontFamily.bold, letterSpacing: 0.3 }} numberOfLines={1}>ESTIMATE & PAYMENT</Text>
                <View style={{ flexShrink: 0, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: paymentTone + '33' }}>
                  <Text style={{ fontSize: 13, lineHeight: 15, fontFamily: fontFamily.semibold, color: paymentTone }}>{paymentStatusLabel}</Text>
                </View>
              </View>
              {/* Charges on a delivered/closed job may only be corrected by the
                  dealer/owner — the server rejects staff edits there anyway. */}
              {(isActiveRepair || isDealer) && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Edit estimate"
                  onPress={() => {
                    setEditRepairCharge(repair.repairCharge.toString());
                    setEditServiceCharge((repair.serviceCharge || 0).toString());
                    setEditOtherCharge((repair.otherCharge || 0).toString());
                    setEditDiscount((repair.discount || 0).toString());
                    setEditTaxPercent((repair.taxPercent || 0).toString());
                    setShowFinancialEdit(true);
                  }}
                  hitSlop={8}
                  style={{ flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                >
                  <Feather name="edit-2" size={14} color={colors.primary} />
                  <Text style={{ fontSize: 13, color: colors.primary, fontFamily: fontFamily.semibold }}>Edit Estimate</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
              {[
                { label: 'Estimate', value: formatCurrency(payTotal), color: colors.foreground, icon: colors.primary },
                { label: 'Paid', value: formatCurrency(payPaid), color: colors.success, icon: colors.success },
                { label: 'Balance', value: formatCurrency(payRemaining), color: payRemaining > 0 ? colors.warning : colors.primary, icon: payRemaining > 0 ? colors.warning : colors.primary },
              ].map((cell, idx) => (
                <View key={cell.label} style={{ flex: 1, minWidth: 0, alignItems: idx === 0 ? 'flex-start' : idx === 1 ? 'center' : 'flex-end', borderLeftWidth: idx === 0 ? 0 : 1, borderLeftColor: colors.border, paddingLeft: idx === 0 ? 0 : 8 }}>
                  <Text style={{ fontSize: 13, lineHeight: 15, color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 6 }}>{cell.label}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                    <MaterialCommunityIcons name="database" size={20} color={cell.icon} />
                    <Text style={{ flexShrink: 1, fontSize: 20, lineHeight: 24, color: cell.color, fontFamily: fontFamily.bold }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{cell.value}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
            <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: fontFamily.bold, letterSpacing: 0.3 }}>WARRANTY</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium }}>
              {`${repair.warrantyDays || 0} Days`}{repair.warrantyExpiry ? ` · till ${formatDate(repair.warrantyExpiry)}` : ''}
            </Text>
          </View>
        )}

        {/* ── Quick tiles: Work Notes | Photos | Details & History ── */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {showNotesRow && (
            <TouchableOpacity
              testID="work-notes-row"
              accessibilityRole="button"
              accessibilityLabel={workNotes.length > 0 ? `Work Notes, ${workNotes.length}` : 'Work Notes'}
              onPress={() => setShowNotes(true)}
              activeOpacity={0.8}
              style={[styles.tile, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.tileIcon, { backgroundColor: colors.primary + '1F' }]}>
                <MaterialCommunityIcons name="file-document-edit-outline" size={26} color={colors.primary} />
                {workNotes.length > 0 && (
                  <View style={[styles.tileBadge, { backgroundColor: colors.primary, borderColor: colors.card }]}>
                    <Text style={{ fontSize: 13, lineHeight: 12, color: '#FFF', fontFamily: fontFamily.bold }}>{workNotes.length}</Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: '100%' }}>
                <Text style={{ flexShrink: 1, fontSize: 13, lineHeight: 15, letterSpacing: -0.2, color: colors.foreground, fontFamily: fontFamily.semibold }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Work Notes</Text>
                <Feather name="chevron-right" size={13} color={colors.foreground} />
              </View>
              <Text style={{ fontSize: 13, lineHeight: 14, color: colors.mutedForeground, fontFamily: fontFamily.regular }} numberOfLines={1}>{canAddNote ? 'Add / View notes' : 'View notes'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            testID="photos-tile"
            accessibilityRole="button"
            accessibilityLabel={photosData?.photos?.length ? `Photos, ${photosData.photos.length}` : 'Photos'}
            onPress={() => setShowPhotos(true)}
            activeOpacity={0.8}
            style={[styles.tile, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.tileIcon, { backgroundColor: colors.primary + '1F' }]}>
              <MaterialCommunityIcons name="image-outline" size={26} color={colors.primary} />
              {!!photosData?.photos?.length && (
                <View style={[styles.tileBadge, { backgroundColor: colors.primary, borderColor: colors.card }]}>
                  <Text style={{ fontSize: 13, lineHeight: 12, color: '#FFF', fontFamily: fontFamily.bold }}>{photosData.photos.length}</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: '100%' }}>
              <Text style={{ flexShrink: 1, fontSize: 13, lineHeight: 15, letterSpacing: -0.2, color: colors.foreground, fontFamily: fontFamily.semibold }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Photos</Text>
              <Feather name="chevron-right" size={13} color={colors.foreground} />
            </View>
            <Text style={{ fontSize: 13, lineHeight: 14, color: colors.mutedForeground, fontFamily: fontFamily.regular }} numberOfLines={1}>{canAddPhoto ? 'View / Add photos' : 'View photos'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="details-history-tile"
            accessibilityRole="button"
            accessibilityLabel="Details & History"
            onPress={() => setShowMore(true)}
            activeOpacity={0.8}
            style={[styles.tile, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.tileIcon, { backgroundColor: colors.primary + '1F' }]}>
              <MaterialCommunityIcons name="history" size={26} color={colors.primary} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: '100%' }}>
              <Text style={{ flexShrink: 1, fontSize: 13, lineHeight: 15, letterSpacing: -0.2, color: colors.foreground, fontFamily: fontFamily.semibold }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Details & History</Text>
              <Feather name="chevron-right" size={13} color={colors.foreground} />
            </View>
            <Text style={{ fontSize: 13, lineHeight: 14, color: colors.mutedForeground, fontFamily: fontFamily.regular }} numberOfLines={1}>View timeline</Text>
          </TouchableOpacity>
        </View>


        {/* 7. CUSTOMER APPROVAL — only when actually required */}
        {canSeeFinance && (approvals.length > 0 || repair.status === 'customer_approval') && (
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 8 }]}>CUSTOMER APPROVAL</Text>
            {approvals.length === 0 && (
              <>
                <InfoRow label="Amount" value={formatCurrency(repair.repairCharge + repair.partsCharge)} bold />
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>Status</Text>
                  <Text style={{ fontSize: 13, color: colors.warning, fontFamily: fontFamily.semibold }}>Pending</Text>
                </View>
                {isActiveRepair && (
                  <Button title="Send Approval Request" onPress={() => setShowApproval(true)} style={{ marginTop: 10 }} />
                )}
              </>
            )}
            {approvals.map(app => (
              <View key={app.id} style={{ paddingVertical: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: fontFamily.semibold }}>₹{app.oldAmount} → ₹{app.newAmount}</Text>
                  <Text style={{ fontSize: 13, color: app.status === 'pending' ? colors.warning : app.status === 'approved' ? colors.success : colors.destructive, textTransform: 'uppercase', fontFamily: fontFamily.bold }}>{app.status}</Text>
                </View>
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{app.reason}</Text>

                {app.status === 'pending' && (
                  <View style={{ marginTop: 10, gap: 10 }}>
                    {showOtp ? (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TextInput value={otpCode} onChangeText={setOtpCode} keyboardType="numeric" placeholder="OTP Code" style={[styles.input, { flex: 1, height: 36, minHeight: 36, color: colors.foreground, borderColor: colors.border }]} />
                        <Button title="Verify" onPress={async () => {
                          if (!otpCode) return;
                          try {
                            await estimateApprovalsDecide(app.id, { decision: 'approved', method: 'otp', otpCode: otpCode });
                            setShowOtp(false);
                            setOtpCode('');
                            await loadAll();
                            await approvalsRefetch();
                            queryClient.invalidateQueries();
                          } catch (e: any) { Alert.alert('Error', e.message); }
                        }} size="sm" />
                        <Button title="Cancel" variant="outline" onPress={() => setShowOtp(false)} size="sm" />
                      </View>
                    ) : (
                      <>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Button title="Approve" onPress={async () => {
                            try {
                              await estimateApprovalsDecide(app.id, { decision: 'approved', method: 'dealer' });
                              await loadAll();
                              await approvalsRefetch();
                              queryClient.invalidateQueries();
                            } catch (e: any) { Alert.alert('Error', e.message); }
                          }} size="sm" style={{ flex: 1 }} />
                          <Button title="Reject" variant="outline" onPress={async () => {
                            try {
                              await estimateApprovalsDecide(app.id, { decision: 'rejected', method: 'dealer' });
                              await loadAll();
                              await approvalsRefetch();
                              queryClient.invalidateQueries();
                            } catch (e: any) { Alert.alert('Error', e.message); }
                          }} size="sm" style={{ flex: 1 }} />
                        </View>
                        <Button title="Send OTP to Customer" variant="outline" onPress={async () => {
                          try {
                            await estimateApprovalsSendOtp(app.id);
                            setShowOtp(true);
                          } catch (e: any) { Alert.alert('Error', e.message); }
                        }} size="sm" />
                      </>
                    )}
                  </View>
                )}
              </View>
            ))}
          </Card>
        )}

        {/* 8. PARTS REPLACED — only when parts exist */}
        {parts.length > 0 && (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium }]}>PARTS REPLACED</Text>
              {isActiveRepair && (
                <TouchableOpacity onPress={() => setShowAddPart(true)}>
                  <Feather name="plus-circle" size={16} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
            {parts.map((p, idx) => (
              <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: idx === parts.length - 1 ? 0 : 1, borderBottomColor: colors.border + '55' }}>
                <View>
                  <Text style={{ fontSize: 13, color: colors.foreground }}>{p.partName}</Text>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Qty: {p.quantity} {p.canSeeCosts !== false ? `@ ${formatCurrency(p.unitCost)}` : ''}</Text>
                </View>
                {p.canSeeCosts !== false && (
                  <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: fontFamily.semibold }}>{formatCurrency(p.quantity * p.unitCost)}</Text>
                )}
              </View>
            ))}
          </Card>
        )}

      {/* PRIMARY ACTION — intentionally at the end of the scroll content */}
      {/* Delivered jobs show nothing here: owner corrections (money, charges,
          mark unpaid, delete) live in the pencil sheet. */}
      {repair.status !== 'delivered' && (
      <View>
        {(repair.status === 'cancelled' || repair.status === 'cannot_repair') ? (
          <View style={[styles.doneBar, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '44' }]}>
            <Feather name="x-circle" size={18} color={colors.destructive} />
            <Text style={{ fontSize: 15, color: colors.destructive, fontFamily: fontFamily.bold }}>{repair.status === 'cancelled' ? 'CANCELLED' : 'CANNOT REPAIR'}</Text>
          </View>
        ) : (
          canUpdateStatus && nextStep ? (
            <TouchableOpacity
              testID="continue-button"
              accessibilityRole="button"
              accessibilityLabel={continueButtonLabel}
              accessibilityState={{ busy: updating, disabled: updating }}
              onPress={() => { if (!updating) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); handleContinue(); } }}
              activeOpacity={0.85}
              style={[styles.primaryCta, { backgroundColor: colors.primary, opacity: updating ? 0.85 : 1 }]}
            >
              {/* Icon + label sit centred as one group; the chevron hugs the right edge. */}
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 }}>
                <MaterialCommunityIcons name="cog" size={22} color="#FFFFFF" />
                <Text style={{ flexShrink: 1, fontSize: 17, lineHeight: 21, color: '#FFFFFF', fontFamily: fontFamily.bold }} numberOfLines={1}>{continueButtonLabel}</Text>
              </View>
              <View style={{ position: 'absolute', right: 20, top: 0, bottom: 0, justifyContent: 'center' }}>
                {updating ? <AvarpusSpinner size={22} color="#FFFFFF" /> : <Feather name="chevron-right" size={22} color="#FFFFFF" />}
              </View>
            </TouchableOpacity>
          ) : null
        )}
      </View>
      )}
      </KeyboardAwareScrollViewCompat>

      {/* Update Status — next step only */}
      <Modal visible={showStatusPicker} animationType="slide" transparent onRequestClose={() => setShowStatusPicker(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetContent, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Update Status</Text>
            {nextStep ? (
              <TouchableOpacity
                onPress={() => {
                  if (nextStepBlocked) {
                    showIncompleteAlert();
                    return;
                  }
                  handleStatusUpdate(nextStep.id);
                }}
                disabled={updating}
                style={{ borderWidth: 1, borderColor: nextStepBlocked ? colors.border : colors.primary, backgroundColor: nextStepBlocked ? colors.card : colors.primary + '15', borderRadius: 12, padding: 16, marginBottom: 12, opacity: nextStepBlocked ? 0.6 : 1 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {nextStepBlocked && <Feather name="lock" size={14} color={colors.mutedForeground} />}
                  <Text style={{ fontSize: 16, color: nextStepBlocked ? colors.mutedForeground : colors.primary, fontFamily: fontFamily.bold }}>{nextStep.label}</Text>
                </View>
                <Text style={{ fontSize: 13, color: nextStepBlocked ? colors.destructive : colors.mutedForeground, marginTop: 2 }}>
                  {nextStepBlocked ? `Please complete this step first: ${stageMissing.join(', ')}` : nextStep.desc}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 12 }}>No further status available.</Text>
            )}
            {repair.status === 'testing' && (
              <TouchableOpacity
                onPress={() => handleStatusUpdate('repairing')}
                disabled={updating}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 12 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather name="rotate-ccw" size={14} color={colors.foreground} />
                  <Text style={{ fontSize: 15, color: colors.foreground, fontFamily: fontFamily.semibold }}>Back to Repairing</Text>
                </View>
                <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 2 }}>Test fail hua? Job wapas repairing mein bhejein aur note likhein.</Text>
              </TouchableOpacity>
            )}
            {isActiveRepair && (user?.role === 'dealer' || user?.role === 'super_admin') && (
              <TouchableOpacity
                onPress={() => {
                  confirm({
                    title: 'Cancel repair job?',
                    message: `${repair.repairId} will be marked as cancelled.`,
                    icon: 'x-circle',
                    actions: [
                      {
                        label: 'Yes, cancel job',
                        description: 'Mark this repair as cancelled',
                        icon: 'x-circle',
                        tone: 'destructive',
                        onPress: () => handleStatusUpdate('cancelled'),
                      },
                    ],
                    cancelLabel: 'No, keep it',
                  });
                }}
                style={{ borderWidth: 1, borderColor: colors.destructive + '55', borderRadius: 12, padding: 12, marginBottom: 12, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 13, color: colors.destructive, fontFamily: fontFamily.medium }}>Cancel Repair Job</Text>
              </TouchableOpacity>
            )}
            <Button title="Cancel" variant="outline" onPress={() => setShowStatusPicker(false)} />
          </View>
        </View>
        <ConfirmDialogHost />
      </Modal>

      {/* MORE — full details & history */}
      <Modal visible={showMore} animationType="slide" onRequestClose={() => setShowMore(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.header, { paddingTop: topPad + 14 }]}>
            <TouchableOpacity onPress={() => setShowMore(false)} style={styles.backBtn}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={{ fontSize: 17, color: colors.foreground, fontFamily: fontFamily.bold }}>{repair.repairId} — Details</Text>
            <View style={{ width: 44 }} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>

            {/* Job Info */}
            <Card style={{ paddingHorizontal: 16 }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 4 }]}>JOB INFO</Text>
              <SummaryRow icon="star" label="Priority" value="" rightElement={<PriorityBadge priority={repair.priority} />} />
              <SummaryRow icon="clock" label="Received" value={formatDate(repair.receiveDate)} />
              <SummaryRow icon="calendar" label="Expected" value={formatDate(repair.expectedDate)} />
              {repair.repairStartedAt && <SummaryRow icon="play" label="Started" value={new Date(repair.repairStartedAt).toLocaleDateString()} />}
              {repair.repairCompletedAt && <SummaryRow icon="check-square" label="Completed" value={new Date(repair.repairCompletedAt).toLocaleDateString()} />}
              {repair.deliveryDate && <SummaryRow icon="check-circle" label="Delivered" value={formatDate(repair.deliveryDate)} />}
              <SummaryRow icon="user" label="Received By" value={repair.receivedByName || 'System'} />
              {repair.status === 'delivered' && <SummaryRow icon="user-check" label="Delivered By" value={repair.deliveredByName || 'N/A'} />}
              <SummaryRow icon="tool" label="Technician" value={repair.technicianName || 'Unassigned'} rightElement={((user?.role === 'dealer' || user?.role === 'super_admin') && isActiveRepair) ? <TouchableOpacity onPress={() => { setShowMore(false); setTimeout(() => setShowAssign(true), 350); }}><Feather name="edit" size={14} color={colors.primary}/></TouchableOpacity> : null} />
              <SummaryRow icon="shield" label="Warranty" value={`${repair.warrantyDays || 0} Days${repair.warrantyExpiry ? ` (Till ${formatDate(repair.warrantyExpiry)})` : ''}`} />
            </Card>

            {/* Owner controls on a delivered job: money summary, mark paid,
                edit charges. Mark-unpaid and delete sit beside Invoice below.
                Staff never see this card. */}
            {repair.status === 'delivered' && isDealer && canSeeFinance && (
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium }]}>OWNER CONTROLS</Text>
                  <Text style={{ fontSize: 13, color: (payRemaining <= 0 && payTotal > 0) ? colors.success : payPaid > 0 ? colors.warning : colors.mutedForeground, fontFamily: fontFamily.semibold }}>
                    {(payRemaining <= 0 && payTotal > 0) ? 'PAID' : payPaid > 0 ? 'PARTIALLY PAID' : 'UNPAID'}
                  </Text>
                </View>
                <InfoRow label="Total" value={formatCurrency(payTotal)} bold />
                <InfoRow label="Paid" value={formatCurrency(payPaid)} color={colors.success} />
                <InfoRow label="Balance" value={formatCurrency(payRemaining)} color={payRemaining > 0 ? colors.warning : colors.success} bold />
                {payRemainingCents > 0 && (
                  <View style={{ marginTop: 10 }}>
                    <Button title="Mark as Paid" variant="outline" onPress={() => { setShowMore(false); setTimeout(openPaymentModal, 350); }} />
                  </View>
                )}
                <TouchableOpacity
                  onPress={() => {
                    setEditRepairCharge(repair.repairCharge.toString());
                    setEditServiceCharge((repair.serviceCharge || 0).toString());
                    setEditOtherCharge((repair.otherCharge || 0).toString());
                    setEditDiscount((repair.discount || 0).toString());
                    setEditTaxPercent((repair.taxPercent || 0).toString());
                    setShowMore(false);
                    setTimeout(() => setShowFinancialEdit(true), 350);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}
                >
                  <Feather name="edit-2" size={13} color={colors.primary} />
                  <Text style={{ fontSize: 13, color: colors.primary, fontFamily: fontFamily.medium }}>Edit Price & Charges</Text>
                </TouchableOpacity>
              </Card>
            )}

            {/* Full Device Details */}
            <Card>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium }]}>FULL DEVICE DETAILS</Text>
              <InfoRow label="Brand & Model" value={`${repair.deviceType ? repair.deviceType + ' - ' : ''}${repair.brand} ${repair.model}`} bold />
              {[repair.color, repair.storage, repair.ram].filter(Boolean).length > 0 && <InfoRow label="Color / Storage / RAM" value={[repair.color, repair.storage, repair.ram].filter(Boolean).join(' / ')} />}
              {repair.imei ? <InfoRow label="IMEI 1" value={repair.imei} /> : null}
              {repair.imei2 ? <InfoRow label="IMEI 2" value={repair.imei2} /> : null}
              {repair.serialNumber ? <InfoRow label="Serial No" value={repair.serialNumber} /> : null}
              {(repair.simPresent || repair.memoryCardPresent) ? (
                <InfoRow
                  label={repair.simPresent && repair.memoryCardPresent ? 'SIM / SD Card' : repair.simPresent ? 'SIM Card' : 'SD Card'}
                  value={[repair.simPresent && 'SIM: Yes', repair.memoryCardPresent && 'SD: Yes'].filter(Boolean).join(' · ')}
                />
              ) : null}
              {repair.alternateMobile ? <InfoRow label="Alternate Mobile" value={repair.alternateMobile} /> : null}
              {(repair.accessoriesList?.length || repair.accessories) ? <InfoRow label="Accessories" value={(repair.accessoriesList?.length ? repair.accessoriesList.join(', ') : '') + (repair.accessories ? ` ${repair.accessories}` : '')} /> : null}
              {repair.status === 'delivered' && repair.paymentMethod ? <InfoRow label="Payment Method" value={repair.paymentMethod} /> : null}
            </Card>

            {/* Condition Checklist */}
            {(Object.keys(repair.checklist || {}).length > 0 || Object.values(repair.physicalCondition || {}).some(Boolean)) && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 12 }]}>CONDITION CHECKLIST (At Intake)</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {Object.keys(repair.checklist || {}).map(k => {
                    const isWorking = repair.checklist![k];
                    return (
                      <View key={k} style={{ padding: 8, borderRadius: 8, backgroundColor: isWorking ? colors.success + '15' : colors.destructive + '15', borderWidth: 1, borderColor: isWorking ? colors.success + '33' : colors.destructive + '33', width: '31%' }}>
                        <Text style={{ fontSize: 13, color: isWorking ? colors.success : colors.destructive, fontFamily: fontFamily.medium }} numberOfLines={1}>{CHECKLIST_ITEMS.find(c => c.id === k)?.label || k}</Text>
                        <Text style={{ fontSize: 13, color: isWorking ? colors.success : colors.destructive }}>{isWorking ? 'Working' : 'Not Working'}</Text>
                      </View>
                    );
                  })}
                  {Object.keys(repair.physicalCondition || {}).map(k => {
                    if (!repair.physicalCondition![k]) return null;
                    return (
                      <View key={k} style={{ padding: 8, borderRadius: 8, backgroundColor: colors.warning + '15', borderWidth: 1, borderColor: colors.warning + '33', width: '31%' }}>
                        <Text style={{ fontSize: 13, color: colors.warning, fontFamily: fontFamily.medium }} numberOfLines={1}>Body</Text>
                        <Text style={{ fontSize: 13, color: colors.warning }}>{k.replace(/_/g, ' ')}</Text>
                      </View>
                    );
                  })}
                </View>
              </Card>
            )}

            {/* Work / Parts */}
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium }]}>PARTS REPLACED</Text>
                {isActiveRepair && (
                  <TouchableOpacity onPress={() => { setShowMore(false); setTimeout(() => setShowAddPart(true), 350); }}>
                    <Feather name="plus-circle" size={16} color={colors.primary} />
                  </TouchableOpacity>
                )}
              </View>
              {parts.length === 0 ? (
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>No parts recorded.</Text>
              ) : (
                <>
                  {parts.map((p, idx) => (
                    <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: idx === parts.length - 1 ? 0 : 1, borderBottomColor: colors.border + '55' }}>
                      <View>
                        <Text style={{ fontSize: 13, color: colors.foreground }}>{p.partName}</Text>
                        <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Qty: {p.quantity} {p.canSeeCosts !== false ? `@ ${formatCurrency(p.unitCost)}` : ''}</Text>
                      </View>
                      {p.canSeeCosts !== false && (
                        <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: fontFamily.semibold }}>{formatCurrency(p.quantity * p.unitCost)}</Text>
                      )}
                    </View>
                  ))}
                </>
              )}
            </Card>

            {/* Payment Summary (finance only) */}
            {canSeeFinance && (
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium }]}>PAYMENT SUMMARY</Text>
                  {(() => {
                    const ps = (repair as any).paymentStatus as string | undefined;
                    const label = ps === 'paid' ? 'PAID' : ps === 'partial' ? 'PARTIAL' : ps === 'overpaid' ? 'OVERPAID' : 'UNPAID';
                    const c = ps === 'paid' ? colors.success : ps === 'partial' ? colors.warning : ps === 'overpaid' ? colors.primary : colors.destructive;
                    return (
                      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: c + '1E', borderWidth: 1, borderColor: c + '55' }}>
                        <Text style={{ fontSize: 13, color: c, fontFamily: fontFamily.bold, letterSpacing: 0.5 }}>{label}</Text>
                      </View>
                    );
                  })()}
                </View>
                {(repair as any).estimatedCost !== undefined && (repair as any).estimatedCost !== null && (
                  <InfoRow label="Estimate (Intake)" value={formatCurrency((repair as any).estimatedCost)} />
                )}
                <InfoRow label="Final Bill" value={formatCurrency(payTotal)} bold />
                <InfoRow label="Paid" value={formatCurrency(payPaid)} color={colors.success} />
                <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />
                <View style={styles.infoRow}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: fontFamily.semibold }}>Due</Text>
                  <Text style={{ fontSize: 18, color: payRemaining > 0 ? colors.warning : colors.success, fontFamily: fontFamily.bold }}>{formatCurrency(payRemaining)}</Text>
                </View>
              </Card>
            )}

            {/* Charge breakdown (finance only) */}
            {canSeeFinance && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium }]}>CHARGE BREAKDOWN</Text>
                <InfoRow label="Parts Cost" value={formatCurrency(repair.partsCharge)} />
                <InfoRow label="Labour Charge" value={formatCurrency(repair.repairCharge)} />
                {!!repair.serviceCharge && <InfoRow label="Service Charge" value={formatCurrency(repair.serviceCharge)} />}
                {!!repair.otherCharge && <InfoRow label="Other Charge" value={formatCurrency(repair.otherCharge)} />}
                {!!repair.discount && <InfoRow label="Discount" value={`- ${formatCurrency(repair.discount)}`} />}
                {!!repair.taxPercent && <InfoRow label={`Tax (${repair.taxPercent}%)`} value={formatCurrency(((repair.repairCharge + repair.partsCharge) * (repair.taxPercent || 0)) / 100)} />}
                <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />
                <InfoRow label="Total" value={formatCurrency(payTotal)} bold />
              </Card>
            )}

            {/* Payment History */}
            {canSeeFinance && (payments.length > 0 || visibleRefunds.length > 0) && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 16 }]}>PAYMENT HISTORY</Text>
                {payments.map(pmt => {
                  const voided = !!(pmt as any).voidedAt;
                  return (
                  <View key={pmt.id} style={{ flexDirection: 'row', gap: 12, marginBottom: 12, opacity: voided ? 0.55 : 1 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: voided ? colors.destructive + '55' : colors.border, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: fontFamily.semibold }}>{pmt.method === 'UPI' ? 'UPI' : pmt.method === 'Cash' ? 'Cash' : 'Card'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: fontFamily.semibold, textDecorationLine: voided ? 'line-through' : 'none' }}>{formatCurrency(pmt.amount)}</Text>
                        <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{pmt.method}</Text>
                        <Text style={{ fontSize: 13, color: colors.primary, backgroundColor: colors.primary + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' }}>{pmt.kind}</Text>
                        {voided && (
                          <Text style={{ fontSize: 13, color: colors.destructive, backgroundColor: colors.destructive + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' }}>VOIDED</Text>
                        )}
                      </View>
                      <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{formatDate(pmt.createdAt)}</Text>
                      {pmt.referenceNo ? <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Txn ID: {pmt.referenceNo}</Text> : null}
                      <Text style={{ fontSize: 13, color: colors.mutedForeground }}>By: {pmt.receivedByName || pmt.recordedByName || 'Staff'}</Text>
                      {voided && (
                        <Text style={{ fontSize: 13, color: colors.destructive }}>
                          Voided by {(pmt as any).voidedByName || 'Owner'}: {(pmt as any).voidReason || ''}
                        </Text>
                      )}
                    </View>
                    {isDealer && !voided && (
                      <TouchableOpacity onPress={() => handleVoidPayment({ id: pmt.id, amount: pmt.amount, method: pmt.method })} style={{ alignSelf: 'center', padding: 6 }}>
                        <Feather name="rotate-ccw" size={16} color={colors.destructive} />
                      </TouchableOpacity>
                    )}
                  </View>
                  );
                })}
                {visibleRefunds.map(rf => (
                  <View key={rf.id} style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: colors.destructive + '15', borderWidth: 1, borderColor: colors.destructive + '33', alignItems: 'center', justifyContent: 'center' }}>
                      <Feather name="corner-down-left" size={16} color={colors.destructive} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ fontSize: 14, color: colors.destructive, fontFamily: fontFamily.semibold }}>-{formatCurrency(rf.amount)}</Text>
                        <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Refund ({rf.method})</Text>
                      </View>
                      <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{formatDate(rf.paidAt || rf.createdAt)}</Text>
                    </View>
                  </View>
                ))}
              </Card>
            )}

            {/* Photos */}
            {photosData?.photos && photosData.photos.length > 0 && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 12 }]}>DOCUMENTS & PHOTOS</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {photosData.photos.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={{ width: 80 }}
                      activeOpacity={0.7}
                      onPress={() => setViewerImage({ uri: getAbsoluteUrl(p.objectPath), label: p.kind.replace(/_/g, ' ') })}
                    >
                      <View style={{ width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 6 }}>
                        <Image source={{ uri: getAbsoluteUrl(p.objectPath), headers: { Authorization: `Bearer ${token}` } }} style={{ width: '100%', height: '100%' }} />
                      </View>
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, textAlign: 'center' }} numberOfLines={1}>{p.kind.replace(/_/g, ' ')}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Card>
            )}

            {/* Signatures */}
            {(repair.receivingSignaturePath || repair.deliverySignaturePath) && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium }]}>SIGNATURES</Text>
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  {repair.receivingSignaturePath && (
                    <TouchableOpacity
                      style={{ flex: 1, alignItems: 'center', gap: 4 }}
                      activeOpacity={0.7}
                      onPress={() => setViewerImage({ uri: getAbsoluteUrl(repair.receivingSignaturePath!), label: 'Receiving Signature' })}
                    >
                      <Image source={{ uri: getAbsoluteUrl(repair.receivingSignaturePath), headers: { Authorization: `Bearer ${token}` } }} style={styles.sigImg} contentFit="contain" />
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.regular }}>Receiving</Text>
                    </TouchableOpacity>
                  )}
                  {repair.deliverySignaturePath && (
                    <TouchableOpacity
                      style={{ flex: 1, alignItems: 'center', gap: 4 }}
                      activeOpacity={0.7}
                      onPress={() => setViewerImage({ uri: getAbsoluteUrl(repair.deliverySignaturePath!), label: 'Delivery Signature' })}
                    >
                      <Image source={{ uri: getAbsoluteUrl(repair.deliverySignaturePath), headers: { Authorization: `Bearer ${token}` } }} style={styles.sigImg} contentFit="contain" />
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.regular }}>Delivery</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </Card>
            )}

            {/* Activity Timeline */}
            {eventsData?.events && eventsData.events.length > 0 && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 16 }]}>ACTIVITY TIMELINE</Text>
                {eventsData.events.map((ev, i) => {
                  const isPending = ev.action.toLowerCase().includes('approval') || ev.action.toLowerCase().includes('pending');
                  const dotColor = isPending ? colors.warning : colors.success;
                  return (
                    <View key={ev.id} style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={{ alignItems: 'center', width: 24 }}>
                        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: dotColor + '22', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
                        </View>
                        {i !== eventsData.events.length - 1 && <View style={{ width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 4, minHeight: 30 }} />}
                      </View>
                      <View style={{ flex: 1, paddingBottom: i === eventsData.events.length - 1 ? 0 : 20 }}>
                        <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 2 }}>
                          {new Date(ev.createdAt).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', day: '2-digit', month: 'short', year: 'numeric' })}
                        </Text>
                        <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: fontFamily.medium }}>{ev.action === 'note_added' ? 'Note added' : ev.action}</Text>
                        {ev.action === 'note_added' && typeof ev.details?.text === 'string' && (
                          <Text style={{ fontSize: 13, color: colors.foreground, marginTop: 4, lineHeight: 19 }}>{String(ev.details.text)}</Text>
                        )}
                        <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 2 }}>By: {ev.userName} ({ev.userRole})</Text>
                      </View>
                    </View>
                  );
                })}
              </Card>
            )}

            {/* Staff Notes */}
            {!!repair.notes && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 8 }]}>INTAKE NOTE</Text>
                <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 20 }}>{repair.notes}</Text>
              </Card>
            )}

            {/* After Sale Service */}
            {(repairReturns.length > 0 || repair.status === 'delivered') && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 12 }]}>AFTER SALE SERVICE</Text>
                {repairReturns.map(ret => (
                  <TouchableOpacity
                    key={ret.id}
                    onPress={() => { setShowMore(false); router.push(`/(tabs)/repairs/return/${ret.id}` as any); }}
                    style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}
                  >
                    <View>
                      <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: fontFamily.semibold }}>{ret.returnId}</Text>
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.regular, marginTop: 2 }}>{formatDate(ret.createdAt)}</Text>
                    </View>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: getReturnStatusColor(ret.status, colors) + '22' }}>
                      <Text style={{ fontSize: 13, color: getReturnStatusColor(ret.status, colors), fontFamily: fontFamily.semibold, textTransform: 'capitalize' }}>
                        {ret.status.replace(/_/g, ' ')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {repair.status === 'delivered' && (
                  <Button title="+ Create After Sale Case" variant="outline" onPress={() => { setShowMore(false); router.push(`/(tabs)/repairs/return/new?repairId=${repair.id}` as any); }} />
                )}
              </Card>
            )}

            {/* Extra actions */}
            {repair.status === 'ready' && (
              <Button title="Notify Customer (Ready)" variant="outline" onPress={async () => {
                try {
                  await repairNotifyReady(repair.id);
                  Alert.alert('Success', 'Customer notified via email.');
                  await loadAll();
                  queryClient.invalidateQueries();
                } catch(e: any) {
                  Alert.alert('Notice', e.message || 'Email service not configured for this address');
                }
              }} />
            )}
            {isActiveRepair && approvals.length === 0 && repair.status !== 'customer_approval' && (
              <Button title="Request Customer Approval" variant="outline" onPress={() => { setShowMore(false); setTimeout(() => setShowApproval(true), 350); }} />
            )}

            {/* Invoice + owner-only corrections (mark unpaid / delete) side by side.
                Both open their own prompt, so the sheet closes first. */}
            <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 10, marginTop: 4 }}>
              <TouchableOpacity onPress={generatePDF} style={[styles.pdfBtn, { flex: 1, backgroundColor: colors.primary + '15', borderColor: colors.primary + '33' }]}>
                <Feather name="file-text" size={18} color={colors.primary} />
                <Text style={[styles.pdfBtnText, { color: colors.primary, fontFamily: fontFamily.semibold }]}>Invoice</Text>
              </TouchableOpacity>
              {canMarkUnpaid && (
                <TouchableOpacity
                  testID="repair-mark-unpaid"
                  accessibilityLabel="Mark as Unpaid"
                  accessibilityRole="button"
                  onPress={() => {
                    setShowMore(false);
                    setMarkUnpaidReason('');
                    setTimeout(() => setShowMarkUnpaid(true), 350);
                  }}
                  style={[styles.iconActionBtn, { backgroundColor: colors.warning + '15', borderColor: colors.warning + '44' }]}
                >
                  <Feather name="rotate-ccw" size={18} color={colors.warning} />
                </TouchableOpacity>
              )}
              {canDeleteRepair && (
                <TouchableOpacity
                  testID="repair-delete"
                  accessibilityLabel="Delete Repair"
                  accessibilityRole="button"
                  onPress={() => {
                    setShowMore(false);
                    setTimeout(() => confirmDeleteRepair(), 350);
                  }}
                  style={[styles.iconActionBtn, { backgroundColor: colors.destructive + '12', borderColor: colors.destructive + '44' }]}
                >
                  <Feather name="trash-2" size={18} color={colors.destructive} />
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>


      {/* Photos — view the gallery, add more from camera / gallery */}
      <Modal visible={showPhotos} animationType="slide" transparent onRequestClose={() => setShowPhotos(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetContent, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, 16), maxHeight: '85%' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.foreground, marginBottom: 0 }]}>Photos</Text>
                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.regular, marginTop: 2 }}>
                  {photosData?.photos?.length ? `${photosData.photos.length} photo${photosData.photos.length === 1 ? '' : 's'} on this job` : 'No photos yet'}
                </Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close photos" onPress={() => setShowPhotos(false)} style={[styles.sigCloseBtn, { borderColor: colors.border }]}>
                <Feather name="x" size={18} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
              {photosData?.photos && photosData.photos.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {photosData.photos.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      testID={`photo-thumb-${p.id}`}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Open ${p.kind.replace(/_/g, ' ')} photo`}
                      style={{ width: '31%' }}
                      activeOpacity={0.7}
                      onPress={() => openPhotoFromSheet(p)}
                    >
                      <View style={{ aspectRatio: 1, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 4 }}>
                        <Image source={{ uri: getAbsoluteUrl(p.objectPath), headers: { Authorization: `Bearer ${token}` } }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      </View>
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, textAlign: 'center', textTransform: 'capitalize' }} numberOfLines={1}>{p.kind.replace(/_/g, ' ')}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
                  <Feather name="image" size={28} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.regular }}>Device photos will appear here.</Text>
                </View>
              )}
            </ScrollView>
            {canAddPhoto && (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <Button title="Take Photo" variant="outline" onPress={() => handleAddPhoto('camera')} loading={photoUploading === 'camera'} disabled={!!photoUploading} style={{ flex: 1 }} testID="add-photo-camera" />
                <Button title="From Gallery" onPress={() => handleAddPhoto('library')} loading={photoUploading === 'library'} disabled={!!photoUploading} style={{ flex: 1 }} testID="add-photo-library" />
              </View>
            )}
          </View>
        </View>
      </Modal>
      {/* Fullscreen photo/signature viewer */}
      <Modal visible={!!viewerImage} animationType="fade" transparent onRequestClose={() => setViewerImage(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
          <TouchableOpacity
            style={{ position: 'absolute', top: insets.top + 12, right: 16, zIndex: 2, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
            onPress={() => setViewerImage(null)}
          >
            <Feather name="x" size={22} color="#fff" />
          </TouchableOpacity>
          {viewerImage && (
            <>
              <Image
                source={{ uri: viewerImage.uri, headers: { Authorization: `Bearer ${token}` } }}
                style={{ flex: 1, marginVertical: insets.top + 60 }}
                contentFit="contain"
              />
              <Text style={{ position: 'absolute', bottom: insets.bottom + 24, alignSelf: 'center', color: '#fff', fontSize: 14, fontFamily: fontFamily.medium, textTransform: 'capitalize' }}>
                {viewerImage.label}
              </Text>
            </>
          )}
        </View>
      </Modal>

      {/* Delivery payment decision */}
      <Modal visible={showDeliveryHandover} animationType="fade" transparent onRequestClose={() => setShowDeliveryHandover(false)}>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.foreground, marginBottom: 2 }]}>Complete Delivery</Text>
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Choose how to close the remaining balance.</Text>
              </View>
              <TouchableOpacity onPress={() => setShowDeliveryHandover(false)} style={styles.backBtn}>
                <Feather name="x" size={20} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            {canSeeFinance && (
              <View style={{ backgroundColor: colors.card, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 16 }}>
                <InfoRow label="Bill Amount" value={formatCurrency(payTotal)} />
                <InfoRow label="Paid" value={formatCurrency(payPaid)} color={colors.success} />
                <View style={styles.divider} />
                <InfoRow label="Balance" value={formatCurrency(payRemaining)} color={payRemaining > 0 ? colors.warning : colors.success} bold />
              </View>
            )}

            {payRemainingCents > 0 && canSeeFinance && (
              <>
                <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: fontFamily.medium, marginBottom: 8 }}>Payment Method</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                  {['Cash', 'UPI', 'Bank Transfer', 'Card', 'Other'].map(m => (
                    <TouchableOpacity
                      key={m}
                      onPress={() => setHandoverPaymentMethod(m)}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                        borderWidth: 1, borderColor: handoverPaymentMethod === m ? colors.primary : colors.border,
                        backgroundColor: handoverPaymentMethod === m ? colors.primary + '22' : colors.card
                      }}
                    >
                      <Text style={{ fontSize: 13, color: handoverPaymentMethod === m ? colors.primary : colors.foreground }}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: fontFamily.medium, marginBottom: 8 }}>Warranty (Days)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {(user?.role === 'dealer' || user?.role === 'super_admin' ? ['0', '7', '15', '30', '90', '180', 'Custom'] : ['0', '7', '15', '30', '90', '180']).map(w => (
                <TouchableOpacity
                  key={w}
                  onPress={() => setDeliveryWarranty(w)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                    borderWidth: 1, borderColor: deliveryWarranty === w ? colors.primary : colors.border,
                    backgroundColor: deliveryWarranty === w ? colors.primary : colors.card
                  }}
                >
                  <Text style={{ color: deliveryWarranty === w ? '#FFF' : colors.foreground, fontSize: 13, fontFamily: fontFamily.medium }}>
                    {w === '0' ? 'None' : w}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {deliveryWarranty === 'Custom' && (
              <View style={{ marginBottom: 20 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Custom Days (1-3650)</Text>
                <TextInput
                  value={customWarrantyDays}
                  onChangeText={setCustomWarrantyDays}
                  keyboardType="numeric"
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                  placeholder="e.g. 365"
                />
              </View>
            )}

            {payRemainingCents > 0 ? (
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Button title="Due" variant="outline" onPress={() => completeDelivery(false)} loading={updating} style={{ flex: 1 }} />
                {canSeeFinance && (
                  <Button title="Mark as Paid" onPress={() => completeDelivery(true)} loading={updating} style={{ flex: 1 }} />
                )}
              </View>
            ) : (
              <Button title="Complete Delivery" onPress={() => completeDelivery(false)} loading={updating} fullWidth />
            )}

          </View>
        </KeyboardAvoidingCompat>
      </Modal>

      {/* Add Part Modal */}
      <Modal visible={showAddPart} animationType="fade" transparent onRequestClose={() => setShowAddPart(false)}>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Part</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 12 }}>
              Select from inventory to deduct stock, or enter custom.
            </Text>

            <Text style={[styles.label, { color: colors.foreground }]}>Select Part</Text>
            <ScrollView style={{ maxHeight: 150, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginBottom: 12 }}>
              <TouchableOpacity
                onPress={() => setSelectedInventoryId('')}
                style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: !selectedInventoryId ? colors.primary + '22' : colors.card }}
              >
                <Text style={{ fontSize: 13, color: !selectedInventoryId ? colors.primary : colors.foreground }}>Custom Part (Not in Inventory)</Text>
              </TouchableOpacity>
              {inventory.map(i => (
                <TouchableOpacity
                  key={i.id}
                  onPress={() => setSelectedInventoryId(i.id)}
                  style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: selectedInventoryId === i.id ? colors.primary + '22' : colors.card }}
                >
                  <Text style={{ fontSize: 13, color: selectedInventoryId === i.id ? colors.primary : colors.foreground }}>
                    {i.name} ({i.quantity} in stock)
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {!selectedInventoryId && (
              <>
                <Text style={[styles.label, { color: colors.foreground }]}>Part Name</Text>
                <TextInput value={partName} onChangeText={setPartName} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
                <Text style={[styles.label, { color: colors.foreground }]}>Unit Cost</Text>
                <TextInput value={partCost} onChangeText={setPartCost} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
              </>
            )}

            <Text style={[styles.label, { color: colors.foreground }]}>Quantity</Text>
            <TextInput value={partQty} onChangeText={setPartQty} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowAddPart(false)} style={{ flex: 1 }} />
              <Button title="Add" onPress={handleAddPart} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </Modal>


      {/* Receive Payment Modal */}
      <Modal visible={showPayment} animationType="fade" transparent onRequestClose={() => setShowPayment(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border, maxHeight: '88%' }]}>
            {paymentSuccess ? (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.success + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                    <Feather name="check" size={28} color={colors.success} />
                  </View>
                  <Text style={[styles.modalTitle, { color: colors.foreground, marginBottom: 2 }]}>Payment Received</Text>
                  <Text style={{ fontSize: 24, color: colors.success, fontFamily: fontFamily.bold, marginBottom: 8 }}>{formatCurrency(paymentSuccess.amount)}</Text>
                </View>
                <InfoRow label="Repair ID" value={repair.repairId} />
                <InfoRow label="Customer" value={repair.customerName} />
                <InfoRow label="Payment Method" value={paymentSuccess.method} />
                <InfoRow label="Payment Type" value={paymentSuccess.kind.charAt(0).toUpperCase() + paymentSuccess.kind.slice(1)} />
                {!!paymentSuccess.referenceNo && <InfoRow label="Reference" value={paymentSuccess.referenceNo} />}
                <InfoRow label="Date & Time" value={formatDate(paymentSuccess.createdAt)} />
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <InfoRow label="Total Paid" value={formatCurrency(paymentSuccess.totalPaidAfter)} color={colors.success} />
                <InfoRow label="Remaining Balance" value={formatCurrency(paymentSuccess.remainingAfter)} color={paymentSuccess.remainingAfter > 0 ? colors.warning : colors.success} bold />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <Button title="Share Receipt" variant="outline" onPress={() => sharePaymentReceipt(false)} style={{ flex: 1 }} />
                  <Button title="Print" variant="outline" onPress={() => sharePaymentReceipt(true)} style={{ flex: 1 }} />
                </View>
                <Button title="Done" onPress={() => setShowPayment(false)} style={{ marginTop: 10 }} />
              </ScrollView>
            ) : (
              <KeyboardAwareScrollViewCompat showsVerticalScrollIndicator={false} bottomOffset={24}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
                  <TouchableOpacity onPress={() => setShowPayment(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginRight: 16 }}>
                    <Feather name="arrow-left" size={24} color={colors.foreground} />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 18, color: colors.foreground, fontFamily: fontFamily.semibold }}>Receive Payment</Text>
                </View>

                {/* Summary Card */}
                <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16, marginBottom: 24 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 4 }}>Repair</Text>
                      <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: fontFamily.medium }}>{repair.repairId} - {repair.problem}</Text>
                    </View>
                  </View>
                  <View style={{ marginBottom: 16 }}>
                    <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 4 }}>Customer</Text>
                    <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: fontFamily.medium }}>{repair.customerName}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View>
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 4 }}>Bill Amount</Text>
                      <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: fontFamily.semibold }}>{formatCurrency(payTotal)}</Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 4 }}>Paid</Text>
                      <Text style={{ fontSize: 14, color: colors.success, fontFamily: fontFamily.semibold }}>{formatCurrency(payPaid)}</Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 4 }}>Due</Text>
                      <Text style={{ fontSize: 14, color: colors.destructive, fontFamily: fontFamily.semibold }}>{formatCurrency(payRemaining)}</Text>
                    </View>
                  </View>
                </View>

                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 8 }}>Enter Amount</Text>
                <View collapsable={false} style={{ borderColor: paymentAmountError ? colors.destructive : colors.border, borderWidth: 1, borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, backgroundColor: colors.background, marginBottom: 4 }}>
                  <Text style={{ fontSize: 15, color: colors.mutedForeground, marginRight: 4 }}>₹</Text>
                  <TextInput
                    value={paymentAmount}
                    onChangeText={onPaymentAmountChange}
                    keyboardType="numeric"
                    placeholder="0.00"
                    placeholderTextColor={colors.mutedForeground}
                    style={{ flex: 1, height: 48, color: colors.foreground, fontSize: 16, fontFamily: fontFamily.medium }}
                  />
                </View>
                {!!paymentAmountError && <Text style={{ color: colors.destructive, fontSize: 13, marginBottom: 8 }}>{paymentAmountError}</Text>}
                
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24, marginTop: 12 }}>
                  {[Math.max(0, payRemaining), payTotal].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map(v => (
                    <TouchableOpacity key={v} onPress={() => onPaymentAmountChange(String(v))} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: paymentAmount === String(v) ? colors.primary : colors.border, backgroundColor: paymentAmount === String(v) ? colors.primary + '22' : colors.card }}>
                      <Text style={{ fontSize: 13, color: paymentAmount === String(v) ? colors.primary : colors.foreground }}>{formatCurrency(v)}</Text>
                    </TouchableOpacity>
                  ))}
                  {['100', '500'].map(vStr => {
                    const active = paymentAmount === vStr;
                    return (
                      <TouchableOpacity key={vStr} onPress={() => onPaymentAmountChange(vStr)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + '22' : colors.card }}>
                        <Text style={{ fontSize: 13, color: active ? colors.primary : colors.foreground }}>{vStr}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 8 }}>Payment Method</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                  {['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'].map((m) => {
                    const active = paymentMethod === m;
                    return (
                      <TouchableOpacity key={m} onPress={() => { setPaymentMethod(m); setPaymentReference(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: active ? colors.primary : colors.mutedForeground, alignItems: 'center', justifyContent: 'center' }}>
                          {active && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />}
                        </View>
                        <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: fontFamily.medium }}>{m}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {paymentReferenceRequired && (
                  <View style={{ marginBottom: 24 }}>
                    <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 8 }}>{paymentReferenceLabel} <Text style={{ color: colors.destructive }}>*</Text></Text>
                    <TextInput
                      value={paymentReference}
                      onChangeText={setPaymentReference}
                      placeholder="Enter reference number"
                      placeholderTextColor={colors.mutedForeground}
                      style={{ height: 48, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, color: colors.foreground, fontSize: 14, backgroundColor: colors.background }}
                    />
                  </View>
                )}

                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 8 }}>Payment Type</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
                  {(repair.status === 'delivered' ? ['due', 'partial', 'final'] : ['advance', 'partial', 'final']).map((kind) => {
                    const active = paymentKind === kind;
                    return (
                      <TouchableOpacity
                        key={kind}
                        onPress={() => {
                          setPaymentKind(kind);
                          setPaymentKindTouched(true);
                        }}
                        style={{
                          paddingHorizontal: 14,
                          paddingVertical: 7,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.primary + '22' : colors.card,
                        }}
                      >
                        <Text style={{ fontSize: 13, color: active ? colors.primary : colors.foreground, fontFamily: fontFamily.medium, textTransform: 'capitalize' }}>
                          {kind}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.medium, marginBottom: 8 }}>Note (Optional)</Text>
                <View style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, backgroundColor: colors.background, marginBottom: 24 }}>
                  <TextInput
                    value={paymentNote}
                    onChangeText={setPaymentNote}
                    placeholder="Enter details..."
                    placeholderTextColor={colors.mutedForeground}
                    multiline
                    style={{ height: 80, color: colors.foreground, fontSize: 14, paddingTop: 12, textAlignVertical: 'top' }}
                  />
                </View>

                {/* Payment history (real ledger) */}
                {(payments.length > 0 || visibleRefunds.length > 0) && (
                  <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: fontFamily.semibold, marginBottom: 6 }}>Payment History</Text>
                    {payments.map(pmt => (
                      <View key={pmt.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={{ fontSize: 13, color: colors.foreground }}>{pmt.method} · {pmt.kind}</Text>
                          <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
                            {formatDate(pmt.createdAt)}{(pmt.receivedByName || pmt.recordedByName) ? ` · ${pmt.receivedByName || pmt.recordedByName}` : ''}
                          </Text>
                          {!!pmt.referenceNo && <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Ref: {pmt.referenceNo}</Text>}
                        </View>
                        <Text style={{ fontSize: 13, color: colors.success, fontFamily: fontFamily.semibold }}>{formatCurrency(pmt.amount)}</Text>
                      </View>
                    ))}
                    {visibleRefunds.map(rf => (
                      <View key={rf.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={{ fontSize: 13, color: colors.destructive }}>
                            Refund · {rf.method}{rf.status !== 'paid' ? ` (${rf.status})` : ''}
                          </Text>
                          <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
                            {formatDate(rf.paidAt || rf.createdAt)}{(rf.paidByName || rf.approvedByName || rf.requestedByName) ? ` · ${rf.paidByName || rf.approvedByName || rf.requestedByName}` : ''}
                          </Text>
                          {!!rf.referenceNo && <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Ref: {rf.referenceNo}</Text>}
                        </View>
                        <Text style={{ fontSize: 13, color: colors.destructive, fontFamily: fontFamily.semibold }}>-{formatCurrency(rf.amount)}</Text>
                      </View>
                    ))}
                    <View style={styles.infoRow}>
                      <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{paidRefundsTotal > 0 ? 'Net Paid' : 'Total Paid'}</Text>
                      <Text style={{ fontSize: 13, color: colors.success, fontFamily: fontFamily.semibold }}>{formatCurrency(Math.max(0, payPaid - paidRefundsTotal))}</Text>
                    </View>
                  </View>
                )}

                <View style={{ marginTop: 16, marginBottom: 16 }}>
                  <TouchableOpacity 
                    onPress={handleCollectPayment}
                    disabled={!paymentFormValid || updating}
                    style={{ backgroundColor: paymentFormValid && !updating ? colors.primary : colors.muted, borderRadius: 8, paddingVertical: 14, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#FFF', fontSize: 16, fontFamily: fontFamily.semibold }}>Save Payment</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 }}>
                  <Feather name="info" size={12} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 13, color: colors.mutedForeground }}>This payment will be recorded in payment history.</Text>
                </View>
              </KeyboardAwareScrollViewCompat>
            )}
          </View>
        </View>
      </Modal>


      {/* Estimate Approval Modal */}
      <Modal visible={showApproval} animationType="slide" transparent onRequestClose={() => setShowApproval(false)}>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Request Customer Approval</Text>

            <Text style={[styles.label, { color: colors.foreground }]}>New Estimate Amount (₹)</Text>
            <TextInput value={newEstimate} onChangeText={setNewEstimate} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

            <Text style={[styles.label, { color: colors.foreground }]}>Reason for Change</Text>
            <TextInput value={approvalReason} onChangeText={setApprovalReason} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowApproval(false)} style={{ flex: 1 }} />
              <Button title="Submit Request" onPress={async () => {
                if (!newEstimate || !approvalReason) return Alert.alert('Required', 'Please fill all fields');
                setUpdating(true);
                try {
                  await estimateApprovalsCreate(repair.id, {
                    newAmount: Number(newEstimate),
                    reason: approvalReason
                  });
                  setShowApproval(false);
                  setNewEstimate('');
                  setApprovalReason('');
                  await loadAll();
                  await approvalsRefetch();
                  queryClient.invalidateQueries();
                } catch (e: any) {
                  Alert.alert('Request Failed', e.message);
                } finally {
                  setUpdating(false);
                }
              }} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </Modal>
{/* Financial Edit Modal */}
      <Modal visible={showFinancialEdit} animationType="fade" transparent onRequestClose={() => setShowFinancialEdit(false)}>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Financials</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 12 }}>
              Parts charge is computed automatically. Advances are recorded via Payments.
            </Text>

            <KeyboardAwareScrollViewCompat style={{ maxHeight: 300 }} bottomOffset={24}>
              <Text style={[styles.label, { color: colors.foreground }]}>Labour / Repair Charge</Text>
              <TextInput value={editRepairCharge} onChangeText={setEditRepairCharge} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

              <Text style={[styles.label, { color: colors.foreground }]}>Service Charge</Text>
              <TextInput value={editServiceCharge} onChangeText={setEditServiceCharge} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

              <Text style={[styles.label, { color: colors.foreground }]}>Other Charge</Text>
              <TextInput value={editOtherCharge} onChangeText={setEditOtherCharge} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

              <Text style={[styles.label, { color: colors.foreground }]}>Discount</Text>
              <TextInput value={editDiscount} onChangeText={setEditDiscount} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

              <Text style={[styles.label, { color: colors.foreground }]}>Tax %</Text>
              <TextInput value={editTaxPercent} onChangeText={setEditTaxPercent} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
            </KeyboardAwareScrollViewCompat>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowFinancialEdit(false)} style={{ flex: 1 }} />
              <Button title="Save" onPress={handleSaveFinancials} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </Modal>

      {/* Void Payment Modal (dealer/owner) */}
      <Modal visible={!!voidTarget} animationType="fade" transparent onRequestClose={() => setVoidTarget(null)}>
        <KeyboardAvoidingCompat style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Void Payment</Text>
            {voidTarget && (
              <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 12, fontFamily: fontFamily.regular }}>
                {formatCurrency(voidTarget.amount)} ({voidTarget.method}) reverse hoga. Record delete nahi hota — ledger mein VOIDED mark hoke hamesha dikhega, aur finance mein reversal entry banegi.
              </Text>
            )}
            <Text style={[styles.label, { color: colors.foreground }]}>Reason <Text style={{ color: colors.destructive }}>*</Text></Text>
            <View collapsable={false}>
              <TextInput
                value={voidReason}
                onChangeText={setVoidReason}
                maxLength={120}
                placeholder="Galat entry / wrong amount / duplicate..."
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setVoidTarget(null)} style={{ flex: 1 }} />
              <Button title="Void Karein" onPress={submitVoidPayment} loading={voidSubmitting} disabled={!voidReason.trim()} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </Modal>

      {/* Mark Whole Job Unpaid (dealer/owner) */}
      <Modal
        visible={showMarkUnpaid}
        animationType="fade"
        transparent
        onRequestClose={() => { if (!markUnpaidSubmitting) setShowMarkUnpaid(false); }}
      >
        <KeyboardAvoidingCompat style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Mark as Unpaid</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 12, fontFamily: fontFamily.regular }}>
              {payments.filter(p => !(p as any).voidedAt).length} payment(s), total {formatCurrency(payPaid)} reverse honge aur job dobara unpaid ho jayegi. Records delete nahi hote — ledger mein VOIDED mark hoke dikhte hain aur finance mein reversal entry banti hai.
            </Text>
            <Text style={[styles.label, { color: colors.foreground }]}>Reason <Text style={{ color: colors.destructive }}>*</Text></Text>
            <View collapsable={false}>
              <TextInput
                value={markUnpaidReason}
                onChangeText={setMarkUnpaidReason}
                maxLength={120}
                placeholder="Galti se paid mark ho gaya tha..."
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowMarkUnpaid(false)} style={{ flex: 1 }} />
              <Button
                title="Unpaid Karein"
                onPress={submitMarkUnpaid}
                loading={markUnpaidSubmitting}
                disabled={!markUnpaidReason.trim()}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </Modal>

      {/* Work Notes sheet — the only place staff describe what was done.
          Notes are append-only timeline events; the sheet shows the composer
          (when allowed) above the newest-first history. */}
      <Modal visible={showNotes} animationType="slide" transparent onRequestClose={() => setShowNotes(false)}>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border, maxHeight: '85%' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={[styles.modalTitle, { color: colors.foreground, marginBottom: 0 }]}>
                Work Notes{workNotes.length > 0 ? ` (${workNotes.length})` : ''}
              </Text>
              <TouchableOpacity onPress={() => setShowNotes(false)} accessibilityRole="button" accessibilityLabel="Close work notes" hitSlop={8}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {canAddNote && (
              <View style={{ marginBottom: workNotes.length > 0 ? 14 : 4 }}>
                <TextInput
                  testID="work-note-input"
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder="Phone mein kya kaam hua? Yahan likhein…"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  maxLength={2000}
                  editable={!noteSaving}
                  autoFocus={workNotes.length === 0}
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, minHeight: 72, textAlignVertical: 'top', marginBottom: 8 }]}
                />
                <Button
                  title="Add Note"
                  onPress={handleAddNote}
                  loading={noteSaving}
                  disabled={!noteDraft.trim()}
                  fullWidth
                />
              </View>
            )}

            {workNotes.length === 0 ? (
              canAddNote ? (
                <Text style={{ fontSize: 13, color: colors.mutedForeground, lineHeight: 19 }}>
                  Har kaam ke baad ek chhota note add karein.
                </Text>
              ) : null
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={{ gap: 12, paddingBottom: 4 }}>
                  {workNotes.map((n) => (
                    <View key={n.id} style={{ paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: n.kind === 'note' ? colors.primary + '66' : colors.border }}>
                      {n.kind !== 'note' && (
                        <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: fontFamily.semibold, letterSpacing: 0.6, marginBottom: 2 }}>{n.label}</Text>
                      )}
                      <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 20 }}>{n.text}</Text>
                      {!!n.meta && (
                        <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 3 }}>{n.meta}</Text>
                      )}
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingCompat>
      </Modal>

      {/* Assign Technician Modal */}
      <Modal visible={showAssign} animationType="slide" transparent onRequestClose={() => setShowAssign(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Assign Technician</Text>

            <ScrollView style={{ maxHeight: 300 }}>
              {technicians.map(tech => (
                <TouchableOpacity key={tech.id} onPress={async () => {
                  setUpdating(true);
                  try {
                    await repairAssignTechnician(repair.id, { technicianId: tech.id });
                    setShowAssign(false);
                    await loadAll();
                    queryClient.invalidateQueries();
                  } catch(e: any) { Alert.alert('Error', e.message); }
                  finally { setUpdating(false); }
                }} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.foreground, fontSize: 15 }}>{tech.name}</Text>
                  {repair.technicianId === tech.id && <Feather name="check" size={16} color={colors.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowAssign(false)} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

</View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding, paddingBottom: layout.rowPaddingVertical,
  },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: layout.screenPadding, paddingBottom: space.md, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailTitle: { ...font.title },
  backBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  roundBtn: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  contactBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  tile: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center', gap: 2 },
  tileIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tileBadge: { position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  primaryCta: { flexDirection: 'row', alignItems: 'center', height: 54, borderRadius: 27, paddingHorizontal: 16 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  repairId: { ...font.itemTitle },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFoundText: { ...font.body },
  scroll: { padding: layout.screenPadding, gap: space.md },
  statusCard: { gap: 10 },
  cardLabel: { ...font.overline, marginBottom: space.xs },
  nextStatusBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14 },
  nextStatusText: { color: '#FFFFFF', fontSize: 14 },
  priorityRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  dateSmall: { fontSize: 13 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  infoLabel: { ...font.label },
  infoValue: { ...font.bodyStrong, textAlign: 'right', flex: 1, marginLeft: space.lg },
  divider: { height: 1, marginVertical: 8 },
  problemTitle: { ...font.labelStrong, marginTop: space.xs },
  problemText: { ...font.body, marginTop: space.xs },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1 },
  pdfBtnText: { fontSize: 15 },
  iconActionBtn: { width: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1 },
  checkBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  galleryThumb: { width: 100, height: 100, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  galleryImg: { width: '100%', height: '100%' },
  galleryBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 4, alignItems: 'center' },
  galleryBadgeText: { ...font.smallStrong },
  sigImg: { width: '100%', height: 80, backgroundColor: '#FFF', borderRadius: 8, borderWidth: 1, borderColor: '#EEE' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  // Keep the primary actions in normal layout flow. An absolute footer overlaps
  // the last card on short Android screens and makes the detail page appear to
  // collapse behind the payment controls.
  actionBar: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12 },
  doneBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 14 },
  paidChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 12 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheetContent: { borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalContent: { borderWidth: 1, borderRadius: 16, padding: 20 },
  modalTitle: { ...font.heading, marginBottom: space.md },
  sigScreen: { flex: 1, paddingHorizontal: 20, paddingBottom: 24 },
  sigHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  sigSubtitle: { fontSize: 13, marginTop: 4 },
  sigCloseBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sigCard: { flex: 1, borderRadius: 16, borderWidth: 1, overflow: 'hidden', backgroundColor: '#FFF' },
  sigBaseline: { position: 'absolute', left: 24, right: 24, bottom: 20, borderTopWidth: 1, borderTopColor: '#D1D5DB', borderStyle: 'dashed', paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sigBaselineText: { fontSize: 13, color: '#9CA3AF' },
  sigFooterRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  label: { ...font.label, marginBottom: space.xs, marginTop: space.sm },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.md, ...font.input },
});
