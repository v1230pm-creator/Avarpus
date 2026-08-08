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
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import SignatureScreen from 'react-native-signature-canvas';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { RepairStatusBadge, PriorityBadge, SampleBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ScreenGlow, FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { RepairStatus } from '@/types';
import { formatDate, formatCurrency, REPAIR_STATUS_LABELS } from '@/utils/helpers';
import { storage, KEYS } from '@/utils/storage';
import { useRepairPhotosList, getRepairPhotosListQueryKey, useRepairEventsList, getRepairEventsListQueryKey, requestUploadUrl, repairPhotosAdd, useReturnsList, getReturnsListQueryKey } from '@workspace/api-client-react';
import { fetch as expoFetch } from 'expo/fetch';
import { File as ExpoFile } from 'expo-file-system';

const STATUS_FLOW: RepairStatus[] = ['received', 'diagnosing', 'waiting_parts', 'repairing', 'testing', 'ready', 'delivered'];

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

function InfoRow({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: color ?? colors.foreground, fontFamily: bold ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>{value}</Text>
    </View>
  );
}

export default function RepairDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { repairs, updateRepair } = useData();
  const { user, canAccess } = useAuth();
  
  const [updating, setUpdating] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [showDeliverySig, setShowDeliverySig] = useState(false);
  
  const qrRef = useRef<any>(null);

  useEffect(() => {
    storage.get<string>(KEYS.AUTH_TOKEN).then(setToken);
  }, []);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const anims = useStaggerAnim(8);

  const repair = useMemo(() => repairs.find((r) => r.id === id), [repairs, id]);

  const { data: photosData } = useRepairPhotosList(id as string, { query: { enabled: !!id, queryKey: getRepairPhotosListQueryKey(id as string) } });
  const { data: eventsData } = useRepairEventsList(id as string, { query: { enabled: !!id, queryKey: getRepairEventsListQueryKey(id as string) } });
  const { data: returnsData } = useReturnsList({ query: { queryKey: getReturnsListQueryKey() } });
  const repairReturns = useMemo(() => returnsData?.returns?.filter(r => r.repairId === id) || [], [returnsData, id]);

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
  const currentIdx = STATUS_FLOW.indexOf(repair.status as RepairStatus);
  const nextStatus = currentIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIdx + 1] : null;
  const canUpdateStatus = canAccess('repairs_update') || (canAccess('repairs') && user?.role !== 'reception');

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
      if (repair.warrantyDays && repair.warrantyDays > 0) {
        const exp = new Date();
        exp.setDate(exp.getDate() + repair.warrantyDays);
        warrantyExpiry = exp.toISOString().split('T')[0];
      }

      await updateRepair({
        ...repair,
        status: 'delivered',
        deliveryDate,
        warrantyExpiry,
        deliverySignaturePath: sigPath,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert(
        'Update failed',
        err instanceof Error ? err.message : "Couldn't mark the repair as delivered. Please try again.",
      );
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

  const handleStatusUpdate = async (newStatus: RepairStatus) => {
    if (newStatus === 'delivered') {
      setShowDeliverySig(true);
      return;
    }
    if (updating) return;
    setUpdating(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await updateRepair({
        ...repair,
        status: newStatus,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(
        'Update failed',
        e instanceof Error ? e.message : "Couldn't update the repair status. Please try again.",
      );
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

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}>
        
        {/* PDF Button */}
        <FadeInView animValue={anims[1]}>
          <TouchableOpacity onPress={generatePDF} style={[styles.pdfBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '33' }]}>
            <Feather name="file-text" size={18} color={colors.primary} />
            <Text style={[styles.pdfBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Download Job Card PDF</Text>
          </TouchableOpacity>
        </FadeInView>

        {/* Actions */}
        {((canUpdateStatus && repair.status !== 'delivered' && repair.status !== 'cancelled') || repair.status === 'delivered') && (
          <FadeInView animValue={anims[2]}>
          <Card style={styles.statusCard}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>ACTIONS</Text>
            {canUpdateStatus && (repair.status as string) !== 'delivered' && (repair.status as string) !== 'cancelled' && nextStatus && (
              <TouchableOpacity
                onPress={() => handleStatusUpdate(nextStatus)}
                disabled={updating}
                style={[styles.nextStatusBtn, { backgroundColor: colors.success, borderRadius: colors.radius - 2 }]}
              >
                <Feather name="arrow-right-circle" size={18} color="#FFFFFF" />
                <Text style={[styles.nextStatusText, { fontFamily: 'Inter_600SemiBold' }]}>
                  {nextStatus === 'delivered' ? 'Mark as Delivered' : `Move to: ${REPAIR_STATUS_LABELS[nextStatus]}`}
                </Text>
              </TouchableOpacity>
            )}
            {canUpdateStatus && (repair.status as string) !== 'delivered' && (repair.status as string) !== 'cancelled' && (
              <TouchableOpacity onPress={() => handleStatusUpdate('cancelled')} style={[styles.cancelBtn, { borderColor: colors.destructive }]}>
                <Text style={[styles.cancelBtnText, { color: colors.destructive, fontFamily: 'Inter_500Medium' }]}>Cancel Repair</Text>
              </TouchableOpacity>
            )}
            {repair.status === 'delivered' && (
              <TouchableOpacity onPress={() => router.push(`/(tabs)/repairs/return/new?repairId=${repair.id}` as any)} style={[styles.nextStatusBtn, { backgroundColor: colors.warning, borderRadius: colors.radius - 2 }]}>
                <Feather name="corner-up-left" size={18} color="#FFFFFF" />
                <Text style={[styles.nextStatusText, { fontFamily: 'Inter_600SemiBold' }]}>Return / Rework</Text>
              </TouchableOpacity>
            )}
          </Card>
          </FadeInView>
        )}

        {/* Returns */}
        {repairReturns.length > 0 && (
          <FadeInView animValue={anims[3]}>
            <Card style={{ gap: 10 }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>RETURN CASES</Text>
              {repairReturns.map(ret => (
                <TouchableOpacity
                  key={ret.id}
                  onPress={() => router.push(`/(tabs)/repairs/return/${ret.id}` as any)}
                  style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <View>
                    <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{ret.returnId}</Text>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 }}>{formatDate(ret.createdAt)}</Text>
                  </View>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.warning + '22' }}>
                    <Text style={{ fontSize: 11, color: colors.warning, fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' }}>
                      {ret.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </Card>
          </FadeInView>
        )}

        {/* Priority & Dates */}
        <FadeInView animValue={anims[3]}>
        <Card>
          <View style={styles.priorityRow}>
            <PriorityBadge priority={repair.priority} />
            <Text style={[styles.dateSmall, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Received: {formatDate(repair.receiveDate)}
            </Text>
            <Text style={[styles.dateSmall, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Expected: {formatDate(repair.expectedDate)}
            </Text>
          </View>
        </Card>
        </FadeInView>

        {/* Device & Checklist */}
        <FadeInView animValue={anims[4]}>
        <Card>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>DEVICE DETAILS</Text>
          <InfoRow label="Brand & Model" value={`${repair.brand} ${repair.model}`} bold />
          {repair.imei && <InfoRow label="IMEI" value={repair.imei} />}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          
          <Text style={[styles.problemTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Problem</Text>
          <Text style={[styles.problemText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{repair.problem}</Text>
          
          {repair.checklist && Object.keys(repair.checklist).length > 0 && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Text style={[styles.problemTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 8 }]}>Condition Checklist</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {Object.keys(repair.checklist).map(k => (
                  <View key={k} style={[styles.checkBadge, { backgroundColor: repair.checklist![k] ? colors.success + '15' : colors.destructive + '15' }]}>
                    <Feather name={repair.checklist![k] ? "check" : "x"} size={12} color={repair.checklist![k] ? colors.success : colors.destructive} />
                    <Text style={{ fontSize: 11, color: repair.checklist![k] ? colors.success : colors.destructive, fontFamily: 'Inter_500Medium' }}>
                      {CHECKLIST_ITEMS.find(c => c.id === k)?.label || k}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </Card>
        </FadeInView>

        {/* Photos Gallery */}
        {photosData?.photos && photosData.photos.length > 0 && (
          <FadeInView animValue={anims[5]}>
            <Card>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>PHOTOS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 8 }}>
                {photosData.photos.map(p => (
                  <View key={p.id} style={[styles.galleryThumb, { borderColor: colors.border }]}>
                     <Image 
                        source={{ uri: getAbsoluteUrl(p.objectPath), headers: { Authorization: `Bearer ${token}` } }}
                        style={styles.galleryImg} 
                     />
                     <View style={[styles.galleryBadge, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
                       <Text style={styles.galleryBadgeText}>{p.kind}</Text>
                     </View>
                  </View>
                ))}
              </ScrollView>
            </Card>
          </FadeInView>
        )}

        {/* Financials & Warranty */}
        {canAccess('finance') || user?.role === 'reception' || user?.role === 'dealer' ? (
          <FadeInView animValue={anims[6]}>
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>FINANCIALS & WARRANTY</Text>
            <InfoRow label="Repair Charge" value={formatCurrency(repair.repairCharge)} />
            <InfoRow label="Parts Charge" value={formatCurrency(repair.partsCharge)} />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <InfoRow label="Total Charge" value={formatCurrency(repair.repairCharge + repair.partsCharge)} bold />
            <InfoRow label="Advance Paid" value={formatCurrency(repair.advance)} color={colors.success} />
            <InfoRow label="Balance Due" value={formatCurrency(balance)} color={balance > 0 ? colors.warning : colors.success} bold />
            
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <InfoRow label="Warranty Offered" value={`${repair.warrantyDays} Days`} />
            {repair.warrantyExpiry && (
              <InfoRow label="Warranty Expiry" value={formatDate(repair.warrantyExpiry)} />
            )}
          </Card>
          </FadeInView>
        ) : (
          <FadeInView animValue={anims[6]}>
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>WARRANTY</Text>
            <InfoRow label="Warranty Offered" value={`${repair.warrantyDays} Days`} />
            {repair.warrantyExpiry && (
              <InfoRow label="Warranty Expiry" value={formatDate(repair.warrantyExpiry)} />
            )}
          </Card>
          </FadeInView>
        )}

        {/* Signatures */}
        {(repair.receivingSignaturePath || repair.deliverySignaturePath) && (
          <FadeInView animValue={anims[7]}>
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

        {/* Timeline */}
        {eventsData?.events && eventsData.events.length > 0 && (
          <FadeInView animValue={anims[7]}>
            <Card>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 12 }]}>ACTIVITY TIMELINE</Text>
              {eventsData.events.map((ev, i) => (
                <View key={ev.id} style={{ flexDirection: 'row', gap: 12, marginBottom: i === eventsData.events.length - 1 ? 0 : 16 }}>
                  <View style={{ alignItems: 'center' }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 4 }} />
                    {i !== eventsData.events.length - 1 && <View style={{ width: 2, flex: 1, backgroundColor: colors.border, marginTop: 4, marginBottom: -4 }} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_500Medium' }}>
                      {ev.action}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                      {ev.userName} ({ev.userRole}) • {new Date(ev.createdAt).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          </FadeInView>
        )}

      </ScrollView>

      {/* Delivery Signature Modal */}
      <Modal visible={showDeliverySig} animationType="slide" transparent>
        <View style={[styles.modalOverlay, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { paddingTop: topPad }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Customer Delivery Signature</Text>
            <TouchableOpacity onPress={() => setShowDeliverySig(false)}>
              <Feather name="x" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <View style={styles.sigContainer}>
            <SignatureScreen
              onOK={handleDeliverySigOK}
              onEmpty={() => Alert.alert('Empty', 'Please provide a signature')}
              descriptionText="Sign above to confirm receipt"
              clearText="Clear"
              confirmText="Complete Delivery"
              webStyle={`.m-signature-pad {box-shadow: none; border: none; } 
                          .m-signature-pad--body {border: none;} 
                          .m-signature-pad--footer {margin: 0px;}`
                      }
            />
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
  cancelBtn: { alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  cancelBtnText: { fontSize: 14 },
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
  modalOverlay: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#333' },
  modalTitle: { fontSize: 18 },
  sigContainer: { flex: 1, backgroundColor: '#FFF' },
});
