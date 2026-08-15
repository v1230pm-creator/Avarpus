import React, { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ScreenGlow, FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { formatCurrency, getTodayStr } from '@/utils/helpers';
import { returnsCreate } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

const RETURN_REASONS = [
  { id: 'same_problem', label: 'Same Problem Reoccurred' },
  { id: 'stopped_working', label: 'Stopped Working Entirely' },
  { id: 'repair_failed', label: 'Original Repair Failed' },
  { id: 'new_problem', label: 'New Problem Found' },
  { id: 'complaint', label: 'Customer Complaint' },
  { id: 'warranty_rework', label: 'Warranty Rework' },
  { id: 'refund_requested', label: 'Refund Requested' },
  { id: 'other', label: 'Other' },
];

export default function NewReturnScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { repairId } = useLocalSearchParams<{ repairId: string }>();
  const { repairs } = useData();
  const queryClient = useQueryClient();

  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState(RETURN_REASONS[0].id);
  const [complaint, setComplaint] = useState('');
  const [deviceCondition, setDeviceCondition] = useState('');

  const anims = useStaggerAnim(3);
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const repair = useMemo(() => repairs.find((r) => r.id === repairId), [repairs, repairId]);

  if (!repair) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <ScreenGlow />
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.mutedForeground }}>Repair not found</Text>
        </View>
      </View>
    );
  }

  const handleSubmit = async () => {
    if (!complaint.trim()) {
      Alert.alert('Missing Info', 'Please enter the customer complaint.');
      return;
    }
    setSaving(true);
    try {
      const res = await returnsCreate(repair.id, {
        reason,
        complaint: complaint.trim(),
        deviceCondition: deviceCondition.trim(),
        returnDate: getTodayStr(),
      });
      queryClient.invalidateQueries();
      router.replace(`/(tabs)/repairs/return/${res.return.id}`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create return case');
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />

      <FadeInView animValue={anims[0]} style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          New Return Intake
        </Text>
        <View style={{ width: 44 }} />
      </FadeInView>

      <KeyboardAwareScrollViewCompat showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]} bottomOffset={24}>
        
        <FadeInView animValue={anims[1]}>
          <Card>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
              ORIGINAL REPAIR
            </Text>
            <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginTop: 8 }}>
              {repair.repairId} • {repair.customerName}
            </Text>
            <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 4 }}>
              {repair.brand} {repair.model}
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
                Charges: {formatCurrency(repair.repairCharge + repair.partsCharge)}
              </Text>
            </View>
          </Card>
        </FadeInView>

        <FadeInView animValue={anims[2]} style={{ gap: 16, marginTop: 12 }}>
          <View>
            <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Return Reason</Text>
            <View style={styles.reasonGrid}>
              {RETURN_REASONS.map((r) => {
                const active = reason === r.id;
                return (
                  <TouchableOpacity
                    key={r.id}
                    onPress={() => setReason(r.id)}
                    style={[
                      styles.reasonChip,
                      {
                        backgroundColor: active ? colors.primary : colors.card,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={{
                      fontSize: 13,
                      fontFamily: active ? 'Inter_600SemiBold' : 'Inter_400Regular',
                      color: active ? '#FFF' : colors.foreground,
                    }}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View>
            <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Customer Complaint *</Text>
            <TextInput
              value={complaint}
              onChangeText={setComplaint}
              placeholder="What is the issue?"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, styles.textArea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
              multiline
              numberOfLines={3}
            />
          </View>

          <View>
            <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Device Condition on Return</Text>
            <TextInput
              value={deviceCondition}
              onChangeText={setDeviceCondition}
              placeholder="Scratches, physical damage, power on/off?"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, styles.textArea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
              multiline
              numberOfLines={3}
            />
          </View>

          <Button title="Create Return Case" onPress={handleSubmit} loading={saving} style={{ marginTop: 12 }} />
        </FadeInView>

      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18 },
  scroll: { padding: 16 },
  sectionTitle: { fontSize: 11, letterSpacing: 1 },
  label: { fontSize: 14, marginBottom: 8, marginLeft: 4 },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15 },
  textArea: { height: 100, textAlignVertical: 'top' },
});