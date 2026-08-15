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
  estimateApprovalsDecide, deliveryOtpSend, deliveryOtpVerify, repairNotifyReady, estimateApprovalsSendOtp
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
  const { repairs, updateRepair, inventory, loadAll } = useData();
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

  // Service Edits
  const [showServiceEdit, setShowServiceEdit] = useState(false);
  const [editProblem, setEditProblem] = useState('');
  const [editDiagnosis, setEditDiagnosis] = useState('');
  const [editWorkPerformed, setEditWorkPerformed] = useState('');

  const qrRef = useRef<any>(null);
  const deliverySigPadRef = useRef<SignatureViewRef>(null);

  useEffect(() => {
    storage.get<string>(KEYS.AUTH_TOKEN).then(setToken);
  }, []);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const anims = useStaggerAnim(16);

  const repair = useMemo(() => repairs.find((r) => r.id === id), [repairs, id]);

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

  const markDelivered = async (signatureUri: string) => {
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
        setTimeout(() => setShowTesting(true), 350);
      } else {
        Alert.alert('Update failed', e.message || "Couldn't update the repair status.");
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleHandoverProceed = () => {
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

  const handleSaveService = async () => {
    setUpdating(true);
    try {
      await updateRepair({
        ...repair,
        problem: editProblem,
        diagnosis: editDiagnosis,
        workPerformed: editWorkPerformed
      });
      setShowServiceEdit(false);
      await loadAll();
      queryClient.invalidateQueries();
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

      <FadeInView animValue={anims[0]} style={[styles.header, { paddingTop: topPad + 14 }]}>
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
        <View style={{ width: 44 }}>
          {/* Hidden QR Code for PDF Generation */}
          <View style={{ position: 'absolute', opacity: 0 }}>
             <QRCode value={repair.id} size={150} getRef={(c) => (qrRef.current = c)} />
          </View>
        </View>
      </FadeInView>

      <KeyboardAwareScrollViewCompat showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]} bottomOffset={24}>
        
        <FadeInView animValue={anims[0]}>
          <TouchableOpacity onPress={generatePDF} style={[styles.pdfBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '33' }]}>
            <Feather name="file-text" size={18} color={colors.primary} />
            <Text style={[styles.pdfBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Download Job Card PDF</Text>
          </TouchableOpacity>
        </FadeInView>

        {/* 1. REPAIR PROGRESS */}
        <FadeInView animValue={anims[1]}>
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 12 }]}>REPAIR PROGRESS</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 8 }}>
              {[
                { id: 'received', label: 'Received' },
                { id: 'diagnosing', label: 'Diagnosis' },
                { id: 'repairing', label: 'Repairing' },
                { id: 'testing', label: 'Testing' },
                { id: 'customer_approval', label: 'Approval' },
                { id: 'ready', label: 'Ready' },
                { id: 'delivered', label: 'Delivered' }
              ].map((step, index, arr) => {
                const stepFlowIndex = STATUS_FLOW.indexOf(step.id);
                const currentFlowIndex = STATUS_FLOW.indexOf(repair.status as string);
                
                let state = 'upcoming';
                const isTerminal = repair.status === 'cancelled' || repair.status === 'cannot_repair';
                
                if (isTerminal) {
                  if (index === arr.length - 1) {
                    state = 'error';
                    step.label = repair.status === 'cancelled' ? 'Cancelled' : 'Failed';
                  } else {
                    state = 'upcoming';
                  }
                } else if (currentFlowIndex > stepFlowIndex || (repair.status === 'waiting_parts' && stepFlowIndex < STATUS_FLOW.indexOf('waiting_parts'))) {
                  state = 'completed';
                } else if (currentFlowIndex === stepFlowIndex || (repair.status === 'waiting_parts' && step.id === 'repairing')) {
                  state = 'current';
                }
                
                const isCompleted = state === 'completed';
                const isCurrent = state === 'current';
                const isError = state === 'error';
                const circleColor = isError ? colors.destructive : isCompleted ? colors.success : isCurrent ? colors.primary : 'transparent';
                const borderColor = isError ? colors.destructive : isCompleted || isCurrent ? 'transparent' : colors.muted;

                return (
                  <View key={step.id} style={{ flex: 1, alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                      <View style={{ flex: 1, height: 2, backgroundColor: index === 0 ? 'transparent' : (isCompleted || isCurrent ? colors.success : colors.border) }} />
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: circleColor, borderWidth: isCompleted || isCurrent || isError ? 0 : 1, borderColor, alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                        {isCompleted ? <Feather name="check" size={14} color="#FFF" /> : isError ? <Feather name="x" size={14} color="#FFF" /> : isCurrent ? <Feather name="loader" size={12} color="#FFF" /> : <Feather name="clock" size={12} color={colors.muted} />}
                      </View>
                      <View style={{ flex: 1, height: 2, backgroundColor: index === arr.length - 1 ? 'transparent' : (isCompleted ? colors.success : colors.border) }} />
                    </View>
                    <Text style={{ fontSize: 9, color: isCurrent ? colors.foreground : colors.mutedForeground, marginTop: 6, fontFamily: isCurrent ? 'Inter_600SemiBold' : 'Inter_400Regular' }} numberOfLines={1}>{step.label}</Text>
                  </View>
                );
              })}
            </View>
          </Card>
        </FadeInView>

        {/* 2. QUICK ACTIONS */}
        {((canUpdateStatus && repair.status !== 'delivered' && repair.status !== 'cancelled') || repair.status === 'delivered' || canAccess('finance') || user?.role === 'dealer' || user?.role === 'reception') && (
        <FadeInView animValue={anims[2]}>
          <Card style={{ gap: 12 }}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>QUICK ACTIONS</Text>
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-between' }}>
              
              {canUpdateStatus && repair.status !== 'delivered' && repair.status !== 'cancelled' && (
                <TouchableOpacity onPress={() => setShowStatusPicker(true)} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.success + '15', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="edit" size={20} color={colors.success} />
                  </View>
                  <Text style={{ fontSize: 11, textAlign: 'center', color: colors.foreground, fontFamily: 'Inter_500Medium' }}>Update{"\n"}Status</Text>
                </TouchableOpacity>
              )}

              {repair.status === 'ready' && (
                <TouchableOpacity onPress={async () => {
                  try {
                    await repairNotifyReady(repair.id);
                    Alert.alert('Success', 'Customer notified via email.');
                    await loadAll();
                    queryClient.invalidateQueries();
                  } catch(e: any) {
                    Alert.alert('Notice', e.message || 'Email service not configured for this address');
                  }
                }} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.info + '15', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="bell" size={20} color={colors.info} />
                  </View>
                  <Text style={{ fontSize: 11, textAlign: 'center', color: colors.foreground, fontFamily: 'Inter_500Medium' }}>Notify{"\n"}Customer</Text>
                </TouchableOpacity>
              )}

              {(canAccess('finance') || user?.role === 'dealer' || user?.role === 'super_admin' || user?.role === 'reception') && (
                <TouchableOpacity onPress={openPaymentModal} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="credit-card" size={20} color={colors.primary} />
                  </View>
                  <Text style={{ fontSize: 11, textAlign: 'center', color: colors.foreground, fontFamily: 'Inter_500Medium' }}>Collect{"\n"}Payment</Text>
                </TouchableOpacity>
              )}

              {repair.status !== 'delivered' && repair.status !== 'cancelled' && (
                <TouchableOpacity onPress={() => setShowApproval(true)} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warning + '15', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="user-check" size={20} color={colors.warning} />
                  </View>
                  <Text style={{ fontSize: 11, textAlign: 'center', color: colors.foreground, fontFamily: 'Inter_500Medium' }}>Customer{"\n"}Approval</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity onPress={() => Linking.openURL(`tel:${repair.mobile}`)} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
                <View style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: '#8B5CF6', backgroundColor: '#8B5CF615', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="phone-call" size={20} color="#8B5CF6" />
                </View>
                <Text style={{ fontSize: 11, textAlign: 'center', color: colors.foreground, fontFamily: 'Inter_500Medium' }}>Contact{"\n"}Customer</Text>
              </TouchableOpacity>
              
            </View>
          </Card>
        </FadeInView>
        )}

        {/* 3. REPAIR SUMMARY */}
        <FadeInView animValue={anims[3]}>
          <Card style={{ paddingHorizontal: 16 }}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 }]}>REPAIR SUMMARY</Text>
            <SummaryRow icon="user" label="Customer" value={repair.customerName} />
            <SummaryRow icon="phone" label="Phone" value={repair.mobile} rightElement={<TouchableOpacity onPress={() => Linking.openURL(`tel:${repair.mobile}`)}><Feather name="phone-call" size={14} color={colors.primary}/></TouchableOpacity>} />
            <SummaryRow icon="smartphone" label="Device" value={`${repair.brand} ${repair.model}`} />
            <SummaryRow icon="file-text" label="Job ID" value={repair.repairId} rightElement={<TouchableOpacity onPress={() => Alert.alert('Job ID', repair.repairId)}><Feather name="copy" size={14} color={colors.primary}/></TouchableOpacity>} />
            <SummaryRow icon="star" label="Priority" value="" rightElement={<PriorityBadge priority={repair.priority} />} />
            <SummaryRow icon="clock" label="Received" value={formatDate(repair.receiveDate)} />
            <SummaryRow icon="calendar" label="Expected" value={formatDate(repair.expectedDate)} />
            {repair.repairStartedAt && <SummaryRow icon="play" label="Started" value={new Date(repair.repairStartedAt).toLocaleDateString()} />}
            {repair.repairCompletedAt && <SummaryRow icon="check-square" label="Completed" value={new Date(repair.repairCompletedAt).toLocaleDateString()} />}
            <SummaryRow icon="user" label="Assigned Technician" value={repair.technicianName || 'Unassigned'} rightElement={((user?.role === 'dealer' || user?.role === 'super_admin') && repair.status !== 'delivered' && repair.status !== 'cancelled') ? <TouchableOpacity onPress={() => setShowAssign(true)}><Feather name="edit" size={14} color={colors.primary}/></TouchableOpacity> : null} />
          </Card>
        </FadeInView>

        {/* 4. DEVICE DETAILS */}
        <FadeInView animValue={anims[4]}>
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>DEVICE DETAILS</Text>
            <InfoRow label="Brand & Model" value={`${repair.brand} ${repair.model}`} bold />
            <InfoRow label="Color / Storage / RAM" value={[repair.color, repair.storage, repair.ram].filter(Boolean).join(' / ') || 'N/A'} />
            {repair.imei ? <InfoRow label="IMEI 1" value={repair.imei} /> : null}
            {repair.imei2 ? <InfoRow label="IMEI 2" value={repair.imei2} /> : null}
            {repair.serialNumber ? <InfoRow label="Serial No" value={repair.serialNumber} /> : null}
            
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 4 }}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: repair.simPresent ? colors.primary + '22' : colors.card, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 11, color: repair.simPresent ? colors.primary : colors.mutedForeground }}>SIM: {repair.simPresent ? 'YES' : 'NO'}</Text>
              </View>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: repair.memoryCardPresent ? colors.primary + '22' : colors.card, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 11, color: repair.memoryCardPresent ? colors.primary : colors.mutedForeground }}>SD Card: {repair.memoryCardPresent ? 'YES' : 'NO'}</Text>
              </View>
            </View>

            <InfoRow label="Alternate Mobile" value={repair.alternateMobile || 'N/A'} />
            <InfoRow label="Accessories" value={(repair.accessoriesList?.length ? repair.accessoriesList.join(', ') : 'None') + (repair.accessories ? ` (${repair.accessories})` : '')} />
            <InfoRow label="Received By" value={repair.receivedByName || 'System'} />
            {repair.status === 'delivered' && (
              <>
                <InfoRow label="Delivered By" value={repair.deliveredByName || 'N/A'} />
                <InfoRow label="Payment Method" value={repair.paymentMethod || 'N/A'} />
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Payment Status</Text>
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: (repair.repairCharge + repair.partsCharge - repair.advance) <= 0 ? colors.success + '22' : repair.advance > 0 ? colors.warning + '22' : colors.destructive + '22' }}>
                    <Text style={{ fontSize: 10, color: (repair.repairCharge + repair.partsCharge - repair.advance) <= 0 ? colors.success : repair.advance > 0 ? colors.warning : colors.destructive, fontWeight: 'bold' }}>
                      {(repair.repairCharge + repair.partsCharge - repair.advance) <= 0 ? 'PAID' : repair.advance > 0 ? 'PARTIAL' : 'PENDING'}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </Card>
        </FadeInView>

        {/* 5. CONDITION CHECKLIST (At Intake) */}
        <FadeInView animValue={anims[5]}>
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 12 }]}>CONDITION CHECKLIST (At Intake)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {Object.keys(repair.checklist || {}).map(k => {
                const isWorking = repair.checklist![k];
                return (
                  <View key={k} style={{ padding: 8, borderRadius: 8, backgroundColor: isWorking ? colors.success + '15' : colors.destructive + '15', borderWidth: 1, borderColor: isWorking ? colors.success + '33' : colors.destructive + '33', width: '31%' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <Feather name={isWorking ? "check-square" : "alert-triangle"} size={12} color={isWorking ? colors.success : colors.destructive} />
                      <Text style={{ fontSize: 11, color: isWorking ? colors.success : colors.destructive, fontFamily: 'Inter_500Medium', flex: 1 }} numberOfLines={1}>{CHECKLIST_ITEMS.find(c => c.id === k)?.label || k}</Text>
                    </View>
                    <Text style={{ fontSize: 10, color: isWorking ? colors.success : colors.destructive }}>{isWorking ? 'Working' : 'Not Working'}</Text>
                  </View>
                );
              })}
              {Object.keys(repair.physicalCondition || {}).map(k => {
                if (!repair.physicalCondition![k]) return null;
                return (
                  <View key={k} style={{ padding: 8, borderRadius: 8, backgroundColor: colors.warning + '15', borderWidth: 1, borderColor: colors.warning + '33', width: '31%' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <Feather name="alert-circle" size={12} color={colors.warning} />
                      <Text style={{ fontSize: 11, color: colors.warning, fontFamily: 'Inter_500Medium', flex: 1 }} numberOfLines={1}>Body</Text>
                    </View>
                    <Text style={{ fontSize: 10, color: colors.warning }}>{k.replace(/_/g, ' ')}</Text>
                  </View>
                );
              })}
            </View>
            <Button title="View All & Photos" variant="outline" size="sm" style={{ marginTop: 16 }} onPress={() => {}} />
          </Card>
        </FadeInView>

        {/* 6. SERVICE DETAILS */}
        <FadeInView animValue={anims[6]}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>SERVICE DETAILS</Text>
              {repair.status !== 'delivered' && repair.status !== 'cancelled' && (
                <TouchableOpacity onPress={() => {
                  setEditProblem(repair.problem || '');
                  setEditDiagnosis(repair.diagnosis || '');
                  setEditWorkPerformed(repair.workPerformed || '');
                  setShowServiceEdit(true);
                }}>
                  <Feather name="edit-2" size={16} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>

            <Text style={{ fontSize: 12, color: colors.primary, marginBottom: 4, fontFamily: 'Inter_500Medium' }}>Complaint</Text>
            <Text style={{ fontSize: 13, color: colors.foreground, marginBottom: 12 }}>{repair.problem}</Text>
            
            <Text style={{ fontSize: 12, color: colors.primary, marginBottom: 4, fontFamily: 'Inter_500Medium' }}>Diagnosis</Text>
            <Text style={{ fontSize: 13, color: colors.foreground, marginBottom: 12 }}>{repair.diagnosis || 'Pending'}</Text>
            
            <Text style={{ fontSize: 12, color: colors.primary, marginBottom: 4, fontFamily: 'Inter_500Medium' }}>Work Performed</Text>
            <Text style={{ fontSize: 13, color: colors.foreground, marginBottom: 12 }}>{repair.workPerformed || 'Pending'}</Text>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontSize: 12, color: colors.primary, fontFamily: 'Inter_500Medium' }}>Parts Replaced</Text>
              {repair.status !== 'delivered' && repair.status !== 'cancelled' && (
                <TouchableOpacity onPress={() => setShowAddPart(true)}>
                  <Feather name="plus-circle" size={14} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
            {parts.length === 0 ? (
              <Text style={{ fontSize: 13, color: colors.foreground, marginBottom: 16 }}>None</Text>
            ) : (
              <View style={{ marginBottom: 16 }}>
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
              </View>
            )}

            <Button title="View All Details" variant="outline" size="sm" onPress={() => {}} />
          </Card>
        </FadeInView>

                {/* 7. ESTIMATE & PAYMENT & WARRANTY */}
        {(canAccess('finance') || user?.role === 'reception' || user?.role === 'dealer') ? (
          <>
            {/* 7. ESTIMATE & PAYMENT */}
                    <FadeInView animValue={anims[7]}>
                      <Card>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>ESTIMATE & PAYMENT</Text>
                          {(canAccess('finance') || user?.role === 'reception' || user?.role === 'dealer') && (
                            <TouchableOpacity onPress={() => {
                              setEditRepairCharge(repair.repairCharge.toString());
                              setEditServiceCharge((repair.serviceCharge || 0).toString());
                              setEditOtherCharge((repair.otherCharge || 0).toString());
                              setEditDiscount((repair.discount || 0).toString());
                              setEditTaxPercent((repair.taxPercent || 0).toString());
                              setShowFinancialEdit(true);
                            }}>
                              <Feather name="edit-2" size={16} color={colors.primary} />
                            </TouchableOpacity>
                          )}
                        </View>
            
                        <InfoRow label="Total Estimate" value={formatCurrency(repair.repairCharge + repair.partsCharge)} />
                        <InfoRow label="Parts Cost" value={formatCurrency(repair.partsCharge)} />
                        <InfoRow label="Labour Charge" value={formatCurrency(repair.repairCharge)} />
                        <InfoRow label={`Tax (${repair.taxPercent || 18}%)`} value={formatCurrency(((repair.repairCharge + repair.partsCharge) * (repair.taxPercent || 18)) / 100)} />
                        <InfoRow label="Discount" value={formatCurrency(repair.discount || 0)} />
                        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />
                        <InfoRow label="Total" value={formatCurrency(payTotal)} bold />
            
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 16 }}>
                          <View style={{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.success + '15', alignItems: 'center' }}>
                            <Text style={{ fontSize: 12, color: colors.success, marginBottom: 4 }}>Paid</Text>
                            <Text style={{ fontSize: 16, color: colors.success, fontFamily: 'Inter_700Bold' }}>{formatCurrency(payPaid)}</Text>
                          </View>
                          <View style={{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warning + '15', alignItems: 'center' }}>
                            <Text style={{ fontSize: 12, color: colors.warning, marginBottom: 4 }}>Balance</Text>
                            <Text style={{ fontSize: 16, color: colors.warning, fontFamily: 'Inter_700Bold' }}>{formatCurrency(payRemaining)}</Text>
                          </View>
                          <View style={{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primary + '15', alignItems: 'center' }}>
                            <Text style={{ fontSize: 12, color: colors.primary, marginBottom: 4 }}>Status</Text>
                            <Text style={{ fontSize: 14, color: colors.primary, fontFamily: 'Inter_600SemiBold', marginTop: 2 }}>
                              {payRemaining <= 0 ? 'Paid' : payPaid > 0 ? 'Partial' : 'Pending'}
                            </Text>
                          </View>
                        </View>
            
                        <Button title="+ Collect Payment" onPress={openPaymentModal} style={{ width: '100%' }} />
                        
                        <View style={{ marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                           <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Warranty: {repair.warrantyDays} Days {repair.warrantyExpiry ? `(Till ${formatDate(repair.warrantyExpiry)})` : ''}</Text>
                        </View>
                      </Card>
                    </FadeInView>
            
                    {/* 8. PAYMENT HISTORY */}
                    {(payments.length > 0 || visibleRefunds.length > 0) && (
                      <FadeInView animValue={anims[8]}>
                        <Card>
                          <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 16 }]}>PAYMENT HISTORY</Text>
                          
                          {payments.map(pmt => (
                            <View key={pmt.id} style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                              <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ fontSize: 10, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{pmt.method === 'UPI' ? 'UPI' : pmt.method === 'Cash' ? 'Cash' : 'Card'}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                                    <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{formatCurrency(pmt.amount)}</Text>
                                    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{pmt.method}</Text>
                                    <Text style={{ fontSize: 10, color: colors.primary, backgroundColor: colors.primary + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' }}>{pmt.kind}</Text>
                                  </View>
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
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                                    <Text style={{ fontSize: 14, color: colors.destructive, fontFamily: 'Inter_600SemiBold' }}>-{formatCurrency(rf.amount)}</Text>
                                    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Refund ({rf.method})</Text>
                                  </View>
                                </View>
                                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{formatDate(rf.paidAt || rf.createdAt)}</Text>
                              </View>
                            </View>
                          ))}
            
                          <Button title="View Full Payment History" variant="outline" size="sm" style={{ marginTop: 8 }} onPress={() => {}} />
                        </Card>
                      </FadeInView>
                    )}
          </>
        ) : (
          <FadeInView animValue={anims[7]}>
            <Card>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>WARRANTY</Text>
              <InfoRow label="Warranty Offered" value={`${repair.warrantyDays} Days`} />
              {repair.warrantyExpiry && (
                <InfoRow label="Warranty Expiry" value={formatDate(repair.warrantyExpiry)} />
              )}
            </Card>
          </FadeInView>
        )}

        {/* 9. CUSTOMER APPROVAL */}
        <FadeInView animValue={anims[9]}>
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 12 }]}>CUSTOMER APPROVAL</Text>
            
            <InfoRow label="Estimated Amount" value={formatCurrency(repair.repairCharge + repair.partsCharge)} bold />
            
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Approval Status</Text>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: repair.status === 'customer_approval' ? colors.warning + '22' : colors.success + '22' }}>
                <Text style={{ fontSize: 12, color: repair.status === 'customer_approval' ? colors.warning : colors.success, fontFamily: 'Inter_600SemiBold' }}>
                  {repair.status === 'customer_approval' ? 'Pending' : 'Approved'}
                </Text>
              </View>
            </View>
            
            {approvals.length > 0 && (
              <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
                {approvals.map(app => (
                  <View key={app.id} style={{ paddingVertical: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>₹{app.oldAmount} → ₹{app.newAmount}</Text>
                      <Text style={{ fontSize: 12, color: app.status === 'pending' ? colors.warning : app.status === 'approved' ? colors.success : colors.destructive, textTransform: 'uppercase', fontFamily: 'Inter_700Bold' }}>{app.status}</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{app.reason}</Text>
                    
                    <InfoRow label="Requested On" value={formatDate(app.createdAt)} />
                    <InfoRow label="Requested By" value={app.requestedByName || 'Staff'} />
                    
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
              </View>
            )}

            {repair.status !== 'delivered' && repair.status !== 'cancelled' && (
              <Button title="Send Approval Request" onPress={() => setShowApproval(true)} style={{ marginTop: 16 }} />
            )}
          </Card>
        </FadeInView>

        {/* 10. ACTIVITY TIMELINE */}
        {eventsData?.events && eventsData.events.length > 0 && (
          <FadeInView animValue={anims[10]}>
            <Card>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 16 }]}>ACTIVITY TIMELINE</Text>
              {eventsData.events.map((ev, i) => {
                const isPending = ev.action.toLowerCase().includes('approval') || ev.action.toLowerCase().includes('pending');
                const dotColor = isPending ? colors.warning : colors.success;

                return (
                  <View key={ev.id} style={{ flexDirection: 'row', gap: 12, marginBottom: i === eventsData.events.length - 1 ? 0 : 0 }}>
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
                      <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_500Medium' }}>
                        {ev.action}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>
                        By: {ev.userName} ({ev.userRole})
                      </Text>
                    </View>
                  </View>
                );
              })}
              <Button title="View Full Timeline" variant="outline" size="sm" style={{ marginTop: 16 }} onPress={() => {}} />
            </Card>
          </FadeInView>
        )}

        {/* 11. AFTER SALE SERVICE */}
        <FadeInView animValue={anims[11]}>
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 12 }]}>AFTER SALE SERVICE</Text>
            {repairReturns.length === 0 ? (
              <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: repair.status === 'delivered' ? 16 : 0 }}>No after sale service yet.</Text>
            ) : (
              repairReturns.map(ret => (
                <TouchableOpacity
                  key={ret.id}
                  onPress={() => router.push(`/(tabs)/repairs/return/${ret.id}` as any)}
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
              ))
            )}
            {repair.status === 'delivered' && (
              <Button title="+ Create After Sale Case" variant="outline" onPress={() => router.push(`/(tabs)/repairs/return/new?repairId=${repair.id}` as any)} />
            )}
          </Card>
        </FadeInView>

        {/* 12. DOCUMENTS & PHOTOS */}
        {photosData?.photos && photosData.photos.length > 0 && (
          <FadeInView animValue={anims[12]}>
            <Card>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 12 }]}>DOCUMENTS & PHOTOS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {photosData.photos.map(p => (
                  <View key={p.id} style={{ width: 80 }}>
                    <View style={{ width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 6 }}>
                      <Image source={{ uri: getAbsoluteUrl(p.objectPath), headers: { Authorization: `Bearer ${token}` } }} style={{ width: '100%', height: '100%' }} />
                    </View>
                    <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: 'center' }} numberOfLines={1}>{p.kind.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </ScrollView>
              <Button title="View All Documents" variant="outline" size="sm" style={{ marginTop: 16 }} onPress={() => {}} />
            </Card>
          </FadeInView>
        )}

        
        {/* SIGNATURES */}
        {(repair.receivingSignaturePath || repair.deliverySignaturePath) && (
          <FadeInView animValue={anims[13]}>
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
          </FadeInView>
        )}

        {/* 13. STAFF NOTES */}
        <FadeInView animValue={anims[13]}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>STAFF NOTES</Text>
              <Feather name="edit-2" size={14} color={colors.primary} />
            </View>
            
            {repair.notes ? (
              <>
                <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 20 }}>{repair.notes}</Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 8 }}>- Staff</Text>
              </>
            ) : (
              <Text style={{ fontSize: 13, color: colors.mutedForeground }}>No notes added.</Text>
            )}
            
            <Button title="Add Notes" variant="outline" size="sm" style={{ marginTop: 16 }} onPress={() => {}} />
          </Card>
        </FadeInView>
</KeyboardAwareScrollViewCompat>

      {/* Status Picker Modal */}
      <Modal visible={showStatusPicker} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Update Status</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {REPAIR_STATUSES.map(s => (
                <TouchableOpacity
                  key={s}
                  onPress={() => handleStatusUpdate(s)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                    borderWidth: 1, borderColor: repair.status === s ? colors.primary : colors.border,
                    backgroundColor: repair.status === s ? colors.primary + '22' : colors.card
                  }}
                >
                  <Text style={{ fontSize: 13, color: repair.status === s ? colors.primary : colors.foreground }}>
                    {REPAIR_STATUS_LABELS[s]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Button title="Cancel" variant="outline" onPress={() => setShowStatusPicker(false)} />
          </View>
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
            
            <View style={{ backgroundColor: colors.card, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 16 }}>
              <InfoRow label="Labour / Repair Charge" value={formatCurrency(repair.repairCharge)} />
              <InfoRow label="Parts Charge" value={formatCurrency(repair.partsCharge)} />
              <View style={styles.divider} />
              <InfoRow label="Total" value={formatCurrency(repair.repairCharge + repair.partsCharge)} />
              <InfoRow label="Advance Paid" value={formatCurrency(repair.advance)} color={colors.success} />
              <View style={styles.divider} />
              <InfoRow label="Balance Payable" value={formatCurrency(balance)} color={balance > 0 ? colors.warning : colors.success} bold />
            </View>
            
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
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {CHECKLIST_ITEMS.map((item) => {
                  const checked = testingChecklist[item.id] || false;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      activeOpacity={0.7}
                      onPress={() => setTestingChecklist(prev => ({ ...prev, [item.id]: !checked }))}
                      style={{ width: '48%', flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, gap: 10, backgroundColor: colors.card, borderColor: checked ? colors.primary : colors.border }}
                    >
                      <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: checked ? colors.primary : 'transparent', borderColor: checked ? colors.primary : colors.muted }}>
                        {checked && <Feather name="check" size={14} color="#FFF" />}
                      </View>
                      <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_500Medium', flex: 1 }} numberOfLines={1}>{item.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
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
        <View style={styles.modalOverlay}>
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
        </View>
      </Modal>
{/* Financial Edit Modal */}
      <Modal visible={showFinancialEdit} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Financials</Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 12 }}>
              Parts charge is computed automatically. Advances are recorded via Payments.
            </Text>

            <ScrollView style={{ maxHeight: 300 }}>
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
            </ScrollView>
            
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowFinancialEdit(false)} style={{ flex: 1 }} />
              <Button title="Save" onPress={handleSaveFinancials} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Service Edit Modal */}
      <Modal visible={showServiceEdit} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Service Details</Text>

            <Text style={[styles.label, { color: colors.foreground }]}>Problem Reported</Text>
            <TextInput value={editProblem} onChangeText={setEditProblem} multiline numberOfLines={3} style={[styles.input, { color: colors.foreground, borderColor: colors.border, height: 80, textAlignVertical: 'top' }]} />
            
            <Text style={[styles.label, { color: colors.foreground }]}>Diagnosis</Text>
            <TextInput value={editDiagnosis} onChangeText={setEditDiagnosis} multiline numberOfLines={3} style={[styles.input, { color: colors.foreground, borderColor: colors.border, height: 80, textAlignVertical: 'top' }]} />
            
            <Text style={[styles.label, { color: colors.foreground }]}>Work Performed</Text>
            <TextInput value={editWorkPerformed} onChangeText={setEditWorkPerformed} multiline numberOfLines={3} style={[styles.input, { color: colors.foreground, borderColor: colors.border, height: 80, textAlignVertical: 'top' }]} />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowServiceEdit(false)} style={{ flex: 1 }} />
              <Button title="Save" onPress={handleSaveService} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
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
        <View style={styles.modalOverlay}>
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
        </View>
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
