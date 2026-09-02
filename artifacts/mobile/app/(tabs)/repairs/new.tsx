import React, { useState, useRef, useEffect } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  Image,
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
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SelectInput } from '@/components/ui/SelectInput';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
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
import { requestUploadUrl, repairPhotosAdd, approvalsCreate, repairPaymentsCreate, useDealersList, useDealersDetect } from '@workspace/api-client-react';
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
  { id: 'other', label: 'Other' },
];

const ACCESSORY_ITEMS = [
  { id: 'Charger', label: 'Charger' },
  { id: 'Cable', label: 'Cable' },
  { id: 'Adapter', label: 'Adapter' },
  { id: 'Box', label: 'Box' },
  { id: 'SIM Tray', label: 'SIM Tray' },
  { id: 'SIM', label: 'SIM' },
  { id: 'Memory Card', label: 'Memory Card' },
  { id: 'Cover', label: 'Cover' },
  { id: 'Earphones', label: 'Earphones' },
  { id: 'Other', label: 'Other' },
];

const WARRANTY_OPTIONS = [
  { label: 'No Warranty', value: '0' },
  { label: '7 Days', value: '7' },
  { label: '30 Days', value: '30' },
  { label: '90 Days', value: '90' },
  { label: '180 Days', value: '180' },
];

const PHOTO_KINDS = [
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Back' },
  { id: 'imei', label: 'IMEI / Serial' },
  { id: 'left', label: 'Left Edge' },
  { id: 'right', label: 'Right Edge' },
  { id: 'top', label: 'Top Edge' },
  { id: 'bottom', label: 'Bottom Edge' },
  { id: 'damage', label: 'Damage Detail' },
  { id: 'bill', label: 'Customer Bill' },
  { id: 'customer_id', label: 'Customer ID' },
  { id: 'other', label: 'Other' },
];

function SectionHeader({ title }: { title: string }) {
  const colors = useColors();
  return (
    <View style={[styles.sectionHeader, { borderLeftColor: colors.primary }]}>
      <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{title}</Text>
    </View>
  );
}

export default function NewRepairScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
  const [colorAttr, setColorAttr] = useState('');
  const [storage, setStorage] = useState('');
  const [ram, setRam] = useState('');
  const [devicePassword, setDevicePassword] = useState('');
  const [showDevicePassword, setShowDevicePassword] = useState(false);
  const [simPresent, setSimPresent] = useState(false);
  const [memoryCardPresent, setMemoryCardPresent] = useState(false);

  const [accessoriesList, setAccessoriesList] = useState<string[]>([]);
  const [showAccessories, setShowAccessories] = useState(false);
  const [showPhysical, setShowPhysical] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [showWarranty, setShowWarranty] = useState(false);
  const [showDeviceType, setShowDeviceType] = useState(false);
  const [showBrand, setShowBrand] = useState(false);
  const [otherAccessories, setOtherAccessories] = useState('');
  const [physicalCondition, setPhysicalCondition] = useState<Record<string, boolean>>({});
  const [deviceCondition, setDeviceCondition] = useState('');
  const [problem, setProblem] = useState('');

  const [priority, setPriority] = useState('normal');
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
  const [advanceMethod, setAdvanceMethod] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [warrantyDays, setWarrantyDays] = useState('0');
  const [receiveDate, setReceiveDate] = useState(getTodayStr());
  const [expectedDate, setExpectedDate] = useState(getNextWeekStr());
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [forceApprovalMode, setForceApprovalMode] = useState(false);

  const [photos, setPhotos] = useState<{ uri: string, kind: string }[]>([]);
  const [customerConfirmed, setCustomerConfirmed] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [showPhotoKindModal, setShowPhotoKindModal] = useState<string | null>(null);

  const [createdRepair, setCreatedRepair] = useState<Repair | null>(null);
  const qrRef = useRef<any>(null);

  const isStaff = user?.role !== 'dealer' && user?.role !== 'super_admin';
  const isBackdated = isStaff && (receiveDate.trim() < getTodayStr() || forceApprovalMode);
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
      Alert.alert('Validation Error', 'Please check the required fields.');
    }
  };

  const uploadToGcs = async (fileUri: string, mimeType: string) => {
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
      Alert.alert('Required', 'Please confirm that the details are correct.');
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
        accessories: otherAccessories.trim() || undefined,
        accessoriesList,
        physicalCondition,
        deviceCondition: deviceCondition.trim() || undefined,
        status: 'received', priority: priority as Repair['priority'],
        repairCharge: parseFloat(repairCharge) || 0, partsCharge: 0,
        estimatedCost: parseFloat(repairCharge) || 0,
        expectedDate: expectedDate.trim(), notes: notes.trim() || undefined,
        checklist, warrantyDays: parseInt(warrantyDays, 10) || 0,
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
        Alert.alert('Request Sent', 'Request sent to Dealer/Owner for approval.\n\nNote: Photos and signatures can be added after the repair is approved.', [
          { text: 'OK', onPress: () => router.replace('/(tabs)/repairs') }
        ]);
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
        accessories: newRepair.accessories,
        accessoriesList: newRepair.accessoriesList,
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
        Alert.alert('Saved Offline', 'The repair was saved offline and will sync automatically when network is available.\n\nPhotos and signatures will need to be re-added after sync.', [
          { text: 'OK', onPress: () => router.push('/repairs') }
        ]);
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
          Alert.alert('Saved Offline', 'Network request failed. The repair was saved offline and will sync automatically when network is available.\n\nPhotos and signatures will need to be re-added after sync.', [
            { text: 'OK', onPress: () => router.push('/repairs') }
          ]);
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
          Alert.alert('Advance Not Recorded', 'The repair was saved, but the advance payment could not be recorded. Please collect it from the repair screen.');
        }
      }

      for (const p of photos) {
        const path = await uploadToGcs(p.uri, 'image/jpeg');
        if (path) {
          await repairPhotosAdd(repair.id, { kind: p.kind as any, objectPath: path });
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCreatedRepair(repair);
    } catch (err: any) {
      if (err?.code === 'APPROVAL_REQUIRED' || err?.message?.includes('APPROVAL_REQUIRED') || err?.data?.code === 'APPROVAL_REQUIRED') {
        setForceApprovalMode(true);
        Alert.alert('Approval Required', 'This entry requires dealer approval. Please provide a reason and submit again.');
        return;
      }
      Alert.alert(
        'Save failed',
        err instanceof Error ? err.message : "Couldn't save the repair. Please try again. Your entries are still here.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Camera permission is required.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (!result.canceled && result.assets[0]) {
        setShowPhotoKindModal(result.assets[0].uri);
      }
    } catch (e) {
      console.warn(e);
    }
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
      const accessoriesStr = [accList, otherAccessories.trim()].filter(Boolean).join(', ');

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
              ${row('Warranty', r.warrantyDays && r.warrantyDays > 0 ? `${r.warrantyDays} Days` : 'No Warranty')}
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
      Alert.alert('Error', 'Could not generate PDF.');
    }
  };

  const toggleAccessory = (acc: string) => {
    setAccessoriesList(prev => prev.includes(acc) ? prev.filter(a => a !== acc) : [...prev, acc]);
  };

  if (createdRepair) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>

        <View style={styles.successView}>
          <View style={[styles.successIconWrap, { backgroundColor: colors.success + '22' }]}>
            <Feather name="check-circle" size={48} color={colors.success} />
          </View>
          <Text style={[styles.successTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            Job Card Created
          </Text>
          <Text style={[styles.successSubtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
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


      <FadeInView animValue={anims[0]} style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => step === 2 ? setStep(1) : router.replace('/(tabs)/repairs')} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          {step === 1 ? 'Receive Form' : 'Review & Confirm'}
        </Text>
        <View style={{ width: 44 }} />
      </FadeInView>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <FadeInView animValue={anims[1]} style={{ gap: 20 }}>

          {step === 1 ? (
            <>
              {/* Customer */}
              <View style={styles.section}>
                <View style={styles.customerHeaderRow}>
                  <SectionHeader title="Customer Details" />
                  {!isDealerPortalUser && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => {
                        setDealerSearch('');
                        setShowDealerPick(true);
                      }}
                      style={[styles.dealerLinkButton, { backgroundColor: colors.card, borderColor: dealerId ? colors.primary : colors.border }]}
                    >
                      <Feather name="briefcase" size={15} color={dealerId ? colors.primary : colors.mutedForeground} />
                      <Text
                        numberOfLines={1}
                        style={[styles.dealerLinkLabel, { color: dealerId ? colors.primary : colors.foreground, fontFamily: 'Inter_600SemiBold' }]}
                      >
                        {selectedDealer ? selectedDealer.dealerCode : 'Link Dealer'}
                      </Text>
                      <Feather name={showDealerPick ? 'chevron-up' : 'chevron-down'} size={15} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>
                <Input label="Name *" value={customerName} onChangeText={setCustomerName} placeholder="Full name" leftIcon="user" error={errors.customerName} />
                <Input
                  label="Mobile *"
                  value={mobile}
                  onChangeText={setMobile}
                  placeholder="10-digit number"
                  keyboardType="phone-pad"
                  leftIcon="phone"
                  rightIcon={showAlternateMobile ? 'x' : 'plus'}
                  onRightIconPress={() => {
                    if (showAlternateMobile) setAlternateMobile('');
                    setShowAlternateMobile((visible) => !visible);
                  }}
                  rightIconAccessibilityLabel={showAlternateMobile ? 'Remove alternate mobile' : 'Add alternate mobile'}
                  error={errors.mobile}
                />
                {detectedDealer && (
                  <View style={{ borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <Feather name="check-circle" size={15} color={colors.primary} />
                      <Text style={{ fontSize: 13, color: colors.primary, fontFamily: 'Inter_700Bold' }}>Dealer Account Detected</Text>
                    </View>
                    <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{detectedDealer.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                      {detectedDealer.dealerCode}{detectedDealer.shopName ? ` · ${detectedDealer.shopName}` : ''} · {detectedDealer.mobile}
                    </Text>
                    <TouchableOpacity
                      onPress={() => { setDealerId(null); setAutoDetected(false); setDealerCleared(true); }}
                      style={{ marginTop: 8, alignSelf: 'flex-start' }}
                    >
                      <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }}>Remove dealer link</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {detectMatches.length > 1 && !dealerId && (
                  <View style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 8 }}>
                      This number matches {detectMatches.length} dealers — choose one:
                    </Text>
                    {detectMatches.map((d) => (
                      <TouchableOpacity
                        key={d.id}
                        onPress={() => { setDealerId(d.id); setAutoDetected(false); setDealerCleared(false); fillFromDealer(d); }}
                        style={{ paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
                      >
                        <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{d.name}</Text>
                        <Text style={{ fontSize: 11, color: colors.primary, fontFamily: 'Inter_700Bold' }}>{d.dealerCode}{d.shopName ? ` · ${d.shopName}` : ''}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {showAlternateMobile && (
                  <Input
                    label="Alternative Mobile"
                    value={alternateMobile}
                    onChangeText={setAlternateMobile}
                    placeholder="10-digit alternative number"
                    keyboardType="phone-pad"
                    leftIcon="phone"
                  />
                )}
                <Input label="Email" value={email} onChangeText={setEmail} placeholder="Optional" keyboardType="email-address" leftIcon="mail" autoCapitalize="none" />
                <Input label="Address" value={address} onChangeText={setAddress} placeholder="Optional" leftIcon="map-pin" />
              </View>

              {/* Device */}
              <View style={styles.section}>
                <SectionHeader title="Device Details" />
                <View style={styles.threeColumnRow}>
                  <View style={styles.compactField}>
                    <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowDeviceType(v => !v)}
                      style={[styles.compactToggle, { backgroundColor: colors.card, borderColor: showDeviceType ? colors.primary : colors.border }]}
                    >
                  <View style={[styles.checkbox, { backgroundColor: deviceType ? colors.primary : 'transparent', borderColor: deviceType ? colors.primary : colors.muted }]}>
                    {!!deviceType && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                      <Text numberOfLines={1} style={[styles.compactToggleLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Device Type *</Text>
                  <View style={[styles.countBadge, { backgroundColor: colors.primary + '1A' }]}>
                    <Text style={[styles.countBadgeText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{deviceType}</Text>
                  </View>
                  <Feather name={showDeviceType ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    {showDeviceType && (
                      <View style={[styles.vListWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
                        <ScrollView style={styles.vList} nestedScrollEnabled showsVerticalScrollIndicator>
                          {DEVICE_TYPES.map((dt) => {
                            const selected = deviceType === dt;
                            return (
                              <TouchableOpacity
                                key={dt}
                                activeOpacity={0.7}
                                onPress={() => { setDeviceType(dt); setShowDeviceType(false); }}
                                style={[styles.vItem, { borderBottomColor: colors.border, backgroundColor: selected ? colors.primary + '10' : 'transparent' }]}
                              >
                                <View style={[styles.radioOuter, { borderColor: selected ? colors.primary : colors.muted }]}>
                                  {selected && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
                                </View>
                                <Text style={[styles.checklistLabel, { color: colors.foreground, fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>{dt}</Text>
                                {selected && <Feather name="check" size={16} color={colors.primary} />}
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    )}
                  </View>

                  <View style={styles.compactField}>
                    <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowBrand(v => !v)}
                      style={[styles.compactToggle, { backgroundColor: colors.card, borderColor: errors.brand ? colors.destructive : showBrand ? colors.primary : colors.border }]}
                    >
                  <View style={[styles.checkbox, { backgroundColor: brand ? colors.primary : 'transparent', borderColor: brand ? colors.primary : colors.muted }]}>
                    {!!brand && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                      <Text numberOfLines={1} style={[styles.compactToggleLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Brand *</Text>
                  {!!brand && (
                    <View style={[styles.countBadge, { backgroundColor: colors.primary + '1A' }]}>
                      <Text style={[styles.countBadgeText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{brand}</Text>
                    </View>
                  )}
                  <Feather name={showBrand ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    {!!errors.brand && (
                      <Text style={[styles.fieldError, { color: colors.destructive, fontFamily: 'Inter_500Medium' }]}>{errors.brand}</Text>
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
                                <Text style={[styles.checklistLabel, { color: colors.foreground, fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>{b}</Text>
                                {selected && <Feather name="check" size={16} color={colors.primary} />}
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    )}
                  </View>

                  <View style={styles.compactField}>
                    <Input label="Model *" value={model} onChangeText={setModel} placeholder="Enter your model" leftIcon="smartphone" error={errors.model} />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Input label="IMEI 1" value={imei} onChangeText={setImei} placeholder="Optional" keyboardType="number-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input label="IMEI 2" value={imei2} onChangeText={setImei2} placeholder="Optional" keyboardType="number-pad" />
                  </View>
                </View>
                <Input label="Serial Number" value={serialNumber} onChangeText={setSerialNumber} placeholder="Optional" />

                <View style={{ position: 'relative' }}>
                  <Input
                    label="Device Password / Pattern"
                    value={devicePassword}
                    onChangeText={setDevicePassword}
                    placeholder="Optional"
                    secureTextEntry={!showDevicePassword}
                  />
                  {!!devicePassword && (
                    <TouchableOpacity style={{ position: 'absolute', right: 12, top: 40 }} onPress={() => setShowDevicePassword(!showDevicePassword)}>
                      <Feather name={showDevicePassword ? 'eye-off' : 'eye'} size={20} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => setSimPresent(!simPresent)} style={[styles.checklistItem, { backgroundColor: colors.card, borderColor: simPresent ? colors.primary : colors.border }]}>
                    <View style={[styles.checkbox, { backgroundColor: simPresent ? colors.primary : 'transparent', borderColor: simPresent ? colors.primary : colors.muted }]}>
                      {simPresent && <Feather name="check" size={14} color="#FFF" />}
                    </View>
                    <Text style={[styles.checklistLabel, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>SIM Present</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => setMemoryCardPresent(!memoryCardPresent)} style={[styles.checklistItem, { backgroundColor: colors.card, borderColor: memoryCardPresent ? colors.primary : colors.border }]}>
                    <View style={[styles.checkbox, { backgroundColor: memoryCardPresent ? colors.primary : 'transparent', borderColor: memoryCardPresent ? colors.primary : colors.muted }]}>
                      {memoryCardPresent && <Feather name="check" size={14} color="#FFF" />}
                    </View>
                    <Text style={[styles.checklistLabel, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>SD Card Present</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Accessories */}
              <View style={styles.threeColumnRow}>
                <View style={styles.compactField}>
                <Text style={[styles.compactFieldLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Accessories</Text>
                <View style={styles.section}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowAccessories(v => !v)}
                  accessibilityLabel="Accessories"
                  style={[styles.sectionToggle, { backgroundColor: colors.card, borderColor: showAccessories ? colors.primary : colors.border }]}
                >
                  <View style={[styles.checkbox, { backgroundColor: showAccessories ? colors.primary : 'transparent', borderColor: showAccessories ? colors.primary : colors.muted }]}>
                    {showAccessories && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  {accessoriesList.length > 0 && (
                    <View style={[styles.countBadge, { backgroundColor: colors.primary + '1A' }]}>
                      <Text style={[styles.countBadgeText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{accessoriesList.length}</Text>
                    </View>
                  )}
                  <Feather name={showAccessories ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
                {showAccessories && (
                  <>
                    <View style={[styles.vListWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
                      <ScrollView style={styles.vList} nestedScrollEnabled showsVerticalScrollIndicator>
                        {ACCESSORY_ITEMS.map((item) => {
                          const checked = accessoriesList.includes(item.id);
                          return (
                            <TouchableOpacity
                              key={item.id}
                              activeOpacity={0.7}
                              onPress={() => toggleAccessory(item.id)}
                              style={[styles.vItem, { borderBottomColor: colors.border, backgroundColor: checked ? colors.primary + '10' : 'transparent' }]}
                            >
                              <View style={[styles.checkbox, { backgroundColor: checked ? colors.primary : 'transparent', borderColor: checked ? colors.primary : colors.muted }]}>
                                {checked && <Feather name="check" size={14} color="#FFF" />}
                              </View>
                              <Text style={[styles.checklistLabel, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>{item.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                    <Input label="Other Accessories Notes" value={otherAccessories} onChangeText={setOtherAccessories} placeholder="e.g. Broken cover, mixed cables..." />
                  </>
                )}
                </View>
                </View>

              {/* Physical Condition */}
              <View style={styles.compactField}>
              <Text style={[styles.compactFieldLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Physical</Text>
              <View style={styles.section}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowPhysical(v => !v)}
                  accessibilityLabel="Physical"
                  style={[styles.sectionToggle, { backgroundColor: colors.card, borderColor: showPhysical ? colors.primary : colors.border }]}
                >
                  <View style={[styles.checkbox, { backgroundColor: showPhysical ? colors.primary : 'transparent', borderColor: showPhysical ? colors.primary : colors.muted }]}>
                    {showPhysical && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  {Object.values(physicalCondition).filter(Boolean).length > 0 && (
                    <View style={[styles.countBadge, { backgroundColor: colors.primary + '1A' }]}>
                      <Text style={[styles.countBadgeText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{Object.values(physicalCondition).filter(Boolean).length}</Text>
                    </View>
                  )}
                  <Feather name={showPhysical ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
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
                            <View style={[styles.checkbox, { backgroundColor: checked ? colors.primary : 'transparent', borderColor: checked ? colors.primary : colors.muted }]}>
                              {checked && <Feather name="check" size={14} color="#FFF" />}
                            </View>
                            <Text style={[styles.checklistLabel, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>{item.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
              </View>
              </View>

              {/* Checklist */}
              <View style={styles.compactField}>
              <Text style={[styles.compactFieldLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Pre Repair</Text>
              <View style={styles.section}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowChecklist(v => !v)}
                  accessibilityLabel="Pre Repair"
                  style={[styles.sectionToggle, { backgroundColor: colors.card, borderColor: showChecklist ? colors.primary : colors.border }]}
                >
                  <View style={[styles.checkbox, { backgroundColor: showChecklist ? colors.primary : 'transparent', borderColor: showChecklist ? colors.primary : colors.muted }]}>
                    {showChecklist && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  {Object.values(checklist).filter(Boolean).length > 0 && (
                    <View style={[styles.countBadge, { backgroundColor: colors.primary + '1A' }]}>
                      <Text style={[styles.countBadgeText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{Object.values(checklist).filter(Boolean).length}</Text>
                    </View>
                  )}
                  <Feather name={showChecklist ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
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
                            <View style={[styles.checkbox, { backgroundColor: checked ? colors.primary : 'transparent', borderColor: checked ? colors.primary : colors.muted }]}>
                              {checked && <Feather name="check" size={14} color="#FFF" />}
                            </View>
                            <Text style={[styles.checklistLabel, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>{item.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
              </View>
              </View>
              </View>

              {/* Photos */}
              <View style={styles.section}>
                <SectionHeader title="Click Photos" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoScroll}>
                  {photos.map((p, i) => (
                    <View key={i} style={[styles.photoThumbWrap, { borderColor: colors.border }]}>
                      <Image source={{ uri: p.uri }} style={styles.photoThumb} />
                      <View style={[styles.photoBadge, { backgroundColor: colors.primary }]}>
                        <Text style={styles.photoBadgeText}>{PHOTO_KINDS.find(k => k.id === p.kind)?.label || p.kind}</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.photoRemove, { backgroundColor: colors.destructive }]}
                        onPress={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}
                      >
                        <Feather name="x" size={12} color="#FFF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity onPress={handlePickPhoto} style={[styles.addPhotoBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Feather name="camera" size={24} color={colors.primary} />
                    <Text style={[styles.addPhotoText, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>Add Photo</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>

              {/* Problem */}
              <View style={styles.section}>
                <SectionHeader title="Service Details" />
                <Input
                  label="Problem Description *"
                  value={problem}
                  onChangeText={setProblem}
                  placeholder="Describe the issue..."
                  multiline
                  numberOfLines={3}
                  style={{ height: 90, textAlignVertical: 'top', paddingTop: 12 } as any}
                  error={errors.problem}
                />
                {isBackdated && (
                  <View style={[styles.warningBanner, { backgroundColor: colors.warning + '22', borderColor: colors.warning + '55' }]}>
                    <Feather name="alert-triangle" size={16} color={colors.warning} />
                    <Text style={[styles.warningText, { color: colors.warning, fontFamily: 'Inter_500Medium' }]}>
                      This is a backdated entry. Dealer/Owner approval is required.
                    </Text>
                  </View>
                )}
                {isBackdated && (
                  <Input label="Reason for backdating *" value={reason} onChangeText={setReason} placeholder="Explain why this is backdated..." error={errors.reason} />
                )}

                <Input label="Expected Delivery *" value={expectedDate} onChangeText={setExpectedDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} leftIcon="calendar" error={errors.expectedDate} />
                <SelectInput label="Priority" options={PRIORITIES} value={priority} onChange={setPriority} labelMap={PRIORITY_LABELS} />
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowWarranty(v => !v)}
                  style={[styles.sectionToggle, { backgroundColor: colors.card, borderColor: showWarranty ? colors.primary : colors.border }]}
                >
                  <View style={[styles.checkbox, { backgroundColor: showWarranty ? colors.primary : 'transparent', borderColor: showWarranty ? colors.primary : colors.muted }]}>
                    {showWarranty && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  <Text style={[styles.sectionToggleLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Warranty Offered</Text>
                  <View style={[styles.countBadge, { backgroundColor: colors.primary + '1A' }]}>
                    <Text style={[styles.countBadgeText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                      {WARRANTY_OPTIONS.find(o => o.value === warrantyDays)?.label || 'No Warranty'}
                    </Text>
                  </View>
                  <Feather name={showWarranty ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
                {showWarranty && (
                  <View style={[styles.vListWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
                    <ScrollView style={styles.vList} nestedScrollEnabled showsVerticalScrollIndicator>
                      {WARRANTY_OPTIONS.map((opt) => {
                        const selected = warrantyDays === opt.value;
                        return (
                          <TouchableOpacity
                            key={opt.value}
                            activeOpacity={0.7}
                            onPress={() => { setWarrantyDays(opt.value); setShowWarranty(false); }}
                            style={[styles.vItem, { borderBottomColor: colors.border, backgroundColor: selected ? colors.primary + '10' : 'transparent' }]}
                          >
                            <View style={[styles.radioOuter, { borderColor: selected ? colors.primary : colors.muted }]}>
                              {selected && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
                            </View>
                            <Text style={[styles.checklistLabel, { color: colors.foreground, fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>{opt.label}</Text>
                            {selected && <Feather name="check" size={16} color={colors.primary} />}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Financials */}
              <View style={styles.section}>
                <SectionHeader title="Estimate" />
                <Input label="Estimated Repair Cost (₹)" value={repairCharge} onChangeText={setRepairCharge} placeholder="0" keyboardType="decimal-pad" leftText="₹" />
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4, marginBottom: 10, fontFamily: 'Inter_400Regular' }}>
                  This is only an estimate — the final bill is prepared when the repair is completed.
                </Text>
                <Input label="Advance Paid (₹) — optional" value={advancePaid} onChangeText={setAdvancePaid} placeholder="0" keyboardType="decimal-pad" leftText="₹" />
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
                          <Text style={{ color: advanceMethod === m ? colors.primary : colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>{m}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>Estimated Balance</Text>
                      <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
                        ₹{Math.max((parseFloat(repairCharge) || 0) - (parseFloat(advancePaid) || 0), 0)}
                      </Text>
                    </View>
                  </>
                )}
              </View>

              <Button
                title="Complete"
                onPress={handleReview}
                fullWidth
                size="lg"
                style={{ marginTop: 20 }}
              />
            </>
          ) : (
            <>
              {/* SUMMARY VIEW */}
              <View style={styles.section}>
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
                  <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Photos:</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>{photos.length} captured</Text></View>
                </View>
              </View>

              {/* Customer Confirmation */}
              <View style={styles.section}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setCustomerConfirmed(!customerConfirmed)}
                  style={[styles.confirmationWrap, { backgroundColor: colors.card, borderColor: customerConfirmed ? colors.primary : colors.border }]}
                >
                  <View style={[styles.checkbox, { backgroundColor: customerConfirmed ? colors.primary : 'transparent', borderColor: customerConfirmed ? colors.primary : colors.muted }]}>
                    {customerConfirmed && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  <Text style={[styles.confirmationText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                    I have submitted the device and the above details are correct.
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ alignItems: 'center', marginTop: 10 }}>
                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
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
          <View style={[styles.dealerPickerHeader, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setShowDealerPick(false)}
              style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}
              accessibilityLabel="Close dealer selection"
            >
              <Feather name="arrow-left" size={20} color={colors.foreground} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Select Dealer</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Search and link a dealer to this repair</Text>
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
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 8 }}
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
                    <Text style={{ fontSize: 11, color: colors.primary, fontFamily: 'Inter_700Bold' }}>{d.dealerCode}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{d.name}</Text>
                    {!!d.shopName && <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{d.shopName}</Text>}
                    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{d.mobile}</Text>
                  </View>
                  {active && <Feather name="check" size={17} color={colors.primary} />}
                </TouchableOpacity>
              );
            }) : (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Feather name="users" size={28} color={colors.mutedForeground} />
                <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginTop: 10 }}>
                  {dealerSearch.trim() ? 'No matching dealers' : 'No dealers yet'}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: 'center', marginTop: 4 }}>
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
              <Text style={{ fontSize: 13, color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Add New Dealer</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Photo Kind Modal */}
      <Modal visible={!!showPhotoKindModal} animationType="fade" transparent onRequestClose={() => setShowPhotoKindModal(null)}>
        <View style={[styles.overlayCenter, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <View style={[styles.kindModal, { backgroundColor: colors.card }]}>
            <Text style={[styles.kindTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Photo Category</Text>
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
                  <Text style={[styles.kindBtnText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>{k.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={{ marginTop: 20 }} onPress={() => setShowPhotoKindModal(null)}>
              <Text style={{ color: colors.destructive, fontFamily: 'Inter_500Medium', textAlign: 'center', fontSize: 16 }}>Cancel</Text>
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
    paddingHorizontal: 12, paddingBottom: 10,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16 },
  scroll: { paddingHorizontal: 12, paddingTop: 8 },
  section: { gap: 10 },
  threeColumnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  compactField: { flex: 1, minWidth: 0, gap: 8 },
  compactFieldLabel: { fontSize: 11, lineHeight: 14 },
  compactToggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 8, borderRadius: 9, borderWidth: 1 },
  compactToggleLabel: { flex: 1, fontSize: 11 },
  customerHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionHeader: { borderLeftWidth: 2, paddingLeft: 8, marginTop: 4, marginBottom: 2 },
  sectionTitle: { fontSize: 14 },
  dealerLinkButton: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '52%', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, borderWidth: 1 },
  dealerLinkLabel: { fontSize: 12, flexShrink: 1 },
  dealerPickerScreen: { flex: 1 },
  dealerPickerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1 },
  addDealerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 13, marginTop: 8, borderRadius: 11, borderWidth: 1 },
  checklistGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  sectionToggleLabel: { fontSize: 13, flex: 1 },
  countBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countBadgeText: { fontSize: 10 },
  vListWrap: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  vList: { maxHeight: 250 },
  fieldError: { fontSize: 11, marginTop: -6 },
  radioOuter: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 8, height: 8, borderRadius: 4 },
  vItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  checklistItem: { width: '48%', flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, gap: 8 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checklistLabel: { fontSize: 12, flex: 1 },
  photoScroll: { gap: 10, paddingVertical: 2 },
  addPhotoBtn: { width: 80, height: 80, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  addPhotoText: { fontSize: 10 },
  photoThumbWrap: { width: 80, height: 80, borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  photoThumb: { width: '100%', height: '100%' },
  photoBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 2, alignItems: 'center' },
  photoBadgeText: { color: '#FFF', fontSize: 8, fontWeight: 'bold' },
  photoRemove: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  sigBtn: { padding: 12, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sigBtnText: { fontSize: 13 },
  sigPreviewWrap: { height: 100, borderRadius: 10, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  sigPreview: { width: '100%', height: '100%' },
  sigClear: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1 },
  sigScreen: { flex: 1, paddingHorizontal: 16, paddingBottom: 20 },
  sigHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  sigSubtitle: { fontSize: 12, marginTop: 2 },
  sigCloseBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sigCard: { flex: 1, borderRadius: 12, borderWidth: 1, overflow: 'hidden', backgroundColor: '#FFF' },
  sigBaseline: { position: 'absolute', left: 20, right: 20, bottom: 16, borderTopWidth: 1, borderTopColor: '#D1D5DB', borderStyle: 'dashed', paddingTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  sigBaselineText: { fontSize: 11, color: '#9CA3AF' },
  sigFooterRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalTitle: { fontSize: 16 },
  overlayCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  kindModal: { width: '100%', padding: 16, borderRadius: 16 },
  kindTitle: { fontSize: 16, marginBottom: 12, textAlign: 'center' },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindBtn: { width: '48%', padding: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  kindBtnText: { fontSize: 12 },
  successView: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  successIconWrap: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  successTitle: { fontSize: 20, marginBottom: 6 },
  successSubtitle: { fontSize: 14, marginBottom: 24 },
  qrWrap: { padding: 16, backgroundColor: '#FFF', borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 4 },
  warningText: { flex: 1, fontSize: 12, lineHeight: 16 },
  summaryBox: { padding: 12, borderRadius: 10, borderWidth: 1, gap: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  summaryLabel: { fontSize: 12, flex: 1 },
  summaryValue: { fontSize: 13, flex: 2, textAlign: 'right', fontFamily: 'Inter_500Medium' },
  confirmationWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  confirmationText: { flex: 1, fontSize: 12, lineHeight: 18 },
});
