import React, { useState, useRef, useEffect } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  Image,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Network from 'expo-network';
import { offlineQueue } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/helpers';

import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { font, fontFamily } from '@/constants/typography';
import { hitSlop, layout, radius, size, space } from '@/constants/spacing';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CalendarDialog, formatDayLabel } from '@/components/ui/CalendarDialog';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DeviceTypeIcon, SdCardIcon, SimCardIcon } from '@/components/ui/DeviceGlyphs';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { RepairPhotoCamera } from '@/components/ui/RepairPhotoCamera';
import { Repair } from '@/types';
import {
  getTodayStr,
  getNextWeekStr,
  isValidDateStr,
  DEVICE_TYPES,
  BRANDS,
  PRIORITIES,
  PRIORITY_LABELS,
} from '@/utils/helpers';
import { requestUploadUrl, repairPhotosAdd, approvalsCreate, repairPaymentsCreate, useDealersList, useDealersDetect, type UploadUrlRequestContentType } from '@workspace/api-client-react';
import { fetch as expoFetch } from 'expo/fetch';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { File as ExpoFile } from 'expo-file-system';

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

const PHYSICAL_CONDITION_ITEMS = [
  { id: 'screen_damage', label: 'Screen Damage' },
  { id: 'back_panel_damage', label: 'Back Panel Damage' },
  { id: 'frame_damage', label: 'Frame Damage' },
  { id: 'camera_glass_damage', label: 'Camera Glass Damage' },
  { id: 'water_liquid_damage', label: 'Water/Liquid Damage' },
  { id: 'existing_scratches', label: 'Existing Scratches' },
  { id: 'Charger', label: 'Charger' },
  { id: 'Cable', label: 'Cable' },
  { id: 'Adapter', label: 'Adapter' },
  { id: 'Box', label: 'Box' },
  { id: 'SIM Tray', label: 'SIM Tray' },
  { id: 'SIM', label: 'SIM' },
  { id: 'Memory Card', label: 'Memory Card' },
  { id: 'Cover', label: 'Cover' },
  { id: 'Earphone', label: 'Earphone' },
  { id: 'other', label: 'Other' },
];

const DEVICE_IDENTIFIER_OPTIONS = [
  { id: 'serialNumber', label: 'Serial Number' },
  { id: 'imei', label: 'IMEI 1' },
  { id: 'imei2', label: 'IMEI 2' },
] as const;

/** Device photos per intake; the strip shows one slot per allowed photo. */
const MAX_PHOTOS = 4;

/** Drop a device photo the in-app camera wrote into the app cache (web picks are browser blobs, not files). */
const discardPhotoFile = (uri: string) => {
  if (Platform.OS === 'web' || !uri.startsWith('file:')) return;
  void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
};

/** `label` names the kind in the picker; `tag` is the one-word strip that fits over a 56dp thumbnail. */
const PHOTO_KINDS = [
  { id: 'front', label: 'Front', tag: 'Front' },
  { id: 'back', label: 'Back', tag: 'Back' },
  { id: 'imei', label: 'IMEI / Serial', tag: 'IMEI' },
  { id: 'left', label: 'Left Edge', tag: 'Left' },
  { id: 'right', label: 'Right Edge', tag: 'Right' },
  { id: 'top', label: 'Top Edge', tag: 'Top' },
  { id: 'bottom', label: 'Bottom Edge', tag: 'Bottom' },
  { id: 'damage', label: 'Damage Detail', tag: 'Damage' },
  { id: 'bill', label: 'Customer Bill', tag: 'Bill' },
  { id: 'customer_id', label: 'Customer ID', tag: 'ID' },
  { id: 'other', label: 'Other', tag: 'Other' },
];

/** Colour of the priority flag: the same scale the repair list uses for priority badges. */
/**
 * Lines a chosen value may take inside a compact toggle: phrases ("Feature Phone", "Apple / iPhone") wrap
 * onto a second line, while a single word ("Smartphone") stays on one line so it shrinks instead of
 * breaking mid-word.
 */
function compactValueLines(value: string): number {
  return value.trim().includes(' ') ? 2 : 1;
}

function priorityTint(priority: string, colors: ReturnType<typeof useColors>): string {
  switch (priority) {
    case 'urgent': return colors.destructive;
    case 'high': return colors.warning;
    case 'low': return colors.mutedForeground;
    default: return colors.success;
  }
}

function SectionHeader({
  title,
  icon = 'clipboard',
  compact = false,
}: {
  title: string;
  icon?: keyof typeof Feather.glyphMap;
  /** Eyebrow-sized heading for dense cards that carry an action on the same line. */
  compact?: boolean;
}) {
  const colors = useColors();
  if (compact) {
    return (
      <View style={styles.sectionHeaderCompact}>
        <View style={[styles.sectionIconCompact, { backgroundColor: colors.primary }]}>
          <Feather name={icon} size={size.eyebrowIcon} color="#FFFFFF" />
        </View>
        <Text numberOfLines={1} style={[styles.sectionTitleCompact, { color: colors.foreground }]}>{title}</Text>
      </View>
    );
  }
  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.sectionIcon, { backgroundColor: colors.primary }]}>
        <Feather name={icon} size={14} color="#FFFFFF" />
      </View>
      <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: fontFamily.bold }]}>{title}</Text>
    </View>
  );
}

export default function NewRepairScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Every pop-up on this form is the app's own dialog, never the platform alert.
  const { notice } = useConfirmDialog();
  const { addRepair, addCustomer, repairs, customers, updateRepair } = useData();
  const { user } = useAuth();

  const anims = useStaggerAnim(2);
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const [step, setStep] = useState(1);

  const [customerName, setCustomerName] = useState('');
  const [mobile, setMobile] = useState('');
  const [alternateMobile, setAlternateMobile] = useState('');
  const [showAlternateMobile, setShowAlternateMobile] = useState(false);
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');

  const [deviceType, setDeviceType] = useState('Smartphone');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [imei, setImei] = useState('');
  const [imei2, setImei2] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [showIdentifierModal, setShowIdentifierModal] = useState(false);
  const [selectedIdentifiers, setSelectedIdentifiers] = useState({
    serialNumber: true,
    imei: false,
    imei2: false,
  });
  const [colorAttr, setColorAttr] = useState('');
  const [storage, setStorage] = useState('');
  const [ram, setRam] = useState('');
  const [devicePassword, setDevicePassword] = useState('');
  const [showDevicePassword, setShowDevicePassword] = useState(false);
  const [simPresent, setSimPresent] = useState(false);
  const [memoryCardPresent, setMemoryCardPresent] = useState(false);

  const [showPhysical, setShowPhysical] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [showDeviceType, setShowDeviceType] = useState(false);
  const [showBrand, setShowBrand] = useState(false);
  const [physicalCondition, setPhysicalCondition] = useState<Record<string, boolean>>({});
  const [deviceCondition, setDeviceCondition] = useState('');
  const [problem, setProblem] = useState('');

  const [priority, setPriority] = useState('normal');
  const [showPriority, setShowPriority] = useState(false);
  const [showExpectedDate, setShowExpectedDate] = useState(false);
  // Optional B2B dealer link — permanent association made at intake.
  const [dealerId, setDealerId] = useState<string | null>(null);
  const [showDealerPick, setShowDealerPick] = useState(false);
  const [dealerSearch, setDealerSearch] = useState('');
  // True when the current dealerId came from automatic phone detection (not a
  // manual pick); cleared/re-run whenever the mobile number changes.
  const [autoDetected, setAutoDetected] = useState(false);
  // True when the user explicitly removed an auto-detected dealer — we then
  // send dealerId: null so the server does NOT re-link it silently.
  const [dealerCleared, setDealerCleared] = useState(false);
  const { data: dealersData } = useDealersList({}, { query: { enabled: showDealerPick } } as any);
  const cleanMobile = mobile.trim();
  const { data: detectData } = useDealersDetect(
    { mobile: cleanMobile },
    { query: { enabled: /^\d{10}$/.test(cleanMobile) } } as any,
  );
  const detectMatches = /^\d{10}$/.test(cleanMobile) ? (detectData?.dealers ?? []) : [];
  // Auto-fill customer fields from the dealer's saved profile. Only empty
  // fields are filled so we never clobber something the user already typed.
  const fillFromDealer = (d: { name: string; mobile: string; location?: string }) => {
    setCustomerName((v) => (v.trim() ? v : d.name));
    setMobile((v) => (v.trim() ? v : d.mobile));
    if (d.location) setAddress((v) => (v.trim() ? v : d.location!));
  };
  // Auto-link: exactly ONE active dealer with this exact registered mobile.
  // Multiple matches are ambiguous — the user must choose from the list.
  useEffect(() => {
    if (detectMatches.length === 1 && !dealerCleared) {
      if (dealerId !== detectMatches[0].id) {
        setDealerId(detectMatches[0].id);
        setAutoDetected(true);
        fillFromDealer(detectMatches[0]);
      }
    } else if (autoDetected && (detectMatches.length === 0 || !detectMatches.some((d) => d.id === dealerId))) {
      // Number changed and no longer matches the auto-detected dealer.
      setDealerId(null);
      setAutoDetected(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectData, cleanMobile, dealerCleared]);
  // A new number resets the "user removed the dealer" decision.
  useEffect(() => { setDealerCleared(false); }, [cleanMobile]);
  const detectedDealer = autoDetected ? detectMatches.find((d) => d.id === dealerId) : undefined;
  const selectedDealer = dealersData?.dealers?.find((d) => d.id === dealerId) || detectedDealer || detectMatches.find((d) => d.id === dealerId);
  const filteredDealers = (dealersData?.dealers || []).filter((d) => {
    const query = dealerSearch.trim().toLowerCase();
    if (!query) return true;
    return [d.name, d.dealerCode, d.shopName, d.mobile].some((value) => value?.toLowerCase().includes(query));
  });
  const [repairCharge, setRepairCharge] = useState('');
  const [advancePaid, setAdvancePaid] = useState('');
  const [advanceEnabled, setAdvanceEnabled] = useState(false);
  const [advanceMethod, setAdvanceMethod] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [receiveDate, setReceiveDate] = useState(getTodayStr());
  const [expectedDate, setExpectedDate] = useState(getNextWeekStr());
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [forceApprovalMode, setForceApprovalMode] = useState(false);

  const [photos, setPhotos] = useState<{ uri: string, kind: string }[]>([]);
  // Native device photos are JPEGs the in-app camera wrote into the app cache
  // for this form alone; they are deleted when removed, once uploaded, and
  // when the form is left with photos still attached.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => { photosRef.current.forEach((p) => discardPhotoFile(p.uri)); }, []);
  const [customerConfirmed, setCustomerConfirmed] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  /** Web only: URI of a browser-picked image waiting for its category. */
  const [showPhotoKindModal, setShowPhotoKindModal] = useState<string | null>(null);
  /** Native: the in-app camera (viewfinder + gallery strip) that adds one device photo per open. */
  const [cameraOpen, setCameraOpen] = useState(false);

  const [createdRepair, setCreatedRepair] = useState<Repair | null>(null);
  const qrRef = useRef<any>(null);

  const isStaff = user?.role !== 'dealer' && user?.role !== 'super_admin';
  const isBackdated = isStaff && (receiveDate.trim() < getTodayStr() || forceApprovalMode);
  const physicalCount = Object.values(physicalCondition).filter(Boolean).length;
  const checklistCount = Object.values(checklist).filter(Boolean).length;
  const priorityColor = priorityTint(priority, colors);
  // Text fields sit flat on the card: the same surface as the card itself with the Input's own grey
  // idle border (focus and error borders still come from Input).
  const flatField = { backgroundColor: colors.card };
  // Shop staff can manually link a B2B dealer. Portal logins remain limited to
  // their own dealer's repairs and must not see the shop dealer directory.
  const isDealerPortalUser =
    user?.role === 'dealer_owner' || user?.role === 'dealer_staff';

  const validate = () => {
    const e: Record<string, string> = {};
    if (!customerName.trim()) e.customerName = 'Required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = '10-digit mobile required';
    if (!brand.trim()) e.brand = 'Required';
    if (!model.trim()) e.model = 'Required';
    if (!problem.trim()) e.problem = 'Required';
    if (!isValidDateStr(receiveDate.trim())) e.receiveDate = 'Enter a valid date as YYYY-MM-DD';
    else if (receiveDate.trim() > getTodayStr()) e.receiveDate = 'Date cannot be in the future';
    if (!isValidDateStr(expectedDate.trim())) e.expectedDate = 'Enter a valid date as YYYY-MM-DD';
    else if (isValidDateStr(receiveDate.trim()) && expectedDate.trim() < receiveDate.trim()) {
      e.expectedDate = 'Cannot be before the receive date';
    }
    if (isBackdated && !reason.trim()) {
      e.reason = 'Reason is required for backdated entry';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleReview = () => {
    if (validate()) {
      setStep(2);
    } else {
      notice({
        tone: 'warning',
        title: 'Missing details',
        message: 'Please complete the fields highlighted in red before continuing.',
      });
    }
  };

  const uploadToGcs = async (fileUri: string, mimeType: UploadUrlRequestContentType) => {
    try {
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      const size = fileInfo.exists ? fileInfo.size : 0;
      const name = fileUri.split('/').pop() || 'upload.jpg';
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

  const handleSubmit = async () => {
    if (!customerConfirmed) {
      notice({
        tone: 'warning',
        icon: 'check-square',
        title: 'Confirmation needed',
        message: 'Tick the box to confirm the details are correct before completing intake.',
      });
      return;
    }
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      let customerId = customers.find((c) => c.mobile === mobile)?.id;
      if (!customerId && !isBackdated) {
        const created = await addCustomer({
          name: customerName.trim(), mobile: mobile.trim(),
          email: email.trim() || undefined,
          alternateMobile: alternateMobile.trim() || undefined,
          address: address.trim() || undefined,
        } as any);
        customerId = created.id;
      }


      const basePayload = {
        customerId,
        customerName: customerName.trim(), mobile: mobile.trim(),
        alternateMobile: alternateMobile.trim() || undefined,
        deviceType, brand: brand.trim(), model: model.trim(),
        imei: imei.trim() || undefined,
        imei2: imei2.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        color: colorAttr.trim() || undefined,
        storage: storage.trim() || undefined,
        ram: ram.trim() || undefined,
        devicePassword: devicePassword.trim() || undefined,
        simPresent, memoryCardPresent,
        problem: problem.trim(),
        physicalCondition,
        deviceCondition: deviceCondition.trim() || undefined,
        status: 'received', priority: priority as Repair['priority'],
        repairCharge: parseFloat(repairCharge) || 0, partsCharge: 0,
        estimatedCost: parseFloat(repairCharge) || 0,
        expectedDate: expectedDate.trim(), notes: notes.trim() || undefined,
        checklist, warrantyDays: 0,
        // null = user explicitly removed a detected dealer (server must not
        // silently re-link); undefined = let the server auto-detect by phone.
        dealerId: dealerId ?? (dealerCleared ? null : undefined),
      };

      if (isBackdated) {
        await approvalsCreate({
          recordType: 'repair',
          mode: 'create',
          payload: { ...basePayload, address: address.trim() || undefined, receiveDate: receiveDate.trim() },
          requestedDate: receiveDate.trim(),
          reason: reason.trim(),
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        notice({
          tone: 'success',
          icon: 'send',
          title: 'Request sent',
          message: 'Sent to the dealer/owner for approval. Photos and signatures can be added once the repair is approved.',
          actions: [{ label: 'OK', onPress: () => router.replace('/(tabs)/repairs') }],
        });
        return;
      }

      const newRepair: Repair = {
        id: '', repairId: '',
        ...basePayload,
        receiveDate: receiveDate.trim(),
        createdAt: new Date().toISOString(),
      } as unknown as Repair;

      const apiPayload = {
        customerId: newRepair.customerId || undefined,
        customerName: newRepair.customerName,
        mobile: newRepair.mobile,
        deviceType: newRepair.deviceType,
        brand: newRepair.brand,
        model: newRepair.model,
        imei: newRepair.imei,
        imei2: newRepair.imei2,
        serialNumber: newRepair.serialNumber,
        color: newRepair.color,
        storage: newRepair.storage,
        ram: newRepair.ram,
        devicePassword: newRepair.devicePassword,
        simPresent: newRepair.simPresent,
        memoryCardPresent: newRepair.memoryCardPresent,
        alternateMobile: newRepair.alternateMobile,
        physicalCondition: newRepair.physicalCondition,
        deviceCondition: newRepair.deviceCondition,
        problem: newRepair.problem,
        priority: newRepair.priority,
        repairCharge: newRepair.repairCharge,
        estimatedCost: (newRepair as any).estimatedCost,
        expectedDate: newRepair.expectedDate || new Date().toISOString(),
        dealerId: dealerId ?? (dealerCleared ? null : undefined),
      };

      const net = await Network.getNetworkStateAsync();
      const isOnline = net.isConnected && net.isInternetReachable !== false;
      const clientRequestId = generateUUID();

      if (!isOnline) {
        await offlineQueue.add(apiPayload, clientRequestId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        notice({
          tone: 'info',
          icon: 'wifi-off',
          title: 'Saved offline',
          message: 'The repair is saved on this phone and will sync automatically once the network is back. Photos and signatures will need to be added again after it syncs.',
          actions: [{ label: 'OK', onPress: () => router.push('/repairs') }],
        });
        return;
      }

      let repair;
      try {
        repair = await addRepair({ ...newRepair, clientRequestId } as any);
      } catch (addError: any) {
        // DataContext wraps failures with toFriendlyError, preserving the
        // original error on `cause` — inspect both to detect network drops.
        const cause = addError?.cause;
        const isNetworkError =
          addError instanceof TypeError ||
          cause instanceof TypeError ||
          /network request failed|failed to fetch/i.test(
            (cause instanceof Error ? cause.message : '') || addError?.message || '',
          );
        if (isNetworkError) {
          await offlineQueue.add(apiPayload, clientRequestId);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          notice({
            tone: 'info',
            icon: 'wifi-off',
            title: 'Saved offline',
            message: 'The network dropped, so the repair is saved on this phone and will sync automatically once it is back. Photos and signatures will need to be added again after it syncs.',
            actions: [{ label: 'OK', onPress: () => router.push('/repairs') }],
          });
          return;
        }
        throw addError;
      }

      // Record the optional intake advance in the payment ledger. Non-fatal:
      // the repair is already saved; a failed advance can be collected from
      // the repair screen.
      const advanceAmt = parseFloat(advancePaid) || 0;
      if (advanceAmt > 0 && repair?.id) {
        try {
          await repairPaymentsCreate(repair.id, {
            amount: advanceAmt,
            method: advanceMethod as any,
            kind: 'advance',
            note: 'Advance at intake',
          });
        } catch {
          notice({
            tone: 'warning',
            title: 'Advance not recorded',
            message: 'The repair was saved, but the advance payment could not be recorded. Please record it from the repair screen.',
          });
        }
      }

      for (const p of photos) {
        const path = await uploadToGcs(p.uri, 'image/jpeg');
        if (path) {
          await repairPhotosAdd(repair.id, { kind: p.kind as any, objectPath: path });
        }
      }
      // Every photo is on the server now; the cache copies have done their job.
      photos.forEach((p) => discardPhotoFile(p.uri));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCreatedRepair(repair);
    } catch (err: any) {
      if (err?.code === 'APPROVAL_REQUIRED' || err?.message?.includes('APPROVAL_REQUIRED') || err?.data?.code === 'APPROVAL_REQUIRED') {
        setForceApprovalMode(true);
        notice({
          tone: 'warning',
          icon: 'shield',
          title: 'Approval required',
          message: 'This entry needs dealer approval. Add a reason and submit again.',
        });
        return;
      }
      notice({
        tone: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : "Couldn't save the repair. Please try again. Your entries are still here.",
      });
    } finally {
      setLoading(false);
    }
  };

  /** Web has no in-app camera: the browser's file picker feeds the category modal. */
  const pickPhotoOnWeb = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        notice({
          tone: 'warning',
          icon: 'image',
          title: 'Photo access needed',
          message: 'Allow photo library access to add device images.',
        });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!result.canceled && result.assets[0]) {
        setShowPhotoKindModal(result.assets[0].uri);
      }
    } catch (e) {
      console.warn(e);
    }
  };

  // The camera chip opens the viewfinder itself — no "camera or gallery"
  // prompt in between; the gallery is a strip inside the camera.
  const handlePickPhoto = () => {
    if (photos.length >= MAX_PHOTOS) {
      notice({
        tone: 'info',
        icon: 'image',
        title: 'Photo limit reached',
        message: `You can add up to ${MAX_PHOTOS} device images.`,
      });
      return;
    }
    if (Platform.OS === 'web') {
      void pickPhotoOnWeb();
      return;
    }
    setCameraOpen(true);
  };

  const generatePDF = async () => {
    if (!createdRepair) return;
    try {
      let qrBase64 = '';
      if (qrRef.current) {
        qrBase64 = await new Promise((resolve) => {
          qrRef.current.getDataURL((dataURL: string) => {
            resolve(`data:image/png;base64,${dataURL}`);
          });
        });
      }

      const esc = (v: any) =>
        String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const row = (label: string, value?: string | number | null) => {
        if (value === undefined || value === null || String(value).trim() === '') return '';
        return `<tr><td class="lbl">${esc(label)}</td><td class="val">${esc(value)}</td></tr>`;
      };

      const r = createdRepair;
      const shopName = user?.businessName || 'Avarpus';
      const shopLines = [user?.shopAddress, user?.gstNumber ? `GSTIN: ${user.gstNumber}` : '', user?.mobile ? `Mobile: ${user.mobile}` : '']
        .filter(Boolean).map(l => `<div class="shopline">${esc(l!)}</div>`).join('');

      const accList = (r.accessoriesList && r.accessoriesList.length > 0)
        ? r.accessoriesList.join(', ')
        : (r.accessories || '');
      const accessoriesStr = accList;

      const physical = Object.keys(r.physicalCondition || {}).filter(k => r.physicalCondition?.[k])
        .map(k => PHYSICAL_CONDITION_ITEMS.find(p => p.id === k)?.label || k);
      const physicalStr = physical.join(', ');

      const checklistKeys = Object.keys(r.checklist || {});
      const checklistHtml = checklistKeys.length === 0 ? '' : `
        <div class="section">Pre-Repair Checklist</div>
        <div class="chips">
          ${checklistKeys.map(k => {
            const label = CHECKLIST_ITEMS.find(c => c.id === k)?.label || k;
            const ok = !!r.checklist?.[k];
            return `<span class="chip ${ok ? 'ok' : 'fail'}">${esc(label)}: ${ok ? 'OK' : 'Not Working'}</span>`;
          }).join('')}
        </div>`;

      const priorityLabel = PRIORITY_LABELS[r.priority as keyof typeof PRIORITY_LABELS] || r.priority;

      const html = `
        <html>
          <head><meta charset="utf-8" />
          <style>
            body { font-family: Helvetica, Arial, sans-serif; color: #111; padding: 24px; font-size: 12px; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; }
            h1 { margin: 0 0 2px; font-size: 20px; }
            .sub { color: #555; margin: 0 0 6px; font-size: 12px; }
            .shopline { color: #555; font-size: 11px; }
            .ticket { font-size: 15px; font-weight: bold; margin-top: 8px; }
            .section { background: #f0f2f5; border-left: 4px solid #1f4e8c; padding: 4px 8px; font-weight: bold; margin: 14px 0 6px; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; }
            td { padding: 3px 6px; vertical-align: top; }
            td.lbl { width: 38%; color: #555; }
            td.val { font-weight: 600; }
            tr:nth-child(even) { background: #fafafa; }
            .chips span { display: inline-block; border: 1px solid #ccc; border-radius: 10px; padding: 2px 8px; margin: 2px; font-size: 10px; }
            .chip.ok { border-color: #2e7d32; color: #2e7d32; }
            .chip.fail { border-color: #c62828; color: #c62828; }
            .terms { margin-top: 14px; font-size: 10px; color: #555; border-top: 1px solid #ddd; padding-top: 8px; }
            .sigimg { height: 70px; }
            .sigblock { margin-top: 16px; }
          </style></head>
          <body>
            <div class="header">
              <div>
                <h1>${esc(shopName)}</h1>
                <p class="sub">Device Receive Receipt / Job Card</p>
                ${shopLines}
                <div class="ticket">Ticket No: ${esc(r.repairId)}</div>
              </div>
              ${qrBase64 ? `<img src="${qrBase64}" width="110" height="110" />` : ''}
            </div>

             <div class="section">Customer Details</div>
            <table>
              ${row('Name', r.customerName)}
              ${row('Mobile', r.mobile)}
              ${row('Alternate Mobile', r.alternateMobile)}
              ${row('Email', email.trim())}
              ${row('Address', address.trim())}
            </table>

            <div class="section">Device Details</div>
            <table>
              ${row('Device', `${r.deviceType ? r.deviceType + ' - ' : ''}${r.brand} ${r.model}`)}
              ${row('IMEI 1', r.imei)}
              ${row('IMEI 2', r.imei2)}
              ${row('Serial Number', r.serialNumber)}
              ${row('Color', r.color)}
              ${row('Storage', r.storage)}
              ${row('RAM', r.ram)}
              ${row('SIM Card Inside', r.simPresent ? 'Yes' : undefined)}
              ${row('Memory Card Inside', r.memoryCardPresent ? 'Yes' : undefined)}
              ${row('Accessories Received', accessoriesStr)}
              ${row('Physical Condition', physicalStr)}
              ${row('Condition Notes', r.deviceCondition)}
            </table>

            <div class="section">Repair Details</div>
            <table>
              ${row('Problem Reported', r.problem)}
              ${row('Priority', priorityLabel)}
              ${row('Receive Date', r.receiveDate)}
              ${row('Expected Delivery', r.expectedDate)}
              ${row('Estimated Charge', `Rs. ${r.repairCharge}`)}
              ${row('Notes', r.notes)}
            </table>

            ${checklistHtml}

            <div class="terms">
              This receipt confirms that the above device has been received by ${esc(shopName)} for repair.
              Please present this receipt (or the ticket number) at the time of device collection.
              The final charge may vary after diagnosis; any change will be confirmed with the customer before proceeding.
            </div>

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
      notice({ tone: 'error', title: 'PDF not generated', message: 'The receipt could not be generated. Please try again.' });
    }
  };

  if (createdRepair) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>

        <View style={styles.successView}>
          <View style={[styles.successIconWrap, { backgroundColor: colors.success + '22' }]}>
            <Feather name="check-circle" size={48} color={colors.success} />
          </View>
          <Text style={[styles.successTitle, { color: colors.foreground, fontFamily: fontFamily.bold }]}>
            Job Card Created
          </Text>
          <Text style={[styles.successSubtitle, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
            Ticket No: {createdRepair.repairId}
          </Text>

          <View style={styles.qrWrap}>
            <QRCode value={createdRepair.id} size={160} getRef={(c) => (qrRef.current = c)} />
          </View>

          <View style={{ width: '100%', gap: 12, marginTop: 30 }}>
            <Button title="Download Job Card PDF" onPress={generatePDF} size="lg" />
            <Button title="Back to Repairs" onPress={() => router.replace('/(tabs)/repairs')} size="lg" variant="outline" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <FadeInView animValue={anims[0]} style={[styles.header, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => step === 2 ? setStep(1) : router.replace('/(tabs)/repairs')} style={styles.backBtn}>
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: fontFamily.bold }]}>
           {step === 1 ? 'SERVICE FORM' : 'REVIEW & CONFIRM'}
        </Text>
         {step === 1 ? (
           <TouchableOpacity
             onPress={handleReview}
             accessibilityRole="button"
             accessibilityLabel="Review service form"
             style={styles.headerCheck}
           >
             <Feather name="check" size={24} color={colors.primary} />
           </TouchableOpacity>
         ) : <View style={{ width: 44 }} />}
      </FadeInView>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <FadeInView animValue={anims[1]} style={{ gap: space.lg }}>

          {step === 1 ? (
            <>
              {/* Customer contact — dense card: eyebrow heading with the dealer link on the same line */}
              <View style={[styles.section, styles.denseSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.denseHeaderRow}>
                  <SectionHeader title="Customer Details" icon="user" compact />
                  {!isDealerPortalUser && (
                    // 44dp touch box around a 32dp pill: slop cannot reach past the header row, so the box itself carries the target.
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => {
                        setDealerSearch('');
                        setShowDealerPick(true);
                      }}
                      style={styles.dealerLinkTouch}
                    >
                      <View
                        style={[
                          styles.dealerLinkButton,
                          { backgroundColor: dealerId ? colors.primary + '14' : colors.card, borderColor: dealerId ? colors.primary : colors.border },
                        ]}
                      >
                        <Feather name="briefcase" size={size.inlineIconSm} color={dealerId ? colors.primary : colors.mutedForeground} />
                        <Text
                          numberOfLines={1}
                          style={[styles.dealerLinkLabel, { color: dealerId ? colors.primary : colors.foreground }]}
                        >
                          {selectedDealer ? selectedDealer.dealerCode : 'Link Dealer'}
                        </Text>
                        <Feather name={showDealerPick ? 'chevron-up' : 'chevron-down'} size={size.inlineIconSm} color={colors.mutedForeground} />
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
                 <View style={styles.twoColumnRow}>
                   <View style={styles.twoColumn}>
                      <Input
                        dense
                        label="Name *"
                        value={customerName}
                        onChangeText={setCustomerName}
                        placeholder="Full name"
                        leftIcon="user"
                        error={errors.customerName}
                        inputContainerStyle={flatField}
                      />
                   </View>
                   <View style={styles.twoColumn}>
                     <Input
                       dense
                       label="Mobile Number *"
                       value={mobile}
                       onChangeText={setMobile}
                      placeholder="Number"
                       keyboardType="phone-pad"
                       leftIcon="phone"
                       rightIcon={showAlternateMobile ? 'x' : 'plus'}
                       onRightIconPress={() => {
                         if (showAlternateMobile) setAlternateMobile('');
                         setShowAlternateMobile((visible) => !visible);
                       }}
                       rightIconAccessibilityLabel={showAlternateMobile ? 'Remove alternate mobile' : 'Add alternate mobile'}
                       error={errors.mobile}
                        inputContainerStyle={flatField}
                     />
                   </View>
                 </View>
                {detectedDealer && (
                  <View style={{ borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <Feather name="check-circle" size={15} color={colors.primary} />
                       <Text style={{ ...font.captionStrong, color: colors.primary }}>Dealer Account Detected</Text>
                    </View>
                     <Text style={{ ...font.bodyStrong, color: colors.foreground }}>{detectedDealer.name}</Text>
                     <Text style={{ ...font.caption, color: colors.mutedForeground, marginTop: 2 }}>
                      {detectedDealer.dealerCode}{detectedDealer.shopName ? ` · ${detectedDealer.shopName}` : ''} · {detectedDealer.mobile}
                    </Text>
                    <TouchableOpacity
                      onPress={() => { setDealerId(null); setAutoDetected(false); setDealerCleared(true); }}
                      style={{ marginTop: 8, alignSelf: 'flex-start' }}
                    >
                       <Text style={{ ...font.captionStrong, color: colors.mutedForeground }}>Remove dealer link</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {detectMatches.length > 1 && !dealerId && (
                  <View style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                     <Text style={{ ...font.captionStrong, color: colors.foreground, marginBottom: space.sm }}>
                      This number matches {detectMatches.length} dealers — choose one:
                    </Text>
                    {detectMatches.map((d) => (
                      <TouchableOpacity
                        key={d.id}
                        onPress={() => { setDealerId(d.id); setAutoDetected(false); setDealerCleared(false); fillFromDealer(d); }}
                        style={{ paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
                      >
                         <Text style={{ ...font.captionStrong, color: colors.foreground }}>{d.name}</Text>
                         <Text style={{ ...font.smallStrong, color: colors.primary }}>{d.dealerCode}{d.shopName ? ` · ${d.shopName}` : ''}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                 {showAlternateMobile && (
                   <Input
                     dense
                     label="Alternative Mobile"
                     value={alternateMobile}
                     onChangeText={setAlternateMobile}
                     placeholder="10-digit alternative number"
                     keyboardType="phone-pad"
                     leftIcon="phone"
                   />
                 )}
                 <View style={styles.twoColumnRow}>
                   <View style={styles.twoColumn}>
                      <Input
                        dense
                        label="Email"
                        value={email}
                        onChangeText={setEmail}
                        placeholder="Optional"
                        keyboardType="email-address"
                        leftIcon="mail"
                        autoCapitalize="none"
                        inputContainerStyle={flatField}
                      />
                   </View>
                   <View style={styles.twoColumn}>
                      <Input
                        dense
                        label="Address"
                        value={address}
                        onChangeText={setAddress}
                        placeholder="Optional"
                        leftIcon="map-pin"
                        inputContainerStyle={flatField}
                      />
                   </View>
                 </View>
              </View>

              {/* Device — dense card: the device type is a captioned tile on the heading line (tap to change);
                  Brand / Model share one two-column row, the same widths as Device ID / Password below */}
              <View style={[styles.section, styles.denseSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.denseHeaderRow}>
                  <SectionHeader title="Device Details" icon="smartphone" compact />
                  <View style={styles.headerChipRow}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setShowDeviceType(true)}
                      accessibilityRole="button"
                      accessibilityLabel={`Device type: ${deviceType}`}
                      style={styles.deviceTypeTouch}
                    >
                      <Text style={[styles.deviceTypeCaption, { color: colors.mutedForeground }]}>Device Type</Text>
                      <View style={[styles.tileChip, { backgroundColor: colors.accent }]}>
                        <DeviceTypeIcon type={deviceType} size={size.statIcon} color={colors.primary} />
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.twoColumnRow}>
                  <View style={styles.compactField}>
                    <Text
                      onPress={() => setShowBrand(v => !v)}
                      accessibilityRole="button"
                      style={[styles.compactFieldLabel, { color: colors.foreground }]}
                    >
                      Brand *
                    </Text>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setShowBrand(v => !v)}
                      style={[styles.compactToggle, { backgroundColor: colors.card, borderColor: errors.brand ? colors.destructive : showBrand ? colors.primary : colors.border }]}
                    >
                      <View style={[styles.checkboxSm, { backgroundColor: brand ? colors.primary : 'transparent', borderColor: brand ? colors.primary : colors.muted }]}>
                        {!!brand && <Feather name="check" size={size.checkMarkSm} color="#FFF" />}
                      </View>
                      {brand ? (
                        <Text
                          numberOfLines={compactValueLines(brand)}
                          adjustsFontSizeToFit
                          minimumFontScale={0.8}
                          style={[styles.compactToggleValue, { color: colors.primary }]}
                        >
                          {brand}
                        </Text>
                      ) : (
                        <Text numberOfLines={1} style={[styles.compactToggleLabel, { color: colors.placeholder }]}>Brand</Text>
                      )}
                      <Feather name={showBrand ? 'chevron-up' : 'chevron-down'} size={size.inlineIconSm} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    {!!errors.brand && (
                      <Text style={[styles.fieldError, { color: colors.destructive, fontFamily: fontFamily.medium }]}>{errors.brand}</Text>
                    )}
                    {showBrand && (
                      <View style={[styles.vListWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
                        <ScrollView style={styles.vList} nestedScrollEnabled showsVerticalScrollIndicator>
                          {BRANDS.map((b) => {
                            const selected = brand === b;
                            return (
                              <TouchableOpacity
                                key={b}
                                activeOpacity={0.7}
                                onPress={() => { setBrand(b); setShowBrand(false); }}
                                style={[styles.vItem, { borderBottomColor: colors.border, backgroundColor: selected ? colors.primary + '10' : 'transparent' }]}
                              >
                                <View style={[styles.radioOuter, { borderColor: selected ? colors.primary : colors.muted }]}>
                                  {selected && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
                                </View>
                                <Text style={[styles.checklistLabel, { color: colors.foreground, fontFamily: selected ? fontFamily.semibold : fontFamily.medium }]}>{b}</Text>
                                {selected && <Feather name="check" size={size.inlineIcon} color={colors.primary} />}
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    )}
                  </View>

                  <View style={styles.compactField}>
                    <Text style={[styles.compactFieldLabel, { color: colors.foreground }]}>Model *</Text>
                    <Input dense value={model} onChangeText={setModel} placeholder="Model" error={errors.model} />
                  </View>
                </View>

                <View style={styles.twoColumnRow}>
                  <View style={styles.compactField}>
                    <Text style={[styles.compactFieldLabel, { color: colors.foreground }]}>Device ID</Text>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setShowIdentifierModal(true)}
                      accessibilityLabel="Device identifier selector"
                      style={[styles.identifierFieldControl, {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRadius: colors.radius - 2,
                      }]}
                    >
                      <Text numberOfLines={1} style={[styles.identifierFieldText, {
                        color: (serialNumber || imei || imei2) ? colors.foreground : colors.placeholder,
                      }]}>
                        {[serialNumber && 'Serial', imei && 'IMEI 1', imei2 && 'IMEI 2'].filter(Boolean).join(', ') || 'Select ID'}
                      </Text>
                      <Feather name="chevron-down" size={size.inlineIcon} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.twoColumn}>
                    <Input
                      dense
                      label="Password / Pattern"
                      value={devicePassword}
                      onChangeText={setDevicePassword}
                      placeholder="Optional"
                      secureTextEntry={!showDevicePassword}
                      rightIcon={devicePassword ? (showDevicePassword ? 'eye-off' : 'eye') : undefined}
                      onRightIconPress={() => setShowDevicePassword((visible) => !visible)}
                      rightIconAccessibilityLabel={showDevicePassword ? 'Hide device password' : 'Show device password'}
                      inputContainerStyle={flatField}
                    />
                  </View>
                </View>

                {/* SIM / memory card present: glyph + word on the left, the checkbox at the right edge. A ticked
                    toggle turns blue as a whole (tinted box, blue border, blue glyph, word and box) so the state
                    reads from across the counter, not just from the tick. */}
                <View style={styles.twoColumnRow}>
                  {([
                    { key: 'sim', label: 'SIM', a11y: 'SIM Present', checked: simPresent, toggle: () => setSimPresent(!simPresent), Glyph: SimCardIcon },
                    { key: 'memory', label: 'Memory', a11y: 'Memory Card Present', checked: memoryCardPresent, toggle: () => setMemoryCardPresent(!memoryCardPresent), Glyph: SdCardIcon },
                  ] as const).map(({ key, label, a11y, checked, toggle, Glyph }) => (
                    <TouchableOpacity
                      key={key}
                      activeOpacity={0.7}
                      onPress={toggle}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={a11y}
                      style={[
                        styles.presenceToggle,
                        checked
                          ? { backgroundColor: colors.blueSoft, borderColor: colors.primary }
                          : { backgroundColor: colors.card, borderColor: colors.border },
                      ]}
                    >
                      <View style={styles.presenceLead}>
                        <Glyph size={size.presenceGlyph} color={checked ? colors.primary : colors.foreground} />
                        <Text style={[styles.presenceLabel, { color: checked ? colors.primary : colors.foreground }]} numberOfLines={1}>
                          {label}
                        </Text>
                      </View>
                      {/* Empty box outlined in mutedForeground: the dense lists' `muted` border all but vanishes on the light card. */}
                      <View style={[styles.presenceCheckbox, { backgroundColor: checked ? colors.primary : 'transparent', borderColor: checked ? colors.primary : colors.mutedForeground }]}>
                        {checked && <Feather name="check" size={size.checkMark} color={colors.primaryForeground} />}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Condition — the two toggles sit directly in the card; no per-column box around them */}
              <View style={[styles.section, styles.denseSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <SectionHeader title="Device Condition" icon="check-square" compact />
                <View style={styles.twoColumnRow}>
                  <View style={styles.compactField}>
                    <Text style={[styles.compactFieldLabel, { color: colors.foreground }]}>Physical</Text>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setShowPhysical(v => !v)}
                      accessibilityLabel="Physical"
                      style={[styles.compactToggle, { backgroundColor: colors.card, borderColor: showPhysical ? colors.primary : colors.border }]}
                    >
                      <View style={[styles.checkboxSm, { backgroundColor: showPhysical ? colors.primary : 'transparent', borderColor: showPhysical ? colors.primary : colors.muted }]}>
                        {showPhysical && <Feather name="check" size={size.checkMarkSm} color="#FFF" />}
                      </View>
                      <Text numberOfLines={1} style={[styles.compactToggleLabel, { color: physicalCount > 0 ? colors.primary : colors.mutedForeground }]}>
                        {physicalCount > 0 ? `${physicalCount} selected` : 'Select'}
                      </Text>
                      <Feather name={showPhysical ? 'chevron-up' : 'chevron-down'} size={size.inlineIconSm} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    {showPhysical && (
                      <View style={[styles.vListWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
                        <ScrollView style={styles.vList} nestedScrollEnabled showsVerticalScrollIndicator>
                          {PHYSICAL_CONDITION_ITEMS.map((item) => {
                            const checked = physicalCondition[item.id] || false;
                            return (
                              <TouchableOpacity
                                key={item.id}
                                activeOpacity={0.7}
                                onPress={() => setPhysicalCondition(prev => ({ ...prev, [item.id]: !checked }))}
                                style={[styles.vItem, { borderBottomColor: colors.border, backgroundColor: checked ? colors.primary + '10' : 'transparent' }]}
                              >
                                <View style={[styles.checkboxSm, { backgroundColor: checked ? colors.primary : 'transparent', borderColor: checked ? colors.primary : colors.muted }]}>
                                  {checked && <Feather name="check" size={size.checkMarkSm} color="#FFF" />}
                                </View>
                                <Text style={[styles.checklistLabel, { color: colors.foreground }]}>{item.label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    )}
                  </View>

                  <View style={styles.compactField}>
                    <Text style={[styles.compactFieldLabel, { color: colors.foreground }]}>Pre Repair</Text>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setShowChecklist(v => !v)}
                      accessibilityLabel="Pre Repair"
                      style={[styles.compactToggle, { backgroundColor: colors.card, borderColor: showChecklist ? colors.primary : colors.border }]}
                    >
                      <View style={[styles.checkboxSm, { backgroundColor: showChecklist ? colors.primary : 'transparent', borderColor: showChecklist ? colors.primary : colors.muted }]}>
                        {showChecklist && <Feather name="check" size={size.checkMarkSm} color="#FFF" />}
                      </View>
                      <Text numberOfLines={1} style={[styles.compactToggleLabel, { color: checklistCount > 0 ? colors.primary : colors.mutedForeground }]}>
                        {checklistCount > 0 ? `${checklistCount} selected` : 'Select'}
                      </Text>
                      <Feather name={showChecklist ? 'chevron-up' : 'chevron-down'} size={size.inlineIconSm} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    {showChecklist && (
                      <View style={[styles.vListWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
                        <ScrollView style={styles.vList} nestedScrollEnabled showsVerticalScrollIndicator>
                          {CHECKLIST_ITEMS.map((item) => {
                            const checked = checklist[item.id] || false;
                            return (
                              <TouchableOpacity
                                key={item.id}
                                activeOpacity={0.7}
                                onPress={() => setChecklist(prev => ({ ...prev, [item.id]: !checked }))}
                                style={[styles.vItem, { borderBottomColor: colors.border, backgroundColor: checked ? colors.primary + '10' : 'transparent' }]}
                              >
                                <View style={[styles.checkboxSm, { backgroundColor: checked ? colors.primary : 'transparent', borderColor: checked ? colors.primary : colors.muted }]}>
                                  {checked && <Feather name="check" size={size.checkMarkSm} color="#FFF" />}
                                </View>
                                <Text style={[styles.checklistLabel, { color: colors.foreground }]}>{item.label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              {/* Photos — one compact card: eyebrow + count on the heading line, then the photo strip on the
                  left (a slot per allowed photo, filled as they come in) and a small camera button on the right */}
              <View style={[styles.section, styles.denseSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.photoHeaderRow}>
                  <SectionHeader title="Add Images" icon="camera" compact />
                  <Text style={[styles.photoCount, { color: colors.mutedForeground }]}>
                    {photos.length}/{MAX_PHOTOS} Images
                  </Text>
                </View>
                <View style={styles.photoRow}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip} contentContainerStyle={styles.photoStripContent}>
                    {photos.map((p, i) => {
                      const kind = PHOTO_KINDS.find(k => k.id === p.kind);
                      return (
                        <View key={i} style={[styles.photoThumbWrap, { borderColor: colors.border }]} accessibilityLabel={`${kind?.label || p.kind} photo`}>
                          <Image source={{ uri: p.uri }} style={styles.photoThumb} />
                          <View style={[styles.photoBadge, { backgroundColor: colors.primary }]}>
                            <Text numberOfLines={1} style={styles.photoBadgeText}>{kind?.tag || p.kind}</Text>
                          </View>
                          <TouchableOpacity
                            style={[styles.photoRemove, { backgroundColor: colors.destructive }]}
                            onPress={() => {
                              discardPhotoFile(p.uri);
                              setPhotos(prev => prev.filter((_, idx) => idx !== i));
                            }}
                            hitSlop={hitSlop.thumbCorner}
                            accessibilityRole="button"
                            accessibilityLabel="Remove image"
                          >
                            <Feather name="x" size={size.checkMarkSm} color="#FFF" />
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                    {Array.from({ length: Math.max(0, MAX_PHOTOS - photos.length) }, (_, i) => (
                      <TouchableOpacity
                        key={`slot-${i}`}
                        activeOpacity={0.7}
                        onPress={handlePickPhoto}
                        accessibilityRole="button"
                        accessibilityLabel="Add image"
                        style={[styles.photoSlot, { borderColor: colors.border }]}
                      >
                        <Feather name="image" size={size.inlineIcon} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={handlePickPhoto}
                    accessibilityRole="button"
                    accessibilityLabel="Add image"
                    style={[styles.addPhotoBtn, { backgroundColor: colors.primary + '14', borderColor: colors.primary }]}
                  >
                    <Feather name="camera" size={size.fieldGlyph} color={colors.primary} />
                    <View style={[styles.addPhotoPlus, { backgroundColor: colors.primary, borderColor: colors.card }]}>
                      <Feather name="plus" size={size.checkMarkSm} color="#FFF" />
                    </View>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Problem — the delivery date and priority live as icon chips on the heading line */}
              <View style={[styles.section, styles.denseSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.denseHeaderRow}>
                  <SectionHeader title="Service Details" icon="clipboard" compact />
                  <View style={styles.headerChipRow}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setShowExpectedDate(true)}
                      accessibilityRole="button"
                      accessibilityLabel={`Expected delivery date: ${formatDayLabel(expectedDate)}`}
                      style={styles.headerChipTouch}
                    >
                      <View style={[styles.headerChip, { backgroundColor: colors.primary + '14', borderColor: errors.expectedDate ? colors.destructive : colors.primary }]}>
                        <Feather name="calendar" size={size.inlineIcon} color={colors.primary} />
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setShowPriority(true)}
                      accessibilityRole="button"
                      accessibilityLabel={`Priority: ${PRIORITY_LABELS[priority] || priority}`}
                      style={styles.headerChipTouch}
                    >
                      <View style={[styles.headerChip, { backgroundColor: priorityColor + '14', borderColor: priorityColor }]}>
                        <Feather name="flag" size={size.inlineIcon} color={priorityColor} />
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
                {!!errors.expectedDate && (
                  <Text style={[styles.fieldError, { color: colors.destructive, fontFamily: fontFamily.medium }]}>{errors.expectedDate}</Text>
                )}
                <Input
                  dense
                  label="Problem Description *"
                  value={problem}
                  onChangeText={setProblem}
                  placeholder="Describe the issue..."
                  multiline
                  style={styles.problemInput}
                  error={errors.problem}
                />
                {isBackdated && (
                  <View style={[styles.warningBanner, { backgroundColor: colors.warning + '22', borderColor: colors.warning + '55' }]}>
                    <Feather name="alert-triangle" size={16} color={colors.warning} />
                    <Text style={[styles.warningText, { color: colors.warning, fontFamily: fontFamily.medium }]}>
                      This is a backdated entry. Dealer/Owner approval is required.
                    </Text>
                  </View>
                )}
                {isBackdated && (
                  <Input dense label="Reason for backdating *" value={reason} onChangeText={setReason} placeholder="Explain why this is backdated..." error={errors.reason} />
                )}
              </View>

              <CalendarDialog
                visible={showExpectedDate}
                title="Expected delivery"
                value={expectedDate}
                minDate={receiveDate}
                onSelect={setExpectedDate}
                onClose={() => setShowExpectedDate(false)}
              />

              <Modal visible={showDeviceType} transparent animationType="fade" onRequestClose={() => setShowDeviceType(false)}>
                <Pressable style={styles.dialogBackdrop} onPress={() => setShowDeviceType(false)} accessibilityLabel="Close device type">
                  <Pressable style={[styles.priorityDialog, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
                    <Text style={[styles.dialogTitle, { color: colors.foreground }]}>Device type</Text>
                    {DEVICE_TYPES.map((dt) => {
                      const selected = deviceType === dt;
                      return (
                        <TouchableOpacity
                          key={dt}
                          activeOpacity={0.7}
                          onPress={() => { setDeviceType(dt); setShowDeviceType(false); }}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          style={[styles.priorityOption, { backgroundColor: selected ? colors.primary + '14' : 'transparent' }]}
                        >
                          <DeviceTypeIcon type={dt} size={size.inlineIcon} color={selected ? colors.primary : colors.mutedForeground} />
                          <Text style={[styles.priorityOptionLabel, { color: selected ? colors.primary : colors.foreground, fontFamily: selected ? fontFamily.semibold : fontFamily.medium }]}>
                            {dt}
                          </Text>
                          {selected && <Feather name="check" size={size.inlineIcon} color={colors.primary} />}
                        </TouchableOpacity>
                      );
                    })}
                  </Pressable>
                </Pressable>
              </Modal>

              <Modal visible={showPriority} transparent animationType="fade" onRequestClose={() => setShowPriority(false)}>
                <Pressable style={styles.dialogBackdrop} onPress={() => setShowPriority(false)} accessibilityLabel="Close priority">
                  <Pressable style={[styles.priorityDialog, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
                    <Text style={[styles.dialogTitle, { color: colors.foreground }]}>Priority</Text>
                    {PRIORITIES.map((opt) => {
                      const selected = priority === opt;
                      const tint = priorityTint(opt, colors);
                      return (
                        <TouchableOpacity
                          key={opt}
                          activeOpacity={0.7}
                          onPress={() => { setPriority(opt); setShowPriority(false); }}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          style={[styles.priorityOption, { backgroundColor: selected ? tint + '14' : 'transparent' }]}
                        >
                          <Feather name="flag" size={size.inlineIcon} color={tint} />
                          <Text style={[styles.priorityOptionLabel, { color: selected ? tint : colors.foreground, fontFamily: selected ? fontFamily.semibold : fontFamily.medium }]}>
                            {PRIORITY_LABELS[opt] || opt}
                          </Text>
                          {selected && <Feather name="check" size={size.inlineIcon} color={tint} />}
                        </TouchableOpacity>
                      );
                    })}
                  </Pressable>
                </Pressable>
              </Modal>

              {/* Financials — Estimate and Advance side by side; the advance on/off is the icon tile at the
                  right end of the row, in line with the two money boxes */}
              <View style={[styles.section, styles.denseSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.estimateRow}>
                  <View style={styles.estimateColumn}>
                    <Text style={[styles.estimateLabel, { color: colors.foreground }]}>Estimate</Text>
                    <Input
                      dense
                      value={repairCharge}
                      onChangeText={setRepairCharge}
                      placeholder="0"
                      keyboardType="decimal-pad"
                      leftText="₹"
                      accessibilityLabel="Estimate"
                    />
                  </View>
                  <View style={styles.estimateColumn}>
                    <Text style={[styles.estimateLabel, { color: colors.foreground }]}>Advance Paid</Text>
                    <Input
                      dense
                      value={advancePaid}
                      onChangeText={setAdvancePaid}
                      placeholder={advanceEnabled ? '0' : 'Advance'}
                      keyboardType="decimal-pad"
                      leftText="₹"
                      editable={advanceEnabled}
                      containerStyle={{ opacity: advanceEnabled ? 1 : 0.62 }}
                      accessibilityLabel="Advance amount"
                    />
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      const enabled = !advanceEnabled;
                      setAdvanceEnabled(enabled);
                      if (!enabled) setAdvancePaid('');
                    }}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: advanceEnabled }}
                    accessibilityLabel="Advance paid"
                    style={styles.advanceToggleTouch}
                  >
                    <View style={[styles.tileChip, { backgroundColor: advanceEnabled ? colors.accent : colors.muted }]}>
                      <Feather
                        name={advanceEnabled ? 'toggle-right' : 'toggle-left'}
                        size={size.statIcon}
                        color={advanceEnabled ? colors.primary : colors.mutedForeground}
                      />
                    </View>
                  </TouchableOpacity>
                </View>
                {(parseFloat(advancePaid) || 0) > 0 && (
                  <>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                      {['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'].map((m) => (
                        <TouchableOpacity
                          key={m}
                          activeOpacity={0.7}
                          onPress={() => setAdvanceMethod(m)}
                          style={{
                            paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1,
                            borderColor: advanceMethod === m ? colors.primary : colors.border,
                            backgroundColor: advanceMethod === m ? colors.primary + '18' : 'transparent',
                          }}
                        >
                           <Text style={{ ...font.captionStrong, color: advanceMethod === m ? colors.primary : colors.mutedForeground }}>{m}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                       <Text style={{ ...font.captionStrong, color: colors.mutedForeground }}>Estimated Balance</Text>
                       <Text style={{ ...font.bodyStrong, color: colors.foreground }}>
                        ₹{Math.max((parseFloat(repairCharge) || 0) - (parseFloat(advancePaid) || 0), 0)}
                      </Text>
                    </View>
                  </>
                )}
              </View>

               <TouchableOpacity
                 onPress={handleReview}
                 activeOpacity={0.88}
                 accessibilityRole="button"
                 style={[styles.receiveButton, { backgroundColor: colors.primary }]}
               >
                 <Feather name="box" size={size.statIcon} color={colors.primaryForeground} />
                 <Text style={[styles.receiveTitle, { color: colors.primaryForeground }]}>RECEIVE</Text>
                 <Feather name="chevron-right" size={size.statIcon} color={colors.primaryForeground} />
               </TouchableOpacity>
            </>
          ) : (
            <>
              {/* SUMMARY VIEW */}
              <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <SectionHeader title="Intake Summary" />
                <View style={[styles.summaryBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Customer:</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>{customerName}</Text></View>
                  <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Mobile:</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>{mobile}</Text></View>
                  <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Device:</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>{deviceType} - {brand} {model}</Text></View>
                  <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Problem:</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>{problem}</Text></View>
                  <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Estimate:</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>₹{repairCharge || '0'}</Text></View>
                  {(parseFloat(advancePaid) || 0) > 0 && (
                    <>
                      <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Advance:</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>₹{advancePaid} ({advanceMethod})</Text></View>
                      <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Est. Balance:</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>₹{Math.max((parseFloat(repairCharge) || 0) - (parseFloat(advancePaid) || 0), 0)}</Text></View>
                    </>
                  )}
                  <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Exp. Date:</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>{expectedDate}</Text></View>
                  <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Priority:</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>{PRIORITY_LABELS[priority] || priority}</Text></View>
                  <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Photos:</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>{photos.length} captured</Text></View>
                </View>
              </View>

              {/* Customer Confirmation */}
              <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setCustomerConfirmed(!customerConfirmed)}
                  style={[styles.confirmationWrap, { backgroundColor: colors.card, borderColor: customerConfirmed ? colors.primary : colors.border }]}
                >
                  <View style={[styles.checkbox, { backgroundColor: customerConfirmed ? colors.primary : 'transparent', borderColor: customerConfirmed ? colors.primary : colors.muted }]}>
                    {customerConfirmed && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  <Text style={[styles.confirmationText, { color: colors.foreground, fontFamily: fontFamily.medium }]}>
                    I have submitted the device and the above details are correct.
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ alignItems: 'center', marginTop: 10 }}>
                 <Text style={{ ...font.caption, color: colors.mutedForeground }}>
                  Received by: {user?.name || 'System'}
                </Text>
              </View>

              <Button
                title={isBackdated ? "Request Approval" : "Complete Intake"}
                onPress={handleSubmit}
                loading={loading}
                disabled={!customerConfirmed}
                fullWidth
                size="lg"
                style={{ marginTop: 10 }}
              />
            </>
          )}

        </FadeInView>
      </KeyboardAwareScrollViewCompat>

      {/* Dealer selection is a separate full-screen page so no Receive Form
          controls remain visible while searching or choosing a dealer. */}
      <Modal
        visible={showDealerPick && !isDealerPortalUser}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowDealerPick(false)}
      >
        <View style={[styles.dealerPickerScreen, { backgroundColor: colors.background }]}>
           <View style={[styles.dealerPickerHeader, { paddingTop: topPad, borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setShowDealerPick(false)}
              style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}
              accessibilityLabel="Close dealer selection"
            >
              <Feather name="arrow-left" size={20} color={colors.foreground} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: fontFamily.bold }]}>Select Dealer</Text>
               <Text style={{ ...font.caption, color: colors.mutedForeground }}>Search and link a dealer to this repair</Text>
            </View>
          </View>

          <View style={{ padding: 16, paddingBottom: 8 }}>
            <Input
              label="Search dealers"
              value={dealerSearch}
              onChangeText={setDealerSearch}
              placeholder="Search by name, code, shop or mobile"
              leftIcon="search"
              autoFocus
            />
          </View>

          <ScrollView
             contentContainerStyle={{ paddingHorizontal: layout.screenPadding, paddingBottom: insets.bottom + space.xxl, gap: space.sm }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {filteredDealers.length > 0 ? filteredDealers.map((d) => {
              const active = dealerId === d.id;
              return (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => {
                    setDealerId(active ? null : d.id);
                    setAutoDetected(false);
                    setDealerCleared(active);
                    if (!active) fillFromDealer(d);
                    setShowDealerPick(false);
                  }}
                  activeOpacity={0.8}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12,
                    borderWidth: 1, backgroundColor: active ? colors.primary + '15' : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.primary + '15' }}>
                     <Text style={{ ...font.smallStrong, color: colors.primary }}>{d.dealerCode}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                     <Text style={{ ...font.bodyStrong, color: colors.foreground }}>{d.name}</Text>
                     {!!d.shopName && <Text style={{ ...font.caption, color: colors.mutedForeground }}>{d.shopName}</Text>}
                     <Text style={{ ...font.caption, color: colors.mutedForeground }}>{d.mobile}</Text>
                  </View>
                  {active && <Feather name="check" size={17} color={colors.primary} />}
                </TouchableOpacity>
              );
            }) : (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                 <Feather name="users" size={size.headerIcon} color={colors.mutedForeground} />
                <Text style={{ color: colors.foreground, fontFamily: fontFamily.semibold, marginTop: 10 }}>
                  {dealerSearch.trim() ? 'No matching dealers' : 'No dealers yet'}
                </Text>
                 <Text style={{ ...font.caption, color: colors.mutedForeground, textAlign: 'center', marginTop: space.xs }}>
                  {dealerSearch.trim() ? 'Try another name, code, shop or mobile.' : 'Add a dealer to link it to this repair.'}
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => {
                setShowDealerPick(false);
                router.push('/(tabs)/repairs/dealer-new');
              }}
              style={[styles.addDealerButton, { borderColor: colors.primary + '55', backgroundColor: colors.primary + '0D' }]}
            >
              <Feather name="plus-circle" size={17} color={colors.primary} />
               <Text style={{ ...font.captionStrong, color: colors.primary }}>Add New Dealer</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showIdentifierModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowIdentifierModal(false)}
      >
        <View style={[styles.overlayCenter, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <View style={[styles.identifierModal, { backgroundColor: colors.card, borderColor: colors.destructive + '66' }]}>
            <View style={styles.identifierModalHeader}>
              <View>
                <Text style={[styles.identifierModalTitle, { color: colors.foreground, fontFamily: fontFamily.bold }]}>
                  Device ID
                </Text>
                <Text style={[styles.identifierModalHint, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
                  Select one or more, then enter the details
                </Text>
              </View>
              <TouchableOpacity
                accessibilityLabel="Close identifier popup"
                onPress={() => setShowIdentifierModal(false)}
                style={[styles.identifierClose, { borderColor: colors.border }]}
              >
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.identifierModalScroll} keyboardShouldPersistTaps="handled">
              {DEVICE_IDENTIFIER_OPTIONS.map((option) => {
                const selected = selectedIdentifiers[option.id];
                const value = option.id === 'serialNumber' ? serialNumber : option.id === 'imei' ? imei : imei2;
                const onChangeText = option.id === 'serialNumber' ? setSerialNumber : option.id === 'imei' ? setImei : setImei2;
                return (
                  <View key={option.id} style={styles.identifierOptionBlock}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      accessibilityLabel={`Select ${option.label}`}
                      onPress={() => setSelectedIdentifiers(previous => ({ ...previous, [option.id]: !selected }))}
                      style={[styles.identifierOption, {
                        borderColor: selected ? colors.destructive + '99' : colors.border,
                        backgroundColor: selected ? colors.destructive + '0A' : colors.card,
                      }]}
                    >
                      <View style={[styles.checkbox, {
                        backgroundColor: selected ? colors.destructive : 'transparent',
                        borderColor: selected ? colors.destructive : colors.muted,
                      }]}>
                        {selected && <Feather name="check" size={14} color="#FFF" />}
                      </View>
                      <Text style={[styles.identifierOptionLabel, { color: colors.foreground, fontFamily: fontFamily.semibold }]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                    {selected && (
                      <Input
                        value={value}
                        onChangeText={onChangeText}
                        placeholder={option.label}
                        keyboardType={option.id === 'serialNumber' ? 'default' : 'number-pad'}
                        inputContainerStyle={{ borderColor: colors.destructive + '66', backgroundColor: colors.destructive + '0A' }}
                      />
                    )}
                  </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              activeOpacity={0.8}
              accessibilityLabel="Save device identifiers"
              onPress={() => setShowIdentifierModal(false)}
              style={[styles.identifierOkButton, { backgroundColor: colors.primary }]}
            >
              <Feather name="check" size={18} color="#FFF" />
              <Text style={[styles.identifierOkText, { fontFamily: fontFamily.bold }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <RepairPhotoCamera
        visible={cameraOpen}
        kinds={PHOTO_KINDS}
        onClose={() => setCameraOpen(false)}
        onPicked={(photo) => {
          setPhotos(prev => (prev.length >= MAX_PHOTOS ? prev : [...prev, photo]));
          setCameraOpen(false);
        }}
      />

      {/* Photo Kind Modal (web picks only; the camera categorises its own photos) */}
      <Modal visible={!!showPhotoKindModal} animationType="fade" transparent onRequestClose={() => setShowPhotoKindModal(null)}>
        <View style={[styles.overlayCenter, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <View style={[styles.kindModal, { backgroundColor: colors.card }]}>
            <Text style={[styles.kindTitle, { color: colors.foreground, fontFamily: fontFamily.semibold }]}>Photo Category</Text>
            <View style={styles.kindGrid}>
              {PHOTO_KINDS.map(k => (
                <TouchableOpacity
                  key={k.id}
                  style={[styles.kindBtn, { borderColor: colors.border }]}
                  onPress={() => {
                    if (showPhotoKindModal) {
                      setPhotos(prev => [...prev, { uri: showPhotoKindModal, kind: k.id }]);
                      setShowPhotoKindModal(null);
                    }
                  }}
                >
                  <Text style={[styles.kindBtnText, { color: colors.foreground, fontFamily: fontFamily.medium }]}>{k.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={{ marginTop: 20 }} onPress={() => setShowPhotoKindModal(null)}>
               <Text style={{ ...font.button, color: colors.destructive, textAlign: 'center' }}>Cancel</Text>
            </TouchableOpacity>
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
    minHeight: layout.headerHeight, paddingHorizontal: layout.screenPadding,
  },
  backBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  headerCheck: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: layout.screenPadding, paddingTop: space.sm },
  section: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  estimateRow: { flexDirection: 'row', gap: space.sm },
  estimateColumn: { flex: 1, minWidth: 0, gap: space.xs },
  estimateLabel: { ...font.captionStrong },
  // 44dp touch box for the advance on/off chip; sits at the foot of the row so the chip centres on the money boxes.
  advanceToggleTouch: { width: size.iconButton, height: size.inputSm, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  twoColumnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  twoColumn: { flex: 1, minWidth: 0 },
  compactField: { flex: 1, minWidth: 0, gap: space.xs },
  // Labels of the compact two-column fields stay on the caption size (same as dense Input labels).
  compactFieldLabel: { ...font.captionStrong },
  identifierFieldControl: { minHeight: size.inputSm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.md, paddingVertical: 0, borderWidth: 1.5 },
  identifierFieldText: { flex: 1, minWidth: 0, ...font.body },
  compactToggle: { minHeight: size.inputSm, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: 0, borderRadius: radius.sm, borderWidth: 1 },
  compactToggleLabel: { flex: 1, minWidth: 0, ...font.small },
  // Chosen value: small type, two lines allowed ("Apple / iPhone" wraps, still inside the 44dp box) and a
  // single long word shrinks a little on a 360dp half row.
  compactToggleValue: { flex: 1, minWidth: 0, ...font.smallStrong },
  // Glyph + word on the left, checkbox on the right, in the same 44dp box as the fields beside it.
  presenceToggle: { flex: 1, minWidth: 0, minHeight: size.inputSm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, paddingHorizontal: space.sm, borderRadius: radius.sm, borderWidth: 1 },
  presenceLead: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  presenceLabel: { flexShrink: 1, ...font.label },
  // A step larger than the dense-list box: this checkbox is the whole control, not a row marker.
  presenceCheckbox: { width: size.checkbox, height: size.checkbox, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  // Step-1 cards run dense: eyebrow heading, 44dp fields, tighter rows.
  denseSection: { gap: space.sm, paddingVertical: space.md },
  // Heading line that also carries actions (dealer link, date / priority chips). Wraps so the actions drop
  // under the heading instead of overflowing on narrow screens. The row is 44dp tall (the chips' touch
  // boxes) but pulled into the card padding so the 32dp pills still sit where a 32dp row would put them.
  denseHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
    minHeight: size.iconButton,
    marginTop: -space.sm,
    marginBottom: -space.xs,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, marginBottom: 3 },
  sectionHeaderCompact: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: size.chip, flexShrink: 1 },
  sectionIcon: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sectionIconCompact: { width: size.eyebrowMark, height: size.eyebrowMark, borderRadius: size.eyebrowMark / 2, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { ...font.heading },
  sectionTitleCompact: { ...font.overline, flexShrink: 1 },
  dealerLinkTouch: { minHeight: size.iconButton, justifyContent: 'center', maxWidth: '52%', marginLeft: 'auto' },
  dealerLinkButton: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: size.chip, paddingHorizontal: space.md, borderRadius: size.chip / 2, borderWidth: 1 },
  dealerLinkLabel: { ...font.smallStrong, flexShrink: 1 },
  headerChipRow: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' },
  headerChipTouch: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  headerChip: { width: size.chip, height: size.chip, borderRadius: size.chip / 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  // Tinted square behind a glyph, the same tile the summary counters use; no outline.
  tileChip: { width: size.statBox, height: size.statBox, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  // Caption + tile form one control; the caption sits to the left so the tile keeps the row's right edge.
  deviceTypeTouch: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: size.iconButton, paddingLeft: space.xs },
  deviceTypeCaption: { ...font.small },
  // Same scrim as ConfirmDialog / CalendarDialog so the form's dialogs read as one family.
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(6, 10, 18, 0.72)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  dialogTitle: { ...font.overline, paddingHorizontal: space.md, marginBottom: space.xs },
  priorityDialog: { width: '100%', maxWidth: 320, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: space.xs },
  priorityOption: { minHeight: size.buttonSm, paddingHorizontal: space.md, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  priorityOptionLabel: { flex: 1, ...font.label },
  // Problem box: one dense line while empty, grows with the text up to six lines, then scrolls.
  problemInput: { maxHeight: font.body.lineHeight * 6 + space.xxl },
  dealerPickerScreen: { flex: 1 },
  dealerPickerHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: layout.headerHeight, paddingHorizontal: layout.listInset, borderBottomWidth: 1 },
  addDealerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 13, marginTop: 8, borderRadius: 11, borderWidth: 1 },
  vListWrap: { borderWidth: 1, borderRadius: radius.sm, overflow: 'hidden' },
  vList: { maxHeight: 250 },
  fieldError: { ...font.caption, marginTop: -6 },
  radioOuter: { width: size.checkboxSm, height: size.checkboxSm, borderRadius: size.checkboxSm / 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: size.checkboxSm / 2, height: size.checkboxSm / 2, borderRadius: size.checkboxSm / 4 },
  // Rows of the drop-down choice lists: dense-menu height with the small checkbox.
  vItem: { minHeight: size.denseRow, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkboxSm: { width: size.checkboxSm, height: size.checkboxSm, borderRadius: 3, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checklistLabel: { ...font.captionStrong, flex: 1 },
  // Heading line of the photo card: the eyebrow's 32dp box pulled in so the card stays tight.
  photoHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginTop: -space.xs, marginBottom: -space.xs },
  photoCount: { ...font.caption },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  photoStrip: { flex: 1, minWidth: 0 },
  photoStripContent: { gap: space.sm, alignItems: 'center' },
  // 44dp camera button with a small "+" disc riding its top-right corner.
  addPhotoBtn: { width: size.iconButton, height: size.iconButton, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  addPhotoPlus: { position: 'absolute', top: -space.xs, right: -space.xs, width: size.inlineIconSm, height: size.inlineIconSm, borderRadius: size.inlineIconSm / 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  photoThumbWrap: { width: size.photoThumb, height: size.photoThumb, borderRadius: radius.sm, borderWidth: 1, overflow: 'hidden' },
  photoThumb: { width: '100%', height: '100%' },
  // Empty slot standing in for a photo not yet taken; tapping it adds one.
  photoSlot: { width: size.photoThumb, height: size.photoThumb, borderRadius: radius.sm, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  photoBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 2, paddingHorizontal: space.xs, alignItems: 'center' },
  photoBadgeText: { ...font.tag, color: '#FFFFFF' },
  photoRemove: { position: 'absolute', top: space.xs, right: space.xs, width: size.inlineIcon, height: size.inlineIcon, borderRadius: size.inlineIcon / 2, alignItems: 'center', justifyContent: 'center' },
  receiveButton: { minHeight: size.button, borderRadius: radius.sm, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, marginTop: space.xs, marginBottom: space.sm },
  receiveTitle: { ...font.button },
  sigBtn: { padding: 12, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sigBtnText: { ...font.captionStrong },
  sigPreviewWrap: { height: 100, borderRadius: 10, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  sigPreview: { width: '100%', height: '100%' },
  sigClear: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1 },
  sigScreen: { flex: 1, paddingHorizontal: layout.screenPadding, paddingBottom: space.xl },
  sigHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  sigSubtitle: { ...font.caption, marginTop: 2 },
  sigCloseBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sigCard: { flex: 1, borderRadius: 12, borderWidth: 1, overflow: 'hidden', backgroundColor: '#FFF' },
  sigBaseline: { position: 'absolute', left: 20, right: 20, bottom: 16, borderTopWidth: 1, borderTopColor: '#D1D5DB', borderStyle: 'dashed', paddingTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  sigBaselineText: { ...font.caption, color: '#9CA3AF' },
  sigFooterRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalTitle: { ...font.heading },
  overlayCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  kindModal: { width: '100%', padding: 16, borderRadius: 16 },
  kindTitle: { ...font.title, marginBottom: space.md, textAlign: 'center' },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindBtn: { width: '48%', padding: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  kindBtnText: { ...font.captionStrong },
  identifierModal: { width: '100%', maxWidth: 520, maxHeight: '82%', padding: 16, borderRadius: 18, borderWidth: 1 },
  identifierModalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  identifierModalTitle: { ...font.title },
  identifierModalHint: { ...font.caption, marginTop: 2 },
  identifierClose: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  identifierModalScroll: { flexGrow: 0 },
  identifierOptionBlock: { gap: 7, marginBottom: 10 },
  identifierOption: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1 },
  identifierOptionLabel: { flex: 1, ...font.labelStrong },
  identifierOkButton: { minHeight: size.button, marginTop: 6, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  identifierOkText: { ...font.button, color: '#FFF' },
  successView: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  successIconWrap: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  successTitle: { ...font.heading, marginBottom: 6 },
  successSubtitle: { ...font.body, marginBottom: space.xxl },
  qrWrap: { padding: 16, backgroundColor: '#FFF', borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 4 },
  warningText: { flex: 1, ...font.caption },
  summaryBox: { padding: 12, borderRadius: 10, borderWidth: 1, gap: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  summaryLabel: { ...font.caption, flex: 1 },
  summaryValue: { ...font.captionStrong, flex: 2, textAlign: 'right' },
  confirmationWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  confirmationText: { flex: 1, ...font.body },
});
