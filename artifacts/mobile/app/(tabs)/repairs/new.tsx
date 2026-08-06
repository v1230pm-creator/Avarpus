import React, { useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SelectInput } from '@/components/ui/SelectInput';
import { Repair } from '@/types';
import {
  generateId,
  generateRepairId,
  getTodayStr,
  getNextWeekStr,
  DEVICE_TYPES,
  BRANDS,
  PRIORITIES,
  PRIORITY_LABELS,
} from '@/utils/helpers';

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
  const { addRepair, addCustomer, repairs, customers } = useData();
  const { user } = useAuth();

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
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!customerName.trim()) e.customerName = 'Customer name is required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = 'Valid 10-digit mobile required';
    if (!brand.trim()) e.brand = 'Brand is required';
    if (!model.trim()) e.model = 'Model is required';
    if (!problem.trim()) e.problem = 'Problem description is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Check if customer exists or create new one
      let customerId = customers.find((c) => c.mobile === mobile)?.id;
      if (!customerId) {
        customerId = `c${Date.now()}`;
        await addCustomer({
          id: customerId,
          name: customerName.trim(),
          mobile: mobile.trim(),
          address: address.trim() || undefined,
          dueAmount: 0,
          totalRepairs: 1,
          createdAt: getTodayStr(),
        });
      }

      const repairId = generateRepairId(repairs.length);
      const techId = user?.role === 'technician' ? user.id : undefined;
      const techName = user?.role === 'technician' ? user.name : undefined;

      const newRepair: Repair = {
        id: generateId(),
        repairId,
        customerId,
        customerName: customerName.trim(),
        mobile: mobile.trim(),
        deviceType,
        brand: brand.trim(),
        model: model.trim(),
        imei: imei.trim() || undefined,
        problem: problem.trim(),
        technicianId: techId,
        technicianName: techName,
        status: 'received',
        priority: priority as Repair['priority'],
        repairCharge: parseFloat(repairCharge) || 0,
        partsCharge: 0,
        advance: parseFloat(advance) || 0,
        receiveDate: getTodayStr(),
        expectedDate: getNextWeekStr(),
        notes: notes.trim() || undefined,
        createdAt: new Date().toISOString(),
      };

      await addRepair(newRepair);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 14, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>New Repair Job</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader title="Customer Information" />
        <Input label="Customer Name *" value={customerName} onChangeText={setCustomerName} placeholder="Full name" leftIcon="user" error={errors.customerName} />
        <Input label="Mobile Number *" value={mobile} onChangeText={setMobile} placeholder="10-digit number" keyboardType="phone-pad" leftIcon="phone" error={errors.mobile} />
        <Input label="Address (Optional)" value={address} onChangeText={setAddress} placeholder="Customer address" leftIcon="map-pin" />

        <SectionHeader title="Device Information" />
        <SelectInput label="Device Type *" options={DEVICE_TYPES} value={deviceType} onChange={setDeviceType} />
        <SelectInput label="Brand *" options={BRANDS} value={brand} onChange={setBrand} error={errors.brand} />
        <Input label="Model *" value={model} onChangeText={setModel} placeholder="e.g. Galaxy S23, iPhone 14" leftIcon="smartphone" error={errors.model} />
        <Input label="IMEI / Serial (Optional)" value={imei} onChangeText={setImei} placeholder="Device IMEI or serial number" leftIcon="hash" keyboardType="number-pad" />

        <SectionHeader title="Problem & Service" />
        <Input
          label="Problem Description *"
          value={problem}
          onChangeText={setProblem}
          placeholder="Describe the issue in detail..."
          multiline
          numberOfLines={3}
          style={{ height: 90, textAlignVertical: 'top', paddingTop: 12 } as any}
          error={errors.problem}
        />
        <SelectInput
          label="Repair Priority"
          options={PRIORITIES}
          value={priority}
          onChange={setPriority}
          labelMap={PRIORITY_LABELS}
        />
        <Input label="Notes (Optional)" value={notes} onChangeText={setNotes} placeholder="Internal notes..." leftIcon="file-text" />

        <SectionHeader title="Financials" />
        <Input label="Estimated Repair Charge (₹)" value={repairCharge} onChangeText={setRepairCharge} placeholder="0" keyboardType="decimal-pad" leftIcon="dollar-sign" />
        <Input label="Advance Received (₹)" value={advance} onChangeText={setAdvance} placeholder="0" keyboardType="decimal-pad" leftIcon="credit-card" />

        <View style={[styles.infoBox, { backgroundColor: colors.infoLight, borderColor: colors.info + '44' }]}>
          <Feather name="info" size={15} color={colors.info} />
          <Text style={[styles.infoText, { color: colors.info, fontFamily: 'Inter_400Regular' }]}>
            A repair job ID will be auto-generated on submission (e.g. {generateRepairId(repairs.length)})
          </Text>
        </View>

        <Button
          title="Create Repair Job"
          onPress={handleSubmit}
          loading={loading}
          fullWidth
          size="lg"
          style={{ marginTop: 8 }}
        />
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
  headerTitle: { fontSize: 18 },
  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 16 },
  sectionHeader: { borderLeftWidth: 3, paddingLeft: 10, marginTop: 8, marginBottom: -4 },
  sectionTitle: { fontSize: 15 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  infoText: { fontSize: 12, flex: 1, lineHeight: 18 },
});
