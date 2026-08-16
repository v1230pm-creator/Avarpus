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
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useQueryClient } from '@tanstack/react-query';

import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { RepairStatusBadge, PriorityBadge, SampleBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ScreenGlow, FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { RepairStatus } from '@/types';
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
  useRepairPaymentsList, getRepairPaymentsListQueryKey, repairPaymentsCreate,
  useStaffList, getStaffListQueryKey, repairAssignTechnician,
  useRepairTesting, repairTesting, useEstimateApprovalsList, getEstimateApprovalsListQueryKey, estimateApprovalsCreate,
  estimateApprovalsDecide, deliveryOtpSend, deliveryOtpVerify, repairNotifyReady, estimateApprovalsSendOtp,
  repairsUpdate
} from '@workspace/api-client-react';
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
      <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: color ?? colors.foreground, fontFamily: bold ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>{value}</Text>
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
        <Text style={{ fontSize: 13, color: color || colors.foreground, fontFamily: bold ? 'Inter_600SemiBold' : 'Inter_500Medium' }}>{value}</Text>
        {rightElement}
      </View>
    </View>
  );
}

export default function RepairDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { repairs, updateRepair, deleteRepair, inventory, loadAll } = useData();
  const { user, canAccess } = useAuth();
  const queryClient = useQueryClient();
  
  const [updating, setUpdating] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [showDeliverySig, setShowDeliverySig] = useState(false);
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
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState<{
    amount: number; method: string; kind: string; referenceNo?: string; createdAt: string;
    totalPaidAfter: number; remainingAfter: number;
  } | null>(null);
  const paymentSubmitRef = useRef(false);
  
  // Technician Assignment
  const [showAssign, setShowAssign] = useState(false);
  
  // Testing Checklist
  const [showTesting, setShowTesting] = useState(false);
  const [testingChecklist, setTestingChecklist] = useState<Record<string, boolean>>({});
  // Testing results being edited inside the Service Edit modal (true = Pass, false = Fail, absent = not tested)
  const [editTesting, setEditTesting] = useState<Record<string, boolean>>({});
  
  // Estimate Approval
  const [showApproval, setShowApproval] = useState(false);
  const [newEstimate, setNewEstimate] = useState('');
  const [approvalReason, setApprovalReason] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  
  // Delivery OTP
  const [showDeliveryOtp, setShowDeliveryOtp] = useState(false);
  const [deliveryOtpCode, setDeliveryOtpCode] = useState('');
  
  // Warranty
  const [deliveryWarranty, setDeliveryWarranty] = useState('0');
  const [customWarrantyDays, setCustomWarrantyDays] = useState('');

  // More details sheet
  const [showMore, setShowMore] = useState(false);

  // Service Edits
  const [showServiceEdit, setShowServiceEdit] = useState(false);
  const [editDiagnosis, setEditDiagnosis] = useState('');
  const [editWorkPerformed, setEditWorkPerformed] = useState('');

  // Service workflow tab (Complaint / Diagnosis / Repairing / Testing)
  const [svcTab, setSvcTab] = useState<'complaint' | 'diagnosis' | 'repairing' | 'testing' | null>(null);

  const qrRef = useRef<any>(null);
  const deliverySigPadRef = useRef<SignatureViewRef>(null);

  useEffect(() => {
    storage.get<string>(KEYS.AUTH_TOKEN).then(setToken);
  }, []);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  // The tab bar is position:'absolute' (see (tabs)/_layout.tsx), so screen
  // content renders behind it. Offset the sticky action bar above the tab bar:
  // web uses an explicit 84px bar; native uses the react-navigation default
  // (49px) plus the bottom safe-area inset.
  const tabBarHeight = Platform.OS === 'web' ? 84 : 49 + insets.bottom;
  const anims = useStaggerAnim(16);

  const repair = useMemo(() => repairs.find((r) => r.id === id), [repairs, id]);

  // Keep the Testing tab's Pass/Fail state in sync with the saved checklist.
  const savedTestingJson = JSON.stringify(repair?.testingChecklist || {});
  useEffect(() => {
    setEditTesting(JSON.parse(savedTestingJson));
  }, [savedTestingJson]);

  const { data: photosData } = useRepairPhotosList(id as string, { query: { enabled: !!id, queryKey: getRepairPhotosListQueryKey(id as string) } });
  const { data: eventsData } = useRepairEventsList(id as string, { query: { enabled: !!id, queryKey: getRepairEventsListQueryKey(id as string) } });
  const { data: returnsData } = useReturnsList({ query: { queryKey: getReturnsListQueryKey() } });
  const { data: partsData, refetch: partsRefetch } = useRepairPartsList(id as string, { query: { enabled: !!id, queryKey: getRepairPartsListQueryKey(id as string) } });
  
  const { data: paymentsData, refetch: paymentsRefetch } = useRepairPaymentsList(id as string, { query: { enabled: !!id, queryKey: getRepairPaymentsListQueryKey(id as string) } });
  const { data: staffData } = useStaffList({ query: { queryKey: getStaffListQueryKey() } });
  const { data: approvalsData, refetch: approvalsRefetch } = useEstimateApprovalsList(id as string, { query: { enabled: !!id, queryKey: getEstimateApprovalsListQueryKey(id as string) } });

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
        <ScreenGlow />
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.notFound}>
          <Text style={[styles.notFoundText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Repair not found
          </Text>
        </View>
      </View>
    );
  }

  const balance = Math.max(0, repair.repairCharge + repair.partsCharge - repair.advance);
  const canUpdateStatus = canAccess('repairs_update') || (canAccess('repairs') && user?.role !== 'reception');
  const canSeeFinance = canAccess('finance') || user?.role === 'reception' || user?.role === 'dealer' || user?.role === 'super_admin';
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
    repair.status === 'received' ? { id: 'repairing', label: 'Repairing', desc: 'Start repairing and add diagnosis' }
    : ['diagnosing', 'waiting_parts', 'repairing'].includes(repair.status as string) ? { id: 'testing', label: 'Testing', desc: 'Move job to testing' }
    : ['testing', 'customer_approval'].includes(repair.status as string) ? { id: 'ready', label: 'Ready', desc: 'Ready for customer pickup' }
    : null;

  // Task-completion gate (mirrors the server): the next stage stays locked
  // until the current stage's required work is SAVED on the server.
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
    if (stageIndex === 1) {
      const miss: string[] = [];
      if (!repair.diagnosis?.trim()) miss.push('Diagnosis');
      if (!repair.workPerformed?.trim()) miss.push('Work performed');
      return miss;
    }
    if (stageIndex === 2) {
      const vals = Object.values(repair.testingChecklist || {});
      if (vals.length === 0) return ['Testing result (Pass/Fail)'];
      if (vals.some(v => v === false)) return ['All tested items must Pass (Fail hone par Return to Repair use karein)'];
      return [];
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

  // ── Collect Payment: real financials from the repair + payments ledger ──
  const payTotal = repair.totalAmount || (repair.repairCharge + repair.partsCharge);
  const payPaid = repair.paidAmount ?? repair.advance ?? 0;
  const payRemaining = repair.balance !== undefined ? Math.max(0, repair.balance) : Math.max(0, payTotal - payPaid);
  // Money math in integer paise to avoid floating-point boundary bugs
  const payRemainingCents = Math.round(payRemaining * 100);
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
    const cents = parseAmountCents(amtStr);
    const clearsBalance = cents !== null && cents > 0 && payRemainingCents > 0 && cents >= payRemainingCents;
    if (clearsBalance) return 'final';
    return payPaid > 0 ? 'partial' : 'advance';
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
            <h2 style="text-align: center; margin-bottom: 4px;">VMC Electronics</h2>
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

  const uploadToGcs = async (fileUri: string, mimeType: string) => {
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

  // Delivery is allowed only after full payment. Central guard so every
  // path into the handover/signature flow enforces the same rule.
  const deliveryPaymentBlocked = () => {
    if (payRemainingCents > 0) {
      setShowDeliveryHandover(false);
      setShowDeliverySig(false);
      Alert.alert('Payment Pending', `Delivery se pehle poora payment collect karein. ${formatCurrency(payRemaining)} abhi baaki hai.`);
      return true;
    }
    return false;
  };

  const markDelivered = async (signatureUri: string) => {
    if (deliveryPaymentBlocked()) return;
    setUpdating(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const sigPath = await uploadToGcs(signatureUri, 'image/png');
      
      if (!sigPath) {
        throw new Error('Failed to upload delivery signature.');
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
        deliverySignaturePath: sigPath,
        paymentMethod: handoverPaymentMethod,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      if (err?.message?.includes('APPROVAL_REQUIRED') || err?.code === 'APPROVAL_REQUIRED') {
         Alert.alert('Restricted', 'Dealer/Owner approval required to finalize this update.');
      } else if (err?.code === 'STAGE_INCOMPLETE' || err?.message?.includes('STAGE_INCOMPLETE')) {
         showIncompleteAlert(Array.isArray(err?.missing) ? err.missing : undefined);
      } else {
         Alert.alert('Update failed', err.message || "Couldn't mark the repair as delivered. Please try again.");
      }
    } finally {
      setUpdating(false);
      setShowDeliverySig(false);
    }
  };

  const handleDeliverySigOK = async (signature: string) => {
    try {
      const path = FileSystem.cacheDirectory + `del_sig_${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(path, signature.replace('data:image/png;base64,', ''), {
        encoding: FileSystem.EncodingType.Base64,
      });
      await markDelivered(path);
    } catch (err) {
      Alert.alert('Error', 'Failed to process signature.');
    }
  };

  const handleStatusUpdate = async (newStatus: string) => {
    if (newStatus === 'delivered') {
      // Same modal-swap rule: let the status picker dismiss first.
      setShowStatusPicker(false);
      if (deliveryPaymentBlocked()) return;
      setTimeout(() => setShowDeliveryHandover(true), 350);
      return;
    }
    if (updating) return;
    setUpdating(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await updateRepair({
        ...repair,
        status: newStatus as RepairStatus,
      });
      setShowStatusPicker(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      if (e?.code === 'TESTING_REQUIRED' || e?.message?.includes('TESTING_REQUIRED')) {
        setShowStatusPicker(false);
        setTestingChecklist({ ...(repair.testingChecklist || {}) });
        setTimeout(() => setShowTesting(true), 350);
      } else if (e?.code === 'STAGE_INCOMPLETE' || e?.message?.includes('STAGE_INCOMPLETE')) {
        setShowStatusPicker(false);
        setTimeout(() => showIncompleteAlert(Array.isArray(e?.missing) ? e.missing : undefined), 350);
      } else if (e?.code === 'INVALID_STATUS_TRANSITION' || e?.message?.includes('INVALID_STATUS_TRANSITION')) {
        setShowStatusPicker(false);
        setTimeout(() => Alert.alert('Complete the current task first.', 'Yeh stage abhi locked hai — workflow ke hisaab se pehle current stage complete karein.'), 350);
      } else {
        Alert.alert('Update failed', e.message || "Couldn't update the repair status.");
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleHandoverProceed = () => {
    if (deliveryPaymentBlocked()) return;
    // RN can't swap two <Modal>s in the same tick — the signature modal
    // silently fails to appear if opened before the handover modal has
    // finished dismissing. Close first, then open after the transition.
    setShowDeliveryHandover(false);
    setTimeout(() => setShowDeliverySig(true), 350);
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
      });
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

  // Stage of the service workflow, used to decide which Edit Service Details
  // section is currently editable. Earlier stages stay visible but locked.
  const svcStage =
    repair.status === 'received' ? 0
    : ['diagnosing', 'waiting_parts', 'repairing'].includes(repair.status as string) ? 1
    : 2;
  const testingEditable = ['testing', 'customer_approval'].includes(repair.status as string);

  // Active service tab: user selection, else default to the current stage.
  const defaultSvcTab =
    svcStage === 0 ? 'complaint' : svcStage === 1 ? 'repairing' : svcStage === 2 ? 'testing' : 'testing';
  const activeSvcTab = svcTab ?? defaultSvcTab;
  const testingTabDirty = JSON.stringify(editTesting) !== JSON.stringify(repair.testingChecklist || {});

  // Whether the diagnosis/work fields are editable right now: staff during
  // the repairing stage, and the dealer/owner also after delivery.
  const svcEditable = svcStage === 1 || dealerDeliveredEdit;

  // Dealer/owner only — permanently remove this repair and all its records.
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

  const openServiceEdit = () => {
    if (!isActiveRepair && !dealerDeliveredEdit) return;
    setEditDiagnosis(repair.diagnosis || '');
    setEditWorkPerformed(repair.workPerformed || '');
    setEditTesting({ ...(repair.testingChecklist || {}) });
    setShowServiceEdit(true);
  };

  // "Continue & Save" — saves any unsaved Pass/Fail results first, then
  // opens the status picker so the label stays honest.
  const handleContinueAndSave = async () => {
    if (updating) return;
    if (testingEditable && testingTabDirty) {
      setUpdating(true);
      try {
        await repairTesting(repair.id, { checklist: editTesting });
        const savedFail = Object.values(editTesting).some(v => v === false);
        await loadAll();
        queryClient.invalidateQueries();
        setUpdating(false);
        if (savedFail) {
          Alert.alert(
            'Testing Failed',
            'Ek ya zyada testing items fail hain. Aage kya karna hai?',
            [
              { text: 'Baad mein', style: 'cancel' },
              { text: 'Return to Repair', onPress: () => handleStatusUpdate('repairing') },
            ],
          );
          return;
        }
      } catch (e: any) {
        setUpdating(false);
        Alert.alert('Error', e.message);
        return;
      }
    }
    setShowStatusPicker(true);
  };

  // Save Pass/Fail results directly from the Testing tab.
  const handleSaveTestingTab = async () => {
    if (updating || !testingTabDirty) return;
    setUpdating(true);
    try {
      await repairTesting(repair.id, { checklist: editTesting });
      const savedFail = Object.values(editTesting).some(v => v === false);
      await loadAll();
      queryClient.invalidateQueries();
      if (savedFail) {
        setTimeout(() => {
          Alert.alert(
            'Testing Failed',
            'Ek ya zyada testing items fail hain. Aage kya karna hai?',
            [
              { text: 'Baad mein', style: 'cancel' },
              { text: 'Return to Repair', onPress: () => handleStatusUpdate('repairing') },
            ],
          );
        }, 300);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setUpdating(false);
    }
  };

  // Shared Pass/Fail rows for testing checklists. An item already saved as
  // Pass on the server is locked: shown but not editable.
  const renderTestingRows = (
    values: Record<string, boolean>,
    setValues: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
    disabledAll = false,
  ) => (
    <View style={{ gap: 8 }}>
      {CHECKLIST_ITEMS.map((item) => {
        const locked = disabledAll || (repair.testingChecklist || {})[item.id] === true;
        const value = values[item.id]; // true = Pass, false = Fail, undefined = not tested
        const setValue = (v: boolean) => {
          if (locked) return;
          setValues(prev => {
            if (prev[item.id] === v) {
              const next = { ...prev };
              delete next[item.id];
              return next;
            }
            return { ...prev, [item.id]: v };
          });
        };
        return (
          <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, backgroundColor: colors.card, borderColor: colors.border, opacity: locked ? 0.75 : 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              {locked && <Feather name="lock" size={11} color={colors.mutedForeground} />}
              <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>{item.label}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TouchableOpacity
                activeOpacity={locked ? 1 : 0.7}
                disabled={locked}
                onPress={() => setValue(true)}
                style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1, backgroundColor: value === true ? colors.success + '22' : 'transparent', borderColor: value === true ? colors.success : colors.border }}
              >
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: value === true ? colors.success : colors.mutedForeground }}>Pass</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={locked ? 1 : 0.7}
                disabled={locked}
                onPress={() => setValue(false)}
                style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1, backgroundColor: value === false ? colors.destructive + '22' : 'transparent', borderColor: value === false ? colors.destructive : colors.border }}
              >
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: value === false ? colors.destructive : colors.mutedForeground }}>Fail</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );

  const handleSaveService = async () => {
    setUpdating(true);
    try {
      // Only the current stage's fields are sent; locked fields stay
      // untouched. The complaint is permanently fixed at intake — it is
      // never sent from here.
      if (svcEditable) {
        await repairsUpdate(repair.id, { diagnosis: editDiagnosis, workPerformed: editWorkPerformed });
      }
      let savedFail = false;
      if (testingEditable) {
        const savedTesting = repair.testingChecklist || {};
        if (JSON.stringify(editTesting) !== JSON.stringify(savedTesting)) {
          await repairTesting(repair.id, { checklist: editTesting });
          savedFail = Object.values(editTesting).some(v => v === false);
        }
      }
      setShowServiceEdit(false);
      await loadAll();
      queryClient.invalidateQueries();
      if (!savedFail && isActiveRepair) {
        // "Update Status" flow: after saving, go straight to the status
        // picker so the job can continue to the next stage. (Delivered jobs
        // being corrected by the dealer just save — no status change.)
        setTimeout(() => setShowStatusPicker(true), 400);
      }
      if (savedFail) {
        // A testing item failed: the job either goes back to repair or the
        // device is returned to the customer without repair.
        setTimeout(() => {
          Alert.alert(
            'Testing Failed',
            'Ek ya zyada testing items fail hain. Aage kya karna hai?',
            [
              { text: 'Baad mein', style: 'cancel' },
              { text: 'Return to Repair', onPress: () => handleStatusUpdate('repairing') },
              {
                text: 'Customer Return',
                style: 'destructive',
                onPress: () => {
                  Alert.alert(
                    'Customer Return',
                    'Device bina repair ke customer ko wapas kiya jayega aur job "Cannot Repair" mark hogi. Pakka?',
                    [
                      { text: 'Nahi', style: 'cancel' },
                      { text: 'Haan, confirm', style: 'destructive', onPress: () => handleStatusUpdate('cannot_repair') },
                    ],
                  );
                },
              },
            ],
          );
        }, 400);
      }
    } catch (e: any) {
       Alert.alert('Error', e.message);
    } finally {
      setUpdating(false);
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
            <h1 style="text-align: center;">VMC Electronics - Job Card</h1>
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />

      {/* HEADER: back | JobID + status | more */}
      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.repairId, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{repair.repairId}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <RepairStatusBadge status={repair.status} />
            {repair.isSample && <SampleBadge />}
          </View>
        </View>
        <TouchableOpacity onPress={() => setShowMore(true)} style={styles.backBtn}>
          <Feather name="more-vertical" size={22} color={colors.foreground} />
          {/* Hidden QR Code for PDF Generation */}
          <View style={{ position: 'absolute', opacity: 0 }} pointerEvents="none">
             <QRCode value={repair.id} size={150} getRef={(c) => (qrRef.current = c)} />
          </View>
        </TouchableOpacity>
      </View>

      <KeyboardAwareScrollViewCompat showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + 120 }]} bottomOffset={24}>

        {/* 1. REPAIR PROGRESS */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            {[
              { label: 'Received' },
              { label: 'Repairing' },
              { label: 'Testing' },
              { label: 'Ready' },
              { label: 'Delivered' }
            ].map((step, index, arr) => {
              const isTerminal = repair.status === 'cancelled' || repair.status === 'cannot_repair';
              let label = step.label;
              let state: 'completed' | 'current' | 'upcoming' | 'error' = 'upcoming';
              if (isTerminal) {
                if (index === arr.length - 1) { state = 'error'; label = repair.status === 'cancelled' ? 'Cancelled' : 'Failed'; }
              } else if (stageIndex > index) state = 'completed';
              else if (stageIndex === index) state = 'current';

              const isCompleted = state === 'completed';
              const isCurrent = state === 'current';
              const isError = state === 'error';
              const circleColor = isError ? colors.destructive : isCompleted ? colors.success : isCurrent ? colors.primary : 'transparent';
              return (
                <View key={step.label} style={{ flex: 1, alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                    <View style={{ flex: 1, height: 2, backgroundColor: index === 0 ? 'transparent' : (isCompleted || isCurrent ? colors.success : colors.border) }} />
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: circleColor, borderWidth: isCompleted || isCurrent || isError ? 0 : 1, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                      {isCompleted ? <Feather name="check" size={12} color="#FFF" /> : isError ? <Feather name="x" size={12} color="#FFF" /> : isCurrent ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' }} /> : null}
                    </View>
                    <View style={{ flex: 1, height: 2, backgroundColor: index === arr.length - 1 ? 'transparent' : (isCompleted ? colors.success : colors.border) }} />
                  </View>
                  <Text style={{ fontSize: 9, color: isCurrent ? colors.foreground : colors.mutedForeground, marginTop: 5, fontFamily: isCurrent ? 'Inter_600SemiBold' : 'Inter_400Regular' }} numberOfLines={1}>{label}</Text>
                </View>
              );
            })}
          </View>
        </Card>

        {/* 2. CUSTOMER */}
        <Card>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>CUSTOMER</Text>
          <Text style={{ fontSize: 15, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginTop: 2 }}>{repair.customerName}</Text>
          {!!repair.dealerName && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.primary + '15', borderWidth: 1, borderColor: colors.primary + '33' }}>
              <Feather name="briefcase" size={12} color={colors.primary} />
              <Text style={{ fontSize: 12, color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Dealer: {repair.dealerName}</Text>
            </View>
          )}
          <TouchableOpacity onPress={() => Linking.openURL(`tel:${repair.mobile}`)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={{ fontSize: 14, color: colors.primary, fontFamily: 'Inter_500Medium' }}>{repair.mobile}</Text>
            <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: colors.primary + '15', borderWidth: 1, borderColor: colors.primary + '33', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="phone" size={15} color={colors.primary} />
            </View>
          </TouchableOpacity>
        </Card>

        {/* 3. DEVICE */}
        <Card>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>DEVICE</Text>
          <Text style={{ fontSize: 15, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginTop: 2 }}>{repair.brand} {repair.model}</Text>
          {[repair.color, repair.storage, repair.ram].filter(Boolean).length > 0 && (
            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4 }}>{[repair.color, repair.storage, repair.ram].filter(Boolean).join(' / ')}</Text>
          )}
        </Card>

        {/* 4-5. SERVICE WORKFLOW — Complaint / Diagnosis / Repairing / Testing tabs */}
        <Card style={{ paddingHorizontal: 12 }}>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
            {([
              { id: 'complaint', label: 'Complaint' },
              { id: 'diagnosis', label: 'Diagnosis' },
              { id: 'repairing', label: 'Repairing' },
              { id: 'testing', label: 'Testing' },
            ] as const).map((t) => {
              const active = activeSvcTab === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setSvcTab(t.id)}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center', borderWidth: 1, backgroundColor: active ? colors.primary + '18' : 'transparent', borderColor: active ? colors.primary : colors.border }}
                >
                  <Text style={{ fontSize: 12, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium', color: active ? colors.primary : colors.mutedForeground }}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {activeSvcTab === 'complaint' && (
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>CUSTOMER COMPLAINT</Text>
                <Feather name="lock" size={11} color={colors.mutedForeground} />
              </View>
              <Text style={{ fontSize: 14, color: colors.foreground, marginTop: 4, lineHeight: 20 }}>{repair.problem}</Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 8 }}>Complaint intake par note hota hai aur permanently fixed rehta hai — isse badla nahi ja sakta.</Text>
            </View>
          )}

          {activeSvcTab === 'diagnosis' && (
            <View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>DIAGNOSIS</Text>
                {svcStage > 1 && <Feather name="lock" size={12} color={colors.mutedForeground} />}
              </View>
              <Text style={{ fontSize: 14, color: repair.diagnosis ? colors.foreground : colors.warning, marginTop: 4, lineHeight: 20 }}>
                {repair.diagnosis || (svcStage === 0 ? 'Diagnosis repairing stage mein add hogi' : 'Diagnosis pending')}
              </Text>
              {((isActiveRepair && svcStage === 1) || dealerDeliveredEdit) && (
                <Button
                  title={dealerDeliveredEdit ? 'Edit Diagnosis' : repair.diagnosis ? 'Continue / Update' : 'Add Diagnosis'}
                  onPress={openServiceEdit}
                  style={{ marginTop: 12 }}
                />
              )}
            </View>
          )}

          {activeSvcTab === 'repairing' && (
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>CUSTOMER COMPLAINT</Text>
                <Feather name="lock" size={11} color={colors.mutedForeground} />
              </View>
              <Text style={{ fontSize: 13, color: colors.foreground, marginTop: 2, lineHeight: 19 }}>{repair.problem}</Text>

              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginTop: 12 }]}>DIAGNOSIS STATUS</Text>
              {repair.diagnosis ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 }}>
                  <Feather name="check-circle" size={14} color={colors.success} style={{ marginTop: 2 }} />
                  <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 19, flex: 1 }}>{repair.diagnosis}</Text>
                </View>
              ) : (
                <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 2 }}>{svcStage === 0 ? 'Not started' : 'Diagnosis pending'}</Text>
              )}

              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginTop: 12 }]}>REPAIR WORK</Text>
              <Text style={{ fontSize: 13, color: repair.workPerformed ? colors.foreground : colors.warning, marginTop: 2, lineHeight: 19 }}>
                {repair.workPerformed || 'Repairing pending'}
              </Text>
              {((isActiveRepair && svcStage === 1) || dealerDeliveredEdit) && (
                <Button
                  title={dealerDeliveredEdit ? 'Edit Repair Work' : repair.workPerformed ? 'Update Repair Work' : 'Add Repair Work'}
                  onPress={openServiceEdit}
                  style={{ marginTop: 12 }}
                />
              )}
            </View>
          )}

          {activeSvcTab === 'testing' && (
            <View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>TESTING — PASS / FAIL</Text>
                {!testingEditable && <Feather name="lock" size={12} color={colors.mutedForeground} />}
              </View>
              {svcStage < 2 && Object.keys(repair.testingChecklist || {}).length === 0 ? (
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Testing yahan tab hogi jab job Testing stage par pahunchegi.</Text>
              ) : (
                <>
                  {renderTestingRows(editTesting, setEditTesting, !testingEditable)}
                  {testingEditable && testingTabDirty && (
                    <Button title="Save Testing" onPress={handleSaveTestingTab} loading={updating} style={{ marginTop: 12 }} />
                  )}
                </>
              )}
            </View>
          )}
        </Card>

        {/* 6. ESTIMATE & PAYMENT */}
        {canSeeFinance ? (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>ESTIMATE & PAYMENT</Text>
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: (payRemaining <= 0 && payTotal > 0) ? colors.success + '22' : payPaid > 0 ? colors.warning + '22' : colors.muted + '33' }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: (payRemaining <= 0 && payTotal > 0) ? colors.success : payPaid > 0 ? colors.warning : colors.mutedForeground }}>
                  {(payRemaining <= 0 && payTotal > 0) ? 'Paid' : payPaid > 0 ? 'Partially Paid' : 'Pending'}
                </Text>
              </View>
            </View>
            <InfoRow label="Estimate" value={formatCurrency(payTotal)} bold />
            <InfoRow label="Paid" value={formatCurrency(payPaid)} color={colors.success} />
            <InfoRow label="Balance" value={formatCurrency(payRemaining)} color={payRemaining > 0 ? colors.warning : colors.success} bold />
            <TouchableOpacity
              onPress={() => {
                setEditRepairCharge(repair.repairCharge.toString());
                setEditServiceCharge((repair.serviceCharge || 0).toString());
                setEditOtherCharge((repair.otherCharge || 0).toString());
                setEditDiscount((repair.discount || 0).toString());
                setEditTaxPercent((repair.taxPercent || 0).toString());
                setShowFinancialEdit(true);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}
            >
              <Feather name="edit-2" size={13} color={colors.primary} />
              <Text style={{ fontSize: 13, color: colors.primary, fontFamily: 'Inter_500Medium' }}>Edit Estimate</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>WARRANTY</Text>
            <InfoRow label="Warranty Offered" value={`${repair.warrantyDays || 0} Days`} />
            {repair.warrantyExpiry && <InfoRow label="Warranty Expiry" value={formatDate(repair.warrantyExpiry)} />}
          </Card>
        )}

        {/* 7. CUSTOMER APPROVAL — only when actually required */}
        {canSeeFinance && (approvals.length > 0 || repair.status === 'customer_approval') && (
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 8 }]}>CUSTOMER APPROVAL</Text>
            {approvals.length === 0 && (
              <>
                <InfoRow label="Amount" value={formatCurrency(repair.repairCharge + repair.partsCharge)} bold />
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Status</Text>
                  <Text style={{ fontSize: 13, color: colors.warning, fontFamily: 'Inter_600SemiBold' }}>Pending</Text>
                </View>
                {isActiveRepair && (
                  <Button title="Send Approval Request" onPress={() => setShowApproval(true)} style={{ marginTop: 10 }} />
                )}
              </>
            )}
            {approvals.map(app => (
              <View key={app.id} style={{ paddingVertical: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>₹{app.oldAmount} → ₹{app.newAmount}</Text>
                  <Text style={{ fontSize: 12, color: app.status === 'pending' ? colors.warning : app.status === 'approved' ? colors.success : colors.destructive, textTransform: 'uppercase', fontFamily: 'Inter_700Bold' }}>{app.status}</Text>
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
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>PARTS REPLACED</Text>
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
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Qty: {p.quantity} {p.canSeeCosts !== false ? `@ ${formatCurrency(p.unitCost)}` : ''}</Text>
                </View>
                {p.canSeeCosts !== false && (
                  <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{formatCurrency(p.quantity * p.unitCost)}</Text>
                )}
              </View>
            ))}
          </Card>
        )}

        {/* 9. Photos / More links */}
        <Card style={{ paddingVertical: 4 }}>
          <TouchableOpacity onPress={() => setShowMore(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Feather name="image" size={16} color={colors.primary} />
              <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_500Medium' }}>Photos{photosData?.photos?.length ? ` (${photosData.photos.length})` : ''}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <View style={{ height: 1, backgroundColor: colors.border + '55' }} />
          <TouchableOpacity onPress={() => setShowMore(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Feather name="list" size={16} color={colors.primary} />
              <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_500Medium' }}>Full Details & History</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </Card>
      </KeyboardAwareScrollViewCompat>

      {/* STICKY PRIMARY ACTIONS */}
      <View style={[styles.actionBar, { backgroundColor: colors.background, borderTopColor: colors.border, bottom: tabBarHeight, paddingBottom: 12 }]}>
        {repair.status === 'delivered' ? (
          isDealer ? (
            <View>
              <View style={[styles.doneBar, { backgroundColor: colors.success + '18', borderColor: colors.success + '44' }]}>
                <Feather name="check-circle" size={18} color={colors.success} />
                <Text style={{ fontSize: 15, color: colors.success, fontFamily: 'Inter_700Bold' }}>JOB COMPLETED ✓</Text>
              </View>
              {/* Dealer/owner corrections on a delivered job: edit or delete. */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Edit Details" variant="outline" onPress={openServiceEdit} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Delete Repair"
                    variant="outline"
                    onPress={() => {
                      Alert.alert(
                        'Delete Repair',
                        `${repair.repairId} hamesha ke liye delete ho jayega — payments, parts, photos aur history bhi. Yeh wapas nahi aa sakta. Pakka delete karein?`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Haan, Delete Karein', style: 'destructive', onPress: handleDeleteRepair },
                        ],
                      );
                    }}
                  />
                </View>
              </View>
            </View>
          ) : (
            <View style={[styles.doneBar, { backgroundColor: colors.success + '18', borderColor: colors.success + '44' }]}>
              <Feather name="check-circle" size={18} color={colors.success} />
              <Text style={{ fontSize: 15, color: colors.success, fontFamily: 'Inter_700Bold' }}>JOB COMPLETED ✓</Text>
            </View>
          )
        ) : (repair.status === 'cancelled' || repair.status === 'cannot_repair') ? (
          <View>
            <View style={[styles.doneBar, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '44' }]}>
              <Feather name="x-circle" size={18} color={colors.destructive} />
              <Text style={{ fontSize: 15, color: colors.destructive, fontFamily: 'Inter_700Bold' }}>{repair.status === 'cancelled' ? 'CANCELLED' : 'CANNOT REPAIR'}</Text>
            </View>
            {/* Dealer/owner can permanently remove a cancelled / cannot-repair job. */}
            {isDealer && (
              <View style={{ marginTop: 10 }}>
                <Button
                  title="Delete Repair"
                  variant="outline"
                  onPress={() => {
                    Alert.alert(
                      'Delete Repair',
                      `${repair.repairId} hamesha ke liye delete ho jayega — payments, parts, photos aur history bhi. Yeh wapas nahi aa sakta. Pakka delete karein?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Haan, Delete Karein', style: 'destructive', onPress: handleDeleteRepair },
                      ],
                    );
                  }}
                />
              </View>
            )}
          </View>
        ) : repair.status === 'ready' ? (
          // READY: Mark as Delivered stays hidden until payment is fully collected.
          payRemainingCents > 0 ? (
            <View>
              {canSeeFinance ? (
                <Button title="Collect Payment" onPress={openPaymentModal} />
              ) : (
                <View style={[styles.paidChip, { backgroundColor: colors.warning + '15', borderColor: colors.warning + '44', paddingVertical: 12, paddingHorizontal: 16 }]}>
                  <Feather name="clock" size={15} color={colors.warning} />
                  <Text style={{ fontSize: 14, color: colors.warning, fontFamily: 'Inter_600SemiBold' }}>Payment Pending</Text>
                </View>
              )}
              <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', marginTop: 6, fontFamily: 'Inter_400Regular' }}>
                Delivery tabhi hogi jab poora payment collect ho jaye ({formatCurrency(payRemaining)} baaki hai)
              </Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={[styles.paidChip, { backgroundColor: colors.success + '18', borderColor: colors.success + '44', flex: 2, paddingVertical: 12 }]}>
                <Feather name="check" size={15} color={colors.success} />
                <Text style={{ fontSize: 14, color: colors.success, fontFamily: 'Inter_600SemiBold' }}>Paid ✓</Text>
              </View>
              {canUpdateStatus && (
                <View style={{ flex: 3 }}>
                  <Button
                    title="Mark as Delivered"
                    onPress={() => {
                      Alert.alert('Confirm Delivery', 'Has the customer received the device?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Confirm Delivery', onPress: () => setShowDeliveryHandover(true) },
                      ]);
                    }}
                  />
                </View>
              )}
            </View>
          )
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {/* Collect Payment on the LEFT, Continue & Save on the RIGHT */}
            {canSeeFinance && (
              (payRemaining <= 0 && payTotal > 0) ? (
                <View style={[styles.paidChip, { backgroundColor: colors.success + '18', borderColor: colors.success + '44', flex: 2 }]}>
                  <Feather name="check" size={15} color={colors.success} />
                  <Text style={{ fontSize: 14, color: colors.success, fontFamily: 'Inter_600SemiBold' }}>Paid ✓</Text>
                </View>
              ) : (
                <View style={{ flex: 2 }}>
                  <Button title="Collect Payment" variant={canUpdateStatus ? 'outline' : undefined} onPress={openPaymentModal} />
                </View>
              )
            )}
            {canUpdateStatus && (
              <View style={{ flex: 3 }}>
                <Button title="Continue & Save" onPress={handleContinueAndSave} loading={updating} />
              </View>
            )}
          </View>
        )}
      </View>

      {/* Update Status — next step only */}
      <Modal visible={showStatusPicker} animationType="slide" transparent>
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
                  <Text style={{ fontSize: 16, color: nextStepBlocked ? colors.mutedForeground : colors.primary, fontFamily: 'Inter_700Bold' }}>{nextStep.label}</Text>
                </View>
                <Text style={{ fontSize: 12, color: nextStepBlocked ? colors.destructive : colors.mutedForeground, marginTop: 2 }}>
                  {nextStepBlocked ? `Please complete this step first: ${stageMissing.join(', ')}` : nextStep.desc}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 12 }}>No further status. Use Mark as Delivered.</Text>
            )}
            {isActiveRepair && (user?.role === 'dealer' || user?.role === 'super_admin') && (
              <TouchableOpacity
                onPress={() => {
                  Alert.alert('Cancel Repair', 'Mark this job as cancelled?', [
                    { text: 'No', style: 'cancel' },
                    { text: 'Yes, Cancel Job', style: 'destructive', onPress: () => handleStatusUpdate('cancelled') },
                  ]);
                }}
                style={{ borderWidth: 1, borderColor: colors.destructive + '55', borderRadius: 12, padding: 12, marginBottom: 12, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 13, color: colors.destructive, fontFamily: 'Inter_500Medium' }}>Cancel Repair Job</Text>
              </TouchableOpacity>
            )}
            <Button title="Cancel" variant="outline" onPress={() => setShowStatusPicker(false)} />
          </View>
        </View>
      </Modal>

      {/* MORE — full details & history */}
      <Modal visible={showMore} animationType="slide" onRequestClose={() => setShowMore(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.header, { paddingTop: topPad + 14 }]}>
            <TouchableOpacity onPress={() => setShowMore(false)} style={styles.backBtn}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={{ fontSize: 17, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{repair.repairId} — Details</Text>
            <View style={{ width: 44 }} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>

            <TouchableOpacity onPress={generatePDF} style={[styles.pdfBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '33' }]}>
              <Feather name="file-text" size={18} color={colors.primary} />
              <Text style={[styles.pdfBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Download Job Card PDF</Text>
            </TouchableOpacity>

            {/* Job Info */}
            <Card style={{ paddingHorizontal: 16 }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 }]}>JOB INFO</Text>
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

            {/* Full Device Details */}
            <Card>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>FULL DEVICE DETAILS</Text>
              <InfoRow label="Brand & Model" value={`${repair.deviceType ? repair.deviceType + ' - ' : ''}${repair.brand} ${repair.model}`} bold />
              {[repair.color, repair.storage, repair.ram].filter(Boolean).length > 0 && <InfoRow label="Color / Storage / RAM" value={[repair.color, repair.storage, repair.ram].filter(Boolean).join(' / ')} />}
              {repair.imei ? <InfoRow label="IMEI 1" value={repair.imei} /> : null}
              {repair.imei2 ? <InfoRow label="IMEI 2" value={repair.imei2} /> : null}
              {repair.serialNumber ? <InfoRow label="Serial No" value={repair.serialNumber} /> : null}
              <InfoRow label="SIM / SD Card" value={`SIM: ${repair.simPresent ? 'Yes' : 'No'} · SD: ${repair.memoryCardPresent ? 'Yes' : 'No'}`} />
              {repair.alternateMobile ? <InfoRow label="Alternate Mobile" value={repair.alternateMobile} /> : null}
              {(repair.accessoriesList?.length || repair.accessories) ? <InfoRow label="Accessories" value={(repair.accessoriesList?.length ? repair.accessoriesList.join(', ') : '') + (repair.accessories ? ` ${repair.accessories}` : '')} /> : null}
              {repair.status === 'delivered' && repair.paymentMethod ? <InfoRow label="Payment Method" value={repair.paymentMethod} /> : null}
            </Card>

            {/* Condition Checklist */}
            {(Object.keys(repair.checklist || {}).length > 0 || Object.values(repair.physicalCondition || {}).some(Boolean)) && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 12 }]}>CONDITION CHECKLIST (At Intake)</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {Object.keys(repair.checklist || {}).map(k => {
                    const isWorking = repair.checklist![k];
                    return (
                      <View key={k} style={{ padding: 8, borderRadius: 8, backgroundColor: isWorking ? colors.success + '15' : colors.destructive + '15', borderWidth: 1, borderColor: isWorking ? colors.success + '33' : colors.destructive + '33', width: '31%' }}>
                        <Text style={{ fontSize: 11, color: isWorking ? colors.success : colors.destructive, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>{CHECKLIST_ITEMS.find(c => c.id === k)?.label || k}</Text>
                        <Text style={{ fontSize: 10, color: isWorking ? colors.success : colors.destructive }}>{isWorking ? 'Working' : 'Not Working'}</Text>
                      </View>
                    );
                  })}
                  {Object.keys(repair.physicalCondition || {}).map(k => {
                    if (!repair.physicalCondition![k]) return null;
                    return (
                      <View key={k} style={{ padding: 8, borderRadius: 8, backgroundColor: colors.warning + '15', borderWidth: 1, borderColor: colors.warning + '33', width: '31%' }}>
                        <Text style={{ fontSize: 11, color: colors.warning, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>Body</Text>
                        <Text style={{ fontSize: 10, color: colors.warning }}>{k.replace(/_/g, ' ')}</Text>
                      </View>
                    );
                  })}
                </View>
              </Card>
            )}

            {/* Testing Results */}
            {Object.keys(repair.testingChecklist || {}).length > 0 && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 12 }]}>TESTING RESULTS</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {Object.keys(repair.testingChecklist || {}).map(k => {
                    const passed = repair.testingChecklist![k];
                    return (
                      <View key={k} style={{ padding: 8, borderRadius: 8, backgroundColor: passed ? colors.success + '15' : colors.destructive + '15', borderWidth: 1, borderColor: passed ? colors.success + '33' : colors.destructive + '33', width: '31%' }}>
                        <Text style={{ fontSize: 11, color: passed ? colors.success : colors.destructive, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>{CHECKLIST_ITEMS.find(c => c.id === k)?.label || k}</Text>
                        <Text style={{ fontSize: 10, color: passed ? colors.success : colors.destructive }}>{passed ? 'Pass' : 'Fail'}</Text>
                      </View>
                    );
                  })}
                </View>
              </Card>
            )}

            {/* Work / Parts */}
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>WORK & PARTS</Text>
                {isActiveRepair && (
                  <TouchableOpacity onPress={() => { setShowMore(false); setTimeout(() => setShowAddPart(true), 350); }}>
                    <Feather name="plus-circle" size={16} color={colors.primary} />
                  </TouchableOpacity>
                )}
              </View>
              <Text style={{ fontSize: 12, color: colors.primary, marginBottom: 4, fontFamily: 'Inter_500Medium' }}>Work Performed</Text>
              <Text style={{ fontSize: 13, color: colors.foreground, marginBottom: 12 }}>{repair.workPerformed || 'Pending'}</Text>
              {parts.length > 0 && (
                <>
                  <Text style={{ fontSize: 12, color: colors.primary, marginBottom: 4, fontFamily: 'Inter_500Medium' }}>Parts Replaced</Text>
                  {parts.map((p, idx) => (
                    <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: idx === parts.length - 1 ? 0 : 1, borderBottomColor: colors.border + '55' }}>
                      <View>
                        <Text style={{ fontSize: 13, color: colors.foreground }}>{p.partName}</Text>
                        <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Qty: {p.quantity} {p.canSeeCosts !== false ? `@ ${formatCurrency(p.unitCost)}` : ''}</Text>
                      </View>
                      {p.canSeeCosts !== false && (
                        <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{formatCurrency(p.quantity * p.unitCost)}</Text>
                      )}
                    </View>
                  ))}
                </>
              )}
            </Card>

            {/* Charge breakdown (finance only) */}
            {canSeeFinance && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>CHARGE BREAKDOWN</Text>
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
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 16 }]}>PAYMENT HISTORY</Text>
                {payments.map(pmt => (
                  <View key={pmt.id} style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 10, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{pmt.method === 'UPI' ? 'UPI' : pmt.method === 'Cash' ? 'Cash' : 'Card'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{formatCurrency(pmt.amount)}</Text>
                        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{pmt.method}</Text>
                        <Text style={{ fontSize: 10, color: colors.primary, backgroundColor: colors.primary + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' }}>{pmt.kind}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{formatDate(pmt.createdAt)}</Text>
                      {pmt.referenceNo ? <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Txn ID: {pmt.referenceNo}</Text> : null}
                      <Text style={{ fontSize: 11, color: colors.mutedForeground }}>By: {pmt.receivedByName || pmt.recordedByName || 'Staff'}</Text>
                    </View>
                  </View>
                ))}
                {visibleRefunds.map(rf => (
                  <View key={rf.id} style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: colors.destructive + '15', borderWidth: 1, borderColor: colors.destructive + '33', alignItems: 'center', justifyContent: 'center' }}>
                      <Feather name="corner-down-left" size={16} color={colors.destructive} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ fontSize: 14, color: colors.destructive, fontFamily: 'Inter_600SemiBold' }}>-{formatCurrency(rf.amount)}</Text>
                        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Refund ({rf.method})</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{formatDate(rf.paidAt || rf.createdAt)}</Text>
                    </View>
                  </View>
                ))}
              </Card>
            )}

            {/* Photos */}
            {photosData?.photos && photosData.photos.length > 0 && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 12 }]}>DOCUMENTS & PHOTOS</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {photosData.photos.map(p => (
                    <View key={p.id} style={{ width: 80 }}>
                      <View style={{ width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 6 }}>
                        <Image source={{ uri: getAbsoluteUrl(p.objectPath), headers: { Authorization: `Bearer ${token}` } }} style={{ width: '100%', height: '100%' }} />
                      </View>
                      <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: 'center' }} numberOfLines={1}>{p.kind.replace(/_/g, ' ')}</Text>
                    </View>
                  ))}
                </View>
              </Card>
            )}

            {/* Signatures */}
            {(repair.receivingSignaturePath || repair.deliverySignaturePath) && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>SIGNATURES</Text>
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  {repair.receivingSignaturePath && (
                    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                      <Image source={{ uri: getAbsoluteUrl(repair.receivingSignaturePath), headers: { Authorization: `Bearer ${token}` } }} style={styles.sigImg} contentFit="contain" />
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Receiving</Text>
                    </View>
                  )}
                  {repair.deliverySignaturePath && (
                    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                      <Image source={{ uri: getAbsoluteUrl(repair.deliverySignaturePath), headers: { Authorization: `Bearer ${token}` } }} style={styles.sigImg} contentFit="contain" />
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Delivery</Text>
                    </View>
                  )}
                </View>
              </Card>
            )}

            {/* Activity Timeline */}
            {eventsData?.events && eventsData.events.length > 0 && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 16 }]}>ACTIVITY TIMELINE</Text>
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
                        <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 2 }}>
                          {new Date(ev.createdAt).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', day: '2-digit', month: 'short', year: 'numeric' })}
                        </Text>
                        <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_500Medium' }}>{ev.action}</Text>
                        <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>By: {ev.userName} ({ev.userRole})</Text>
                      </View>
                    </View>
                  );
                })}
              </Card>
            )}

            {/* Staff Notes */}
            {!!repair.notes && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 8 }]}>STAFF NOTES</Text>
                <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 20 }}>{repair.notes}</Text>
              </Card>
            )}

            {/* After Sale Service */}
            {(repairReturns.length > 0 || repair.status === 'delivered') && (
              <Card>
                <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 12 }]}>AFTER SALE SERVICE</Text>
                {repairReturns.map(ret => (
                  <TouchableOpacity
                    key={ret.id}
                    onPress={() => { setShowMore(false); router.push(`/(tabs)/repairs/return/${ret.id}` as any); }}
                    style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}
                  >
                    <View>
                      <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{ret.returnId}</Text>
                      <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 }}>{formatDate(ret.createdAt)}</Text>
                    </View>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: getReturnStatusColor(ret.status, colors) + '22' }}>
                      <Text style={{ fontSize: 11, color: getReturnStatusColor(ret.status, colors), fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' }}>
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
          </ScrollView>
        </View>
      </Modal>

      {/* Delivery Handover Modal */}
      <Modal visible={showDeliveryHandover} animationType="fade" transparent>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, marginBottom: 4 }]}>Delivery Handover</Text>
            
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary + '11', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: colors.primary + '22' }}>
              <Feather name="check-circle" size={16} color={colors.primary} />
              <Text style={{ fontSize: 13, color: colors.primary, fontFamily: 'Inter_600SemiBold', flex: 1 }}>Verify device fully working before handover</Text>
            </View>

            <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 16 }}>Review final amounts and collect payment before signature.</Text>
            
            {canSeeFinance && (
              <View style={{ backgroundColor: colors.card, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 16 }}>
                <InfoRow label="Labour / Repair Charge" value={formatCurrency(repair.repairCharge)} />
                <InfoRow label="Parts Charge" value={formatCurrency(repair.partsCharge)} />
                <View style={styles.divider} />
                <InfoRow label="Total" value={formatCurrency(repair.repairCharge + repair.partsCharge)} />
                <InfoRow label="Advance Paid" value={formatCurrency(repair.advance)} color={colors.success} />
                <View style={styles.divider} />
                <InfoRow label="Balance Payable" value={formatCurrency(balance)} color={balance > 0 ? colors.warning : colors.success} bold />
              </View>
            )}
            
            <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_500Medium', marginBottom: 8 }}>Payment Method</Text>
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
            

            <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_500Medium', marginBottom: 8 }}>Warranty (Days)</Text>
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
                  <Text style={{ color: deliveryWarranty === w ? '#FFF' : colors.foreground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
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

            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowDeliveryHandover(false)} style={{ flex: 1 }} />
              <Button title="Send OTP" variant="outline" onPress={async () => {
                try {
                  await deliveryOtpSend(repair.id);
                  setShowDeliveryHandover(false);
                  setTimeout(() => setShowDeliveryOtp(true), 350);
                } catch(e: any) { Alert.alert('Error', e.message); }
              }} style={{ flex: 1 }} />
            </View>
            <Button title="Proceed to Signature (No OTP)" onPress={handleHandoverProceed} style={{ width: '100%' }} />

          </View>
        </KeyboardAvoidingCompat>
      </Modal>

      {/* Add Part Modal */}
      <Modal visible={showAddPart} animationType="fade" transparent>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Part</Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 12 }}>
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

      
      {/* Collect Payment Modal */}
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
                  <Text style={{ fontSize: 24, color: colors.success, fontFamily: 'Inter_700Bold', marginBottom: 8 }}>{formatCurrency(paymentSuccess.amount)}</Text>
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
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={[styles.modalTitle, { color: colors.foreground, marginBottom: 2 }]}>Collect Payment</Text>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 10 }}>Record payment received from customer</Text>
                  </View>
                  <TouchableOpacity onPress={() => setShowPayment(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ padding: 4 }}>
                    <Feather name="x" size={20} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.label, { color: colors.foreground }]}>Amount <Text style={{ color: colors.destructive }}>*</Text></Text>
                <View collapsable={false} style={[styles.input, { borderColor: paymentAmountError ? colors.destructive : colors.border, flexDirection: 'row', alignItems: 'center', paddingVertical: 0 }]}>
                  <Text style={{ fontSize: 15, color: colors.mutedForeground, marginRight: 4 }}>₹</Text>
                  <TextInput
                    value={paymentAmount}
                    onChangeText={onPaymentAmountChange}
                    keyboardType="numeric"
                    autoFocus
                    placeholder="Enter amount"
                    placeholderTextColor={colors.mutedForeground}
                    style={{ flex: 1, paddingVertical: 10, fontSize: 15, color: colors.foreground }}
                  />
                </View>
                {!!paymentAmountError && (
                  <Text style={{ fontSize: 12, color: colors.destructive, marginTop: 4 }}>{paymentAmountError}</Text>
                )}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  {[100, 500, 1000].map(v => (
                    <TouchableOpacity key={v} onPress={() => onPaymentAmountChange(String(v))} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: paymentAmount === String(v) ? colors.primary : colors.border, backgroundColor: paymentAmount === String(v) ? colors.primary + '22' : colors.card }}>
                      <Text style={{ fontSize: 13, color: paymentAmount === String(v) ? colors.primary : colors.foreground, fontFamily: 'Inter_500Medium' }}>₹{v}</Text>
                    </TouchableOpacity>
                  ))}
                  {payRemaining > 0 && (() => {
                    const fullStr = String(Math.round(payRemaining * 100) / 100);
                    const active = paymentAmount === fullStr;
                    return (
                      <TouchableOpacity onPress={() => onPaymentAmountChange(fullStr)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + '22' : colors.card }}>
                        <Text style={{ fontSize: 13, color: active ? colors.primary : colors.foreground, fontFamily: 'Inter_500Medium' }}>Full</Text>
                      </TouchableOpacity>
                    );
                  })()}
                </View>

                <Text style={[styles.label, { color: colors.foreground }]}>Payment Method <Text style={{ color: colors.destructive }}>*</Text></Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                  {([['Cash', 'dollar-sign'], ['UPI', 'smartphone'], ['Card', 'credit-card'], ['Bank Transfer', 'home'], ['Other', 'more-horizontal']] as const).map(([m, icon]) => {
                    const active = paymentMethod === m;
                    return (
                      <TouchableOpacity key={m} onPress={() => { setPaymentMethod(m); setPaymentReference(''); }} style={{ width: '30.5%', alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + '18' : colors.card }}>
                        <Feather name={icon} size={20} color={active ? colors.primary : colors.mutedForeground} />
                        <Text style={{ fontSize: 12, marginTop: 6, color: active ? colors.primary : colors.foreground, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium' }} numberOfLines={1}>{m}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {!!paymentReferenceLabel && (
                  <View collapsable={false}>
                    <Text style={[styles.label, { color: colors.foreground }]}>{paymentReferenceLabel}{paymentReferenceRequired ? <Text style={{ color: colors.destructive }}> *</Text> : null}</Text>
                    <TextInput
                      value={paymentReference}
                      onChangeText={setPaymentReference}
                      placeholder={paymentReferenceRequired ? 'Enter transaction reference' : 'Optional reference / details'}
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                    />
                  </View>
                )}

                <Text style={[styles.label, { color: colors.foreground }]}>Payment Type</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                  {['advance', 'partial', 'final'].map(k => (
                    <TouchableOpacity key={k} onPress={() => { setPaymentKind(k); setPaymentKindTouched(true); }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: paymentKind === k ? colors.primary : colors.card, borderWidth: 1, borderColor: paymentKind === k ? colors.primary : colors.border }}>
                      <Text style={{ color: paymentKind === k ? '#FFF' : colors.foreground, textTransform: 'capitalize' }}>{k}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={[styles.label, { color: colors.foreground }]}>Note / Reference (Optional)</Text>
                <View collapsable={false}>
                  <TextInput
                    value={paymentNote}
                    onChangeText={setPaymentNote}
                    maxLength={120}
                    placeholder="Add note or reference..."
                    placeholderTextColor={colors.mutedForeground}
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                  />
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, alignSelf: 'flex-end', marginTop: 2 }}>{paymentNote.length}/120</Text>
                </View>

                {/* Real-time totals (real data) */}
                <View collapsable={false} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginTop: 10, backgroundColor: colors.card }}>
                  <InfoRow label="Total Estimate" value={formatCurrency(payTotal)} />
                  <InfoRow label="Received Till Now" value={formatCurrency(payPaid)} color={colors.success} />
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={styles.infoRow}>
                    <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Remaining</Text>
                    <Text style={{ fontSize: 18, color: payRemaining > 0 ? colors.primary : colors.success, fontFamily: 'Inter_700Bold' }}>{formatCurrency(payRemaining)}</Text>
                  </View>
                </View>

                {/* Payment history (real ledger) */}
                {(payments.length > 0 || visibleRefunds.length > 0) && (
                  <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 6 }}>Payment History</Text>
                    {payments.map(pmt => (
                      <View key={pmt.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={{ fontSize: 13, color: colors.foreground }}>{pmt.method} · {pmt.kind}</Text>
                          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                            {formatDate(pmt.createdAt)}{(pmt.receivedByName || pmt.recordedByName) ? ` · ${pmt.receivedByName || pmt.recordedByName}` : ''}
                          </Text>
                          {!!pmt.referenceNo && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Ref: {pmt.referenceNo}</Text>}
                        </View>
                        <Text style={{ fontSize: 13, color: colors.success, fontFamily: 'Inter_600SemiBold' }}>{formatCurrency(pmt.amount)}</Text>
                      </View>
                    ))}
                    {visibleRefunds.map(rf => (
                      <View key={rf.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={{ fontSize: 13, color: colors.destructive }}>
                            Refund · {rf.method}{rf.status !== 'paid' ? ` (${rf.status})` : ''}
                          </Text>
                          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                            {formatDate(rf.paidAt || rf.createdAt)}{(rf.paidByName || rf.approvedByName || rf.requestedByName) ? ` · ${rf.paidByName || rf.approvedByName || rf.requestedByName}` : ''}
                          </Text>
                          {!!rf.referenceNo && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Ref: {rf.referenceNo}</Text>}
                        </View>
                        <Text style={{ fontSize: 13, color: colors.destructive, fontFamily: 'Inter_600SemiBold' }}>-{formatCurrency(rf.amount)}</Text>
                      </View>
                    ))}
                    <View style={styles.infoRow}>
                      <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{paidRefundsTotal > 0 ? 'Net Paid' : 'Total Paid'}</Text>
                      <Text style={{ fontSize: 13, color: colors.success, fontFamily: 'Inter_600SemiBold' }}>{formatCurrency(Math.max(0, payPaid - paidRefundsTotal))}</Text>
                    </View>
                  </View>
                )}

                <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                  <Button title="Cancel" variant="outline" onPress={() => setShowPayment(false)} style={{ flex: 1 }} />
                  <Button
                    title="Save Payment"
                    onPress={handleCollectPayment}
                    loading={updating}
                    disabled={!paymentFormValid || updating}
                    style={{ flex: 1 }}
                  />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 }}>
                  <Feather name="info" size={12} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>This payment will be recorded in payment history.</Text>
                </View>
              </KeyboardAwareScrollViewCompat>
            )}
          </View>
        </View>
      </Modal>


      {/* Testing Modal */}
      <Modal visible={showTesting} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Final Testing Checklist</Text>
            
            <ScrollView style={{ maxHeight: 400, marginVertical: 10 }}>
              {renderTestingRows(testingChecklist, setTestingChecklist)}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowTesting(false)} style={{ flex: 1 }} />
              <Button title="Confirm & Set Ready" onPress={async () => {
                setUpdating(true);
                try {
                  await repairTesting(repair.id, { checklist: testingChecklist, confirm: true });
                  setShowTesting(false);
                  await loadAll();
                  queryClient.invalidateQueries();
                } catch (e: any) {
                  Alert.alert('Testing Failed', e.message);
                } finally {
                  setUpdating(false);
                }
              }} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>


      {/* Estimate Approval Modal */}
      <Modal visible={showApproval} animationType="slide" transparent>
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
      <Modal visible={showFinancialEdit} animationType="fade" transparent>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Financials</Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 12 }}>
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

      {/* Service Edit Modal */}
      <Modal visible={showServiceEdit} animationType="fade" transparent>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Service Details</Text>

            <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Complaint (Fixed)</Text>
              <Feather name="lock" size={11} color={colors.mutedForeground} />
            </View>
            <Text style={{ fontSize: 14, color: colors.mutedForeground, lineHeight: 20, marginBottom: 12, paddingHorizontal: 2 }}>{repair.problem}</Text>

            {svcStage >= 1 && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.label, { color: svcEditable ? colors.foreground : colors.mutedForeground }]}>Diagnosis</Text>
                  {!svcEditable && <Feather name="lock" size={11} color={colors.mutedForeground} />}
                </View>
                <TextInput value={editDiagnosis} onChangeText={setEditDiagnosis} editable={svcEditable} multiline numberOfLines={3} style={[styles.input, { color: svcEditable ? colors.foreground : colors.mutedForeground, borderColor: colors.border, height: 80, textAlignVertical: 'top', opacity: svcEditable ? 1 : 0.7 }]} />

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.label, { color: svcEditable ? colors.foreground : colors.mutedForeground }]}>Work Performed</Text>
                  {!svcEditable && <Feather name="lock" size={11} color={colors.mutedForeground} />}
                </View>
                <TextInput value={editWorkPerformed} onChangeText={setEditWorkPerformed} editable={svcEditable} multiline numberOfLines={3} style={[styles.input, { color: svcEditable ? colors.foreground : colors.mutedForeground, borderColor: colors.border, height: 80, textAlignVertical: 'top', opacity: svcEditable ? 1 : 0.7 }]} />
              </>
            )}

            {svcStage >= 2 && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.label, { color: testingEditable ? colors.foreground : colors.mutedForeground }]}>Testing</Text>
                  {!testingEditable && <Feather name="lock" size={11} color={colors.mutedForeground} />}
                </View>
                {renderTestingRows(editTesting, setEditTesting, !testingEditable)}
              </>
            )}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => {
                  // Discarding unsaved edits needs a confirmation; saved data
                  // is never touched by closing this sheet.
                  const dirty =
                    (svcEditable && (editDiagnosis !== (repair.diagnosis || '') || editWorkPerformed !== (repair.workPerformed || ''))) ||
                    (testingEditable && JSON.stringify(editTesting) !== JSON.stringify(repair.testingChecklist || {}));
                  if (dirty) {
                    Alert.alert('Unsaved changes', 'Aapke changes save nahi hue hain. Bina save kiye band karein?', [
                      { text: 'Wapas jayen', style: 'cancel' },
                      { text: 'Haan, discard karein', style: 'destructive', onPress: () => setShowServiceEdit(false) },
                    ]);
                  } else {
                    setShowServiceEdit(false);
                  }
                }}
                style={{ flex: 1 }}
              />
              <Button title={dealerDeliveredEdit ? 'Save Changes' : 'Update Status'} onPress={handleSaveService} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </Modal>

      {/* Delivery Signature Modal */}
      <Modal visible={showDeliverySig} animationType="slide" transparent>
        <View style={[styles.modalOverlay, { backgroundColor: colors.background, padding: 0, justifyContent: 'flex-start' }]}>
          <View style={[styles.sigScreen, { paddingTop: topPad + 8 }]}>
            <View style={styles.sigHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Delivery Signature</Text>
                <Text style={[styles.sigSubtitle, { color: colors.mutedForeground }]}>Customer signs below to confirm receipt of the device</Text>
              </View>
              <TouchableOpacity onPress={() => setShowDeliverySig(false)} style={[styles.sigCloseBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="x" size={20} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            <View style={[styles.sigCard, { borderColor: colors.border }]}>
              <SignatureScreen
                ref={deliverySigPadRef}
                onOK={handleDeliverySigOK}
                onEmpty={() => Alert.alert('Empty', 'Please provide a signature')}
                descriptionText=""
                webStyle={`.m-signature-pad {box-shadow: none; border: none; height: 100%; margin: 0;}
                            .m-signature-pad--body {border: none; height: 100%;}
                            .m-signature-pad--footer {display: none;}
                            body,html {height: 100%; margin: 0;}`
                        }
              />
              <View pointerEvents="none" style={styles.sigBaseline}>
                <Feather name="edit-3" size={14} color="#9CA3AF" />
                <Text style={styles.sigBaselineText}>Sign here</Text>
              </View>
            </View>
            <View style={styles.sigFooterRow}>
              <View style={{ flex: 1 }}><Button title="Clear" variant="outline" onPress={() => deliverySigPadRef.current?.clearSignature()} /></View>
              <View style={{ flex: 2 }}><Button title="Done" onPress={() => deliverySigPadRef.current?.readSignature()} /></View>
            </View>
          </View>
        </View>
      </Modal>

    
      {/* Delivery OTP Modal */}
      <Modal visible={showDeliveryOtp} animationType="slide" transparent>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Verify Delivery OTP</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 16 }}>Sent to customer email.</Text>
            
            <TextInput value={deliveryOtpCode} onChangeText={setDeliveryOtpCode} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} placeholder="OTP Code" />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowDeliveryOtp(false)} style={{ flex: 1 }} />
              <Button title="Verify & Deliver" onPress={async () => {
                if (!deliveryOtpCode) return;
                setUpdating(true);
                try {
                  await deliveryOtpVerify(repair.id, { code: deliveryOtpCode });
                  
                  // Setup warranty
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
                    paymentMethod: handoverPaymentMethod,
                    otpVerified: true
                  });
                  
                  setShowDeliveryOtp(false);
                  await loadAll();
                  queryClient.invalidateQueries();
                } catch (e: any) {
                  Alert.alert('Error', e.message);
                } finally {
                  setUpdating(false);
                }
              }} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </Modal>

      {/* Assign Technician Modal */}
      <Modal visible={showAssign} animationType="slide" transparent>
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
    paddingHorizontal: 16, paddingBottom: 14,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  repairId: { fontSize: 20 },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: 16 },
  scroll: { padding: 16, gap: 12 },
  statusCard: { gap: 10 },
  cardLabel: { fontSize: 11, letterSpacing: 0.8, marginBottom: 4 },
  nextStatusBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14 },
  nextStatusText: { color: '#FFFFFF', fontSize: 14 },
  priorityRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  dateSmall: { fontSize: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 14, textAlign: 'right', flex: 1, marginLeft: 16 },
  divider: { height: 1, marginVertical: 8 },
  problemTitle: { fontSize: 13, marginTop: 4 },
  problemText: { fontSize: 13, lineHeight: 20, marginTop: 4 },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1 },
  pdfBtnText: { fontSize: 15 },
  checkBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  galleryThumb: { width: 100, height: 100, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  galleryImg: { width: '100%', height: '100%' },
  galleryBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 4, alignItems: 'center' },
  galleryBadgeText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  sigImg: { width: '100%', height: 80, backgroundColor: '#FFF', borderRadius: 8, borderWidth: 1, borderColor: '#EEE' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, zIndex: 10, elevation: 10 },
  doneBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 14 },
  paidChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 12 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheetContent: { borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalContent: { borderWidth: 1, borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 12 },
  sigScreen: { flex: 1, paddingHorizontal: 20, paddingBottom: 24 },
  sigHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  sigSubtitle: { fontSize: 13, marginTop: 4 },
  sigCloseBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sigCard: { flex: 1, borderRadius: 16, borderWidth: 1, overflow: 'hidden', backgroundColor: '#FFF' },
  sigBaseline: { position: 'absolute', left: 24, right: 24, bottom: 20, borderTopWidth: 1, borderTopColor: '#D1D5DB', borderStyle: 'dashed', paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sigBaselineText: { fontSize: 12, color: '#9CA3AF' },
  sigFooterRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  label: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
});
