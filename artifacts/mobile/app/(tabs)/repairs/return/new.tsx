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
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
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

        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.mutedForeground, ...font.body }}>Repair not found</Text>
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


      <FadeInView animValue={anims[0]} style={[styles.header, { paddingTop: topPad + layout.rowPaddingVertical }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          New Return Intake
        </Text>
        <View style={{ width: 44 }} />
      </FadeInView>

      <KeyboardAwareScrollViewCompat showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: size.tabBar + space.xxl }]} bottomOffset={space.xxl}>

        <FadeInView animValue={anims[1]}>
          <Card>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              ORIGINAL REPAIR
            </Text>
            <Text style={{ ...font.bodyStrong, color: colors.foreground, marginTop: space.sm }}>
              {repair.repairId} • {repair.customerName}
            </Text>
            <Text style={{ ...font.body, color: colors.mutedForeground, marginTop: space.xs }}>
              {repair.brand} {repair.model}
            </Text>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
              <Text style={{ ...font.caption, color: colors.mutedForeground }}>
                Charges: {formatCurrency(repair.repairCharge + repair.partsCharge)}
              </Text>
            </View>
          </Card>
        </FadeInView>

        <FadeInView animValue={anims[2]} style={{ gap: space.lg, marginTop: space.md }}>
          <View>
            <Text style={[styles.label, { color: colors.foreground }]}>Return Reason</Text>
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
                        backgroundColor: active ? colors.primary : colors.secondary,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={{
                      ...font.label,
                      color: active ? colors.primaryForeground : colors.foreground,
                    }}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View>
            <Text style={[styles.label, { color: colors.foreground }]}>Customer Complaint *</Text>
            <TextInput
              value={complaint}
              onChangeText={setComplaint}
              placeholder="What is the issue?"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, styles.textArea, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground }]}
              multiline
              numberOfLines={3}
            />
          </View>

          <View>
            <Text style={[styles.label, { color: colors.foreground }]}>Device Condition on Return</Text>
            <TextInput
              value={deviceCondition}
              onChangeText={setDeviceCondition}
              placeholder="Scratches, physical damage, power on/off?"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, styles.textArea, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground }]}
              multiline
              numberOfLines={3}
            />
          </View>

          <Button title="Create Return Case" onPress={handleSubmit} loading={saving} style={{ marginTop: space.md }} />
        </FadeInView>

      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingBottom: space.md },
  backBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  scroll: { padding: layout.screenPadding },
  sectionTitle: { ...font.overline },
  label: { ...font.label, marginBottom: space.sm, marginLeft: space.xs },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  reasonChip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.md, ...font.input },
  textArea: { height: 90, textAlignVertical: 'top' },
});