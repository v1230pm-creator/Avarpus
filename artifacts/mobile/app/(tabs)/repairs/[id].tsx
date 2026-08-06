import React, { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { RepairStatusBadge, PriorityBadge, Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { RepairStatus } from '@/types';
import { formatDate, formatCurrency, REPAIR_STATUS_LABELS } from '@/utils/helpers';

const STATUS_FLOW: RepairStatus[] = ['received', 'diagnosing', 'waiting_parts', 'repairing', 'testing', 'ready', 'delivered'];

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const colors = useColors();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: color ?? colors.foreground, fontFamily: 'Inter_500Medium' }]}>{value}</Text>
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

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const repair = useMemo(() => repairs.find((r) => r.id === id), [repairs, id]);

  if (!repair) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
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

  const handleStatusUpdate = async (newStatus: RepairStatus) => {
    if (updating) return;
    setUpdating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = {
      ...repair,
      status: newStatus,
      deliveryDate: newStatus === 'delivered' ? new Date().toISOString().split('T')[0] : repair.deliveryDate,
    };
    await updateRepair(updated);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setUpdating(false);
  };

  const handleCancel = () => {
    Alert.alert('Cancel Repair', 'Are you sure you want to cancel this repair job?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: () => handleStatusUpdate('cancelled'),
      },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 14, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.repairId, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{repair.repairId}</Text>
          <RepairStatusBadge status={repair.status} />
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}>
        {/* Status Update */}
        {canUpdateStatus && repair.status !== 'delivered' && repair.status !== 'cancelled' && (
          <Card style={styles.statusCard}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>UPDATE STATUS</Text>
            {nextStatus && (
              <TouchableOpacity
                onPress={() => handleStatusUpdate(nextStatus)}
                disabled={updating}
                style={[styles.nextStatusBtn, { backgroundColor: colors.success, borderRadius: colors.radius - 2 }]}
              >
                <Feather name="arrow-right-circle" size={18} color="#FFFFFF" />
                <Text style={[styles.nextStatusText, { fontFamily: 'Inter_600SemiBold' }]}>
                  Move to: {REPAIR_STATUS_LABELS[nextStatus]}
                </Text>
              </TouchableOpacity>
            )}
            {repair.status !== 'cancelled' && (
              <TouchableOpacity
                onPress={handleCancel}
                style={[styles.cancelBtn, { borderColor: colors.destructive }]}
              >
                <Text style={[styles.cancelBtnText, { color: colors.destructive, fontFamily: 'Inter_500Medium' }]}>
                  Cancel Repair
                </Text>
              </TouchableOpacity>
            )}
          </Card>
        )}

        {/* Priority */}
        <Card style={styles.priorityCard}>
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

        {/* Customer */}
        <Card>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>CUSTOMER</Text>
          <InfoRow label="Name" value={repair.customerName} />
          <InfoRow label="Mobile" value={repair.mobile} />
          <View style={styles.divider} />
          <TouchableOpacity
            onPress={() => {}}
            style={[styles.viewCustomerBtn, { backgroundColor: colors.secondary }]}
          >
            <Text style={[styles.viewCustomerText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
              View Customer Profile
            </Text>
          </TouchableOpacity>
        </Card>

        {/* Device */}
        <Card>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>DEVICE</Text>
          <InfoRow label="Type" value={repair.deviceType} />
          <InfoRow label="Brand" value={repair.brand} />
          <InfoRow label="Model" value={repair.model} />
          {repair.imei && <InfoRow label="IMEI" value={repair.imei} />}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.problemTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Problem</Text>
          <Text style={[styles.problemText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{repair.problem}</Text>
          {repair.notes && (
            <>
              <Text style={[styles.problemTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Notes</Text>
              <Text style={[styles.problemText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{repair.notes}</Text>
            </>
          )}
        </Card>

        {/* Technician */}
        <Card>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>TECHNICIAN</Text>
          <InfoRow label="Assigned To" value={repair.technicianName ?? 'Not assigned'} />
        </Card>

        {/* Financials */}
        {canAccess('finance') || user?.role === 'reception' || user?.role === 'dealer' ? (
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>FINANCIALS</Text>
            <InfoRow label="Repair Charge" value={formatCurrency(repair.repairCharge)} />
            <InfoRow label="Parts Charge" value={formatCurrency(repair.partsCharge)} />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <InfoRow label="Total Charge" value={formatCurrency(repair.repairCharge + repair.partsCharge)} />
            <InfoRow label="Advance Paid" value={formatCurrency(repair.advance)} color={colors.success} />
            <InfoRow
              label="Balance Due"
              value={formatCurrency(balance)}
              color={balance > 0 ? colors.warning : colors.success}
            />
          </Card>
        ) : null}

        {/* Delivery */}
        {repair.deliveryDate && (
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>DELIVERY</Text>
            <InfoRow label="Delivered On" value={formatDate(repair.deliveryDate)} color={colors.success} />
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1,
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
  cancelBtn: { alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1 },
  cancelBtnText: { fontSize: 14 },
  priorityCard: { flexDirection: 'row' },
  priorityRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  dateSmall: { fontSize: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 14, textAlign: 'right', flex: 1, marginLeft: 16 },
  divider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 8 },
  problemTitle: { fontSize: 13, marginTop: 4 },
  problemText: { fontSize: 13, lineHeight: 20, marginTop: 4 },
  viewCustomerBtn: { padding: 12, borderRadius: 10, alignItems: 'center' },
  viewCustomerText: { fontSize: 14 },
});
