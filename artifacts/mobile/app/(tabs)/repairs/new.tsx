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
import SignatureScreen from 'react-native-signature-canvas';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

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
  DEVICE_TYPES,
  BRANDS,
  PRIORITIES,
  PRIORITY_LABELS,
} from '@/utils/helpers';
import { requestUploadUrl, repairPhotosAdd } from '@workspace/api-client-react';
import { fetch as expoFetch } from 'expo/fetch';
import { File as ExpoFile } from 'expo-file-system';

const CHECKLIST_ITEMS = [
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

  const [customerName, setCustomerName] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [deviceType, setDeviceType] = useState('Smartphone');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [imei, setImei] = useState('');
  const [problem, setProblem] = useState('');
  const [priority, setPriority] = useState('normal');
  const [repairCharge, setRepairCharge] = useState('');
  const [advance, setAdvance] = useState('');
  const [notes, setNotes] = useState('');
  const [warrantyDays, setWarrantyDays] = useState('0');
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  
  const [photos, setPhotos] = useState<{ uri: string, kind: string }[]>([]);
  const [receivingSignatureUri, setReceivingSignatureUri] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [showSignature, setShowSignature] = useState(false);
  const [showPhotoKindModal, setShowPhotoKindModal] = useState<string | null>(null); // holds URI until kind is selected

  const [createdRepair, setCreatedRepair] = useState<Repair | null>(null);
  const qrRef = useRef<any>(null);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!customerName.trim()) e.customerName = 'Required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = '10-digit mobile required';
    if (!brand.trim()) e.brand = 'Required';
    if (!model.trim()) e.model = 'Required';
    if (!problem.trim()) e.problem = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
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
    if (!validate()) {
      Alert.alert('Validation Error', 'Please check the required fields.');
      return;
    }
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      let customerId = customers.find((c) => c.mobile === mobile)?.id;
      if (!customerId) {
        const created = await addCustomer({
          name: customerName.trim(), mobile: mobile.trim(),
          address: address.trim() || undefined,
        });
        customerId = created.id;
      }

      const techId = user?.role === 'technician' ? user.id : undefined;
      const techName = user?.role === 'technician' ? user.name : undefined;

      const newRepair: Repair = {
        id: '', repairId: '', customerId,
        customerName: customerName.trim(), mobile: mobile.trim(),
        deviceType, brand: brand.trim(), model: model.trim(),
        imei: imei.trim() || undefined, problem: problem.trim(),
        technicianId: techId, technicianName: techName,
        status: 'received', priority: priority as Repair['priority'],
        repairCharge: parseFloat(repairCharge) || 0, partsCharge: 0,
        advance: parseFloat(advance) || 0, receiveDate: getTodayStr(),
        expectedDate: getNextWeekStr(), notes: notes.trim() || undefined,
        checklist, warrantyDays: parseInt(warrantyDays, 10) || 0,
        createdAt: new Date().toISOString(),
      };

      const repair = await addRepair(newRepair);

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
    } catch (err) {
      // The form state is untouched here, so the user can fix the issue
      // (e.g. reconnect) and tap Save again without re-typing anything.
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
                <p><strong>Device:</strong> ${createdRepair.brand} ${createdRepair.model}</p>
                <p><strong>Problem:</strong> ${createdRepair.problem}</p>
                <p><strong>Estimate:</strong> ₹${createdRepair.repairCharge}</p>
                <p><strong>Advance:</strong> ₹${createdRepair.advance}</p>
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
        // Web: printToFileAsync/Sharing are unsupported — open the browser
        // print dialog instead (user can "Save as PDF" from there).
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Device Intake</Text>
        <View style={{ width: 44 }} />
      </FadeInView>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <FadeInView animValue={anims[1]} style={{ gap: 20 }}>
          
          {/* Customer */}
          <View style={styles.section}>
            <SectionHeader title="Customer Details" />
            <Input label="Name *" value={customerName} onChangeText={setCustomerName} placeholder="Full name" leftIcon="user" error={errors.customerName} />
            <Input label="Mobile *" value={mobile} onChangeText={setMobile} placeholder="10-digit number" keyboardType="phone-pad" leftIcon="phone" error={errors.mobile} />
            <Input label="Address" value={address} onChangeText={setAddress} placeholder="Optional" leftIcon="map-pin" />
          </View>

          {/* Device */}
          <View style={styles.section}>
            <SectionHeader title="Device Details" />
            <SelectInput label="Device Type *" options={DEVICE_TYPES} value={deviceType} onChange={setDeviceType} />
            <SelectInput label="Brand *" options={BRANDS} value={brand} onChange={setBrand} error={errors.brand} />
            <Input label="Model *" value={model} onChangeText={setModel} placeholder="e.g. Galaxy S23" leftIcon="smartphone" error={errors.model} />
            <Input label="IMEI / Serial" value={imei} onChangeText={setImei} placeholder="Optional" leftIcon="hash" keyboardType="number-pad" />
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
            <SelectInput label="Priority" options={PRIORITIES} value={priority} onChange={setPriority} labelMap={PRIORITY_LABELS} />
            <SelectInput label="Warranty Offered" options={WARRANTY_OPTIONS.map(o => o.value)} value={warrantyDays} onChange={setWarrantyDays} labelMap={WARRANTY_OPTIONS.reduce((acc, curr) => ({...acc, [curr.value]: curr.label}), {})} />
          </View>

          {/* Checklist */}
          <View style={styles.section}>
            <SectionHeader title="Device Condition Checklist" />
            <View style={styles.checklistGrid}>
              {CHECKLIST_ITEMS.map((item) => {
                const checked = checklist[item.id] || false;
                return (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.7}
                    onPress={() => setChecklist(prev => ({ ...prev, [item.id]: !checked }))}
                    style={[styles.checklistItem, { backgroundColor: colors.card, borderColor: checked ? colors.primary : colors.border }]}
                  >
                    <View style={[styles.checkbox, { backgroundColor: checked ? colors.primary : 'transparent', borderColor: checked ? colors.primary : colors.muted }]}>
                      {checked && <Feather name="check" size={14} color="#FFF" />}
                    </View>
                    <Text style={[styles.checklistLabel, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]} numberOfLines={1}>{item.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Photos */}
          <View style={styles.section}>
            <SectionHeader title="Intake Photos" />
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

          {/* Financials */}
          <View style={styles.section}>
            <SectionHeader title="Estimate & Payment" />
            <Input label="Estimated Charge (₹)" value={repairCharge} onChangeText={setRepairCharge} placeholder="0" keyboardType="decimal-pad" leftIcon="dollar-sign" />
            <Input label="Advance Paid (₹)" value={advance} onChangeText={setAdvance} placeholder="0" keyboardType="decimal-pad" leftIcon="credit-card" />
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

          <Button
            title="Complete Intake"
            onPress={handleSubmit}
            loading={loading}
            fullWidth
            size="lg"
            style={{ marginTop: 10 }}
          />

        </FadeInView>
      </ScrollView>

      {/* Signature Modal */}
      <Modal visible={showSignature} animationType="slide" transparent>
        <View style={[styles.modalOverlay, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { paddingTop: topPad }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Customer Signature</Text>
            <TouchableOpacity onPress={() => setShowSignature(false)}>
              <Feather name="x" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <View style={styles.sigContainer}>
            <SignatureScreen
              onOK={handleSignatureOK}
              onEmpty={() => Alert.alert('Empty', 'Please provide a signature')}
              descriptionText="Sign above"
              clearText="Clear"
              confirmText="Save"
              webStyle={`.m-signature-pad {box-shadow: none; border: none; } 
                          .m-signature-pad--body {border: none;} 
                          .m-signature-pad--footer {margin: 0px;}`
                      }
            />
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
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#333' },
  modalTitle: { fontSize: 18 },
  sigContainer: { flex: 1, backgroundColor: '#FFF' },
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
});