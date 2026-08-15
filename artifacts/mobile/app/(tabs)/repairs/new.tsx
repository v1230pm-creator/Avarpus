import React, { useState, useRef } from 'react';
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
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
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
import { ScreenGlow, FadeInView, useStaggerAnim } from '@/components/ui/Glass';
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
import { requestUploadUrl, repairPhotosAdd, approvalsCreate } from '@workspace/api-client-react';
import { fetch as expoFetch } from 'expo/fetch';
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
  const [repairCharge, setRepairCharge] = useState('');
  const [notes, setNotes] = useState('');
  const [warrantyDays, setWarrantyDays] = useState('0');
  const [receiveDate, setReceiveDate] = useState(getTodayStr());
  const [expectedDate, setExpectedDate] = useState(getNextWeekStr());
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [forceApprovalMode, setForceApprovalMode] = useState(false);
  
  const [photos, setPhotos] = useState<{ uri: string, kind: string }[]>([]);
  const [receivingSignatureUri, setReceivingSignatureUri] = useState<string | null>(null);
  const [customerConfirmed, setCustomerConfirmed] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [showSignature, setShowSignature] = useState(false);
  const sigPadRef = useRef<SignatureViewRef>(null);
  const [showPhotoKindModal, setShowPhotoKindModal] = useState<string | null>(null);

  const [createdRepair, setCreatedRepair] = useState<Repair | null>(null);
  const qrRef = useRef<any>(null);

  const isStaff = user?.role !== 'dealer' && user?.role !== 'super_admin';
  const isBackdated = isStaff && (receiveDate.trim() < getTodayStr() || forceApprovalMode);

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
        expectedDate: expectedDate.trim(), notes: notes.trim() || undefined,
        checklist, warrantyDays: parseInt(warrantyDays, 10) || 0,
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
          { text: 'OK', onPress: () => router.back() }
        ]);
        return;
      }

      const newRepair: Repair = {
        id: '', repairId: '',
        ...basePayload,
        receiveDate: receiveDate.trim(),
        createdAt: new Date().toISOString(),
      } as Repair;

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
        expectedDate: newRepair.expectedDate || new Date().toISOString(),
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

      let sigPath;
      if (receivingSignatureUri) {
        sigPath = await uploadToGcs(receivingSignatureUri, 'image/png');
        if (sigPath) {
          await updateRepair({ ...repair, receivingSignaturePath: sigPath });
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

  const handleSignatureOK = async (signature: string) => {
    try {
      const path = FileSystem.cacheDirectory + `sig_${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(path, signature.replace('data:image/png;base64,', ''), {
        encoding: FileSystem.EncodingType.Base64,
      });
      setReceivingSignatureUri(path);
      setShowSignature(false);
    } catch (err) {
      Alert.alert('Error', 'Failed to save signature.');
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

      const html = `
        <html>
          <body style="font-family: sans-serif; padding: 20px;">
            <h1 style="text-align: center;">VMC Electronics - Job Card</h1>
            <hr />
            <div style="display: flex; justify-content: space-between;">
              <div>
                <p><strong>Ticket:</strong> ${createdRepair.repairId}</p>
                <p><strong>Customer:</strong> ${createdRepair.customerName} (${createdRepair.mobile})</p>
                <p><strong>Device:</strong> ${createdRepair.deviceType ? `${createdRepair.deviceType} - ` : ''}${createdRepair.brand} ${createdRepair.model}</p>
                <p><strong>Problem:</strong> ${createdRepair.problem}</p>
                <p><strong>Estimate:</strong> ₹${createdRepair.repairCharge}</p>
                <p><strong>Warranty:</strong> ${createdRepair.warrantyDays} Days</p>
              </div>
              <div>
                ${qrBase64 ? `<img src="${qrBase64}" width="150" height="150" />` : ''}
              </div>
            </div>
            <hr />
            <p><strong>Checklist:</strong></p>
            <ul>
              ${Object.keys(createdRepair.checklist || {}).map(k => {
                const label = CHECKLIST_ITEMS.find(c => c.id === k)?.label || k;
                return `<li>${label}: ${createdRepair.checklist?.[k] ? 'Pass' : 'Fail'}</li>`;
              }).join('')}
            </ul>
            <br/><br/><br/>
            <p>Customer Signature: _______________________</p>
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
        <ScreenGlow />
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
            <Button title="Back to Dashboard" onPress={() => router.back()} size="lg" variant="outline" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />

      <FadeInView animValue={anims[0]} style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => step === 2 ? setStep(1) : router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          {step === 1 ? 'Receive Form' : 'Review & Confirm'}
        </Text>
        <View style={{ width: 44 }} />
      </FadeInView>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <FadeInView animValue={anims[1]} style={{ gap: 20 }}>
          
          {step === 1 ? (
            <>
              {/* Customer */}
              <View style={styles.section}>
                <SectionHeader title="Customer Details" />
                <Input label="Name *" value={customerName} onChangeText={setCustomerName} placeholder="Full name" leftIcon="user" error={errors.customerName} />
                <Input label="Mobile *" value={mobile} onChangeText={setMobile} placeholder="10-digit number" keyboardType="phone-pad" leftIcon="phone" error={errors.mobile} />
                <Input label="Alternate Mobile" value={alternateMobile} onChangeText={setAlternateMobile} placeholder="Optional" keyboardType="phone-pad" leftIcon="phone" />
                <Input label="Email" value={email} onChangeText={setEmail} placeholder="Optional" keyboardType="email-address" leftIcon="mail" autoCapitalize="none" />
                <Input label="Address" value={address} onChangeText={setAddress} placeholder="Optional" leftIcon="map-pin" />
              </View>

              {/* Device */}
              <View style={styles.section}>
                <SectionHeader title="Device Details" />
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowDeviceType(v => !v)}
                  style={[styles.sectionToggle, { backgroundColor: colors.card, borderColor: showDeviceType ? colors.primary : colors.border }]}
                >
                  <View style={[styles.checkbox, { backgroundColor: deviceType ? colors.primary : 'transparent', borderColor: deviceType ? colors.primary : colors.muted }]}>
                    {!!deviceType && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  <Text style={[styles.sectionToggleLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Device Type *</Text>
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

                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowBrand(v => !v)}
                  style={[styles.sectionToggle, { backgroundColor: colors.card, borderColor: errors.brand ? colors.destructive : showBrand ? colors.primary : colors.border }]}
                >
                  <View style={[styles.checkbox, { backgroundColor: brand ? colors.primary : 'transparent', borderColor: brand ? colors.primary : colors.muted }]}>
                    {!!brand && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  <Text style={[styles.sectionToggleLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Brand *</Text>
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
                <Input label="Model *" value={model} onChangeText={setModel} placeholder="Enter your model" leftIcon="smartphone" error={errors.model} />
                
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Input label="IMEI 1" value={imei} onChangeText={setImei} placeholder="Optional" keyboardType="number-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input label="IMEI 2" value={imei2} onChangeText={setImei2} placeholder="Optional" keyboardType="number-pad" />
                  </View>
                </View>
                <Input label="Serial Number" value={serialNumber} onChangeText={setSerialNumber} placeholder="Optional" />
                
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><Input label="Color" value={colorAttr} onChangeText={setColorAttr} placeholder="Optional" /></View>
                  <View style={{ flex: 1 }}><Input label="Storage" value={storage} onChangeText={setStorage} placeholder="e.g. 128GB" /></View>
                  <View style={{ flex: 1 }}><Input label="RAM" value={ram} onChangeText={setRam} placeholder="e.g. 8GB" /></View>
                </View>

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
              <View style={styles.section}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowAccessories(v => !v)}
                  style={[styles.sectionToggle, { backgroundColor: colors.card, borderColor: showAccessories ? colors.primary : colors.border }]}
                >
                  <View style={[styles.checkbox, { backgroundColor: showAccessories ? colors.primary : 'transparent', borderColor: showAccessories ? colors.primary : colors.muted }]}>
                    {showAccessories && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  <Text style={[styles.sectionToggleLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Accessories Received</Text>
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

              {/* Physical Condition */}
              <View style={styles.section}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowPhysical(v => !v)}
                  style={[styles.sectionToggle, { backgroundColor: colors.card, borderColor: showPhysical ? colors.primary : colors.border }]}
                >
                  <View style={[styles.checkbox, { backgroundColor: showPhysical ? colors.primary : 'transparent', borderColor: showPhysical ? colors.primary : colors.muted }]}>
                    {showPhysical && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  <Text style={[styles.sectionToggleLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Physical Condition</Text>
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

              {/* Checklist */}
              <View style={styles.section}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowChecklist(v => !v)}
                  style={[styles.sectionToggle, { backgroundColor: colors.card, borderColor: showChecklist ? colors.primary : colors.border }]}
                >
                  <View style={[styles.checkbox, { backgroundColor: showChecklist ? colors.primary : 'transparent', borderColor: showChecklist ? colors.primary : colors.muted }]}>
                    {showChecklist && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  <Text style={[styles.sectionToggleLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Pre-Repair Checklist (Functions)</Text>
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
                <Input label="Estimated Charge (₹)" value={repairCharge} onChangeText={setRepairCharge} placeholder="0" keyboardType="decimal-pad" leftText="₹" />
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

              {/* Signature */}
              <View style={styles.section}>
                <SectionHeader title="Customer Authorization" />
                {receivingSignatureUri ? (
                  <View style={[styles.sigPreviewWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
                    <Image source={{ uri: receivingSignatureUri }} style={styles.sigPreview} resizeMode="contain" />
                    <TouchableOpacity style={[styles.sigClear, { backgroundColor: colors.destructive }]} onPress={() => setReceivingSignatureUri(null)}>
                      <Feather name="x" size={16} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setShowSignature(true)} style={[styles.sigBtn, { borderColor: colors.primary, backgroundColor: colors.primary + '11' }]}>
                    <Feather name="edit-3" size={20} color={colors.primary} />
                    <Text style={[styles.sigBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Capture Signature</Text>
                  </TouchableOpacity>
                )}
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
      </ScrollView>

      {/* Signature Modal */}
      <Modal visible={showSignature} animationType="slide" transparent>
        <View style={[styles.modalOverlay, { backgroundColor: colors.background }]}>
          <View style={[styles.sigScreen, { paddingTop: topPad + 8 }]}>
            <View style={styles.sigHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Customer Signature</Text>
                <Text style={[styles.sigSubtitle, { color: colors.mutedForeground }]}>Ask the customer to sign in the box below</Text>
              </View>
              <TouchableOpacity onPress={() => setShowSignature(false)} style={[styles.sigCloseBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="x" size={20} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            <View style={[styles.sigCard, { borderColor: colors.border }]}>
              <SignatureScreen
                ref={sigPadRef}
                onOK={handleSignatureOK}
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
              <View style={{ flex: 1 }}><Button title="Clear" variant="outline" onPress={() => sigPadRef.current?.clearSignature()} /></View>
              <View style={{ flex: 2 }}><Button title="Done" onPress={() => sigPadRef.current?.readSignature()} /></View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Photo Kind Modal */}
      <Modal visible={!!showPhotoKindModal} animationType="fade" transparent>
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
    paddingHorizontal: 16, paddingBottom: 14,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18 },
  scroll: { paddingHorizontal: 16, paddingTop: 10 },
  section: { gap: 12 },
  sectionHeader: { borderLeftWidth: 3, paddingLeft: 10, marginTop: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 16 },
  checklistGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sectionToggle: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  sectionToggleLabel: { fontSize: 14, flex: 1 },
  countBadge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countBadgeText: { fontSize: 11 },
  vListWrap: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  vList: { maxHeight: 280 },
  fieldError: { fontSize: 12, marginTop: -8 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  vItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  checklistItem: { width: '48%', flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, gap: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checklistLabel: { fontSize: 13, flex: 1 },
  photoScroll: { gap: 12, paddingVertical: 4 },
  addPhotoBtn: { width: 100, height: 100, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addPhotoText: { fontSize: 12 },
  photoThumbWrap: { width: 100, height: 100, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  photoThumb: { width: '100%', height: '100%' },
  photoBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 4, alignItems: 'center' },
  photoBadgeText: { color: '#FFF', fontSize: 9, fontWeight: 'bold' },
  photoRemove: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sigBtn: { padding: 16, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  sigBtnText: { fontSize: 15 },
  sigPreviewWrap: { height: 120, borderRadius: 12, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  sigPreview: { width: '100%', height: '100%' },
  sigClear: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1 },
  sigScreen: { flex: 1, paddingHorizontal: 20, paddingBottom: 24 },
  sigHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  sigSubtitle: { fontSize: 13, marginTop: 4 },
  sigCloseBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sigCard: { flex: 1, borderRadius: 16, borderWidth: 1, overflow: 'hidden', backgroundColor: '#FFF' },
  sigBaseline: { position: 'absolute', left: 24, right: 24, bottom: 20, borderTopWidth: 1, borderTopColor: '#D1D5DB', borderStyle: 'dashed', paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sigBaselineText: { fontSize: 12, color: '#9CA3AF' },
  sigFooterRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  modalTitle: { fontSize: 18 },
  overlayCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  kindModal: { width: '100%', padding: 20, borderRadius: 20 },
  kindTitle: { fontSize: 18, marginBottom: 16, textAlign: 'center' },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kindBtn: { width: '48%', padding: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  kindBtnText: { fontSize: 13 },
  successView: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  successIconWrap: { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  successTitle: { fontSize: 24, marginBottom: 8 },
  successSubtitle: { fontSize: 16, marginBottom: 30 },
  qrWrap: { padding: 20, backgroundColor: '#FFF', borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 4 },
  warningText: { flex: 1, fontSize: 13, lineHeight: 18 },
  summaryBox: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 8 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  summaryLabel: { fontSize: 13, flex: 1 },
  summaryValue: { fontSize: 14, flex: 2, textAlign: 'right', fontFamily: 'Inter_500Medium' },
  confirmationWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 12, borderWidth: 1 },
  confirmationText: { flex: 1, fontSize: 13, lineHeight: 20 },
});
