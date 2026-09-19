import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { dealersLookup, dealerTransactionsCreate, getDealerTransactionsListQueryKey } from '@workspace/api-client-react';
import type { DealersLookup200 } from '@workspace/api-client-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';

type Match = NonNullable<DealersLookup200['match']>;

// Step 1: resolve the OTHER shop by its owner's registered mobile — the only
// identity a dealer never has to type by hand. Step 2: describe the device.
// Submitting creates a real repair row directly in the receiving shop's own
// pipeline (tagged with this shop as the source).
export default function SendDeviceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const [mobile, setMobile] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [match, setMatch] = useState<Match | null>(null);

  const [deviceType, setDeviceType] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [imei, setImei] = useState('');
  const [problem, setProblem] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const anims = useStaggerAnim(3);

  const runLookup = async () => {
    setLookupError('');
    if (!/^\d{10}$/.test(mobile.trim())) {
      setLookupError('Enter a valid 10-digit mobile number');
      return;
    }
    setLooking(true);
    try {
      const res = await dealersLookup({ mobile: mobile.trim() });
      if (!res.match) {
        setLookupError('No registered shop found with that mobile number');
        setMatch(null);
        return;
      }
      setMatch(res.match);
    } catch (err: any) {
      setLookupError(err?.data?.message ?? 'Could not look up that shop. Please try again.');
    } finally {
      setLooking(false);
    }
  };

  const handleSubmit = async () => {
    const e: Record<string, string> = {};
    if (!deviceType.trim()) e.deviceType = 'Device type is required';
    if (!brand.trim()) e.brand = 'Brand is required';
    if (!model.trim()) e.model = 'Model is required';
    if (!problem.trim()) e.problem = 'Describe the issue';
    setErrors(e);
    if (Object.keys(e).length > 0 || !match) return;

    setLoading(true);
    try {
      const expectedDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      const res = await dealerTransactionsCreate({
        receiverShopId: match.shopId,
        deviceType: deviceType.trim(),
        brand: brand.trim(),
        model: model.trim(),
        imei: imei.trim() || undefined,
        problem: problem.trim(),
        expectedDate,
        notes: notes.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: getDealerTransactionsListQueryKey() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/(tabs)/repairs/dealer-transactions/${res.repair.id}` as any);
    } catch (err: any) {
      setErrors({ problem: err?.data?.message ?? 'Could not send the device. Please try again.' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Send a Device</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>To another registered shop for repair</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FadeInView animValue={anims[0]} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>RECEIVING SHOP</Text>
          <Input
            label="Owner's Registered Mobile"
            value={mobile}
            onChangeText={(t) => { setMobile(t.replace(/\D/g, '').slice(0, 10)); setMatch(null); }}
            placeholder="10-digit mobile"
            keyboardType="phone-pad"
            leftIcon="phone"
            error={lookupError}
            editable={!match}
          />
          {!match ? (
            <Button title="Find Shop" onPress={runLookup} loading={looking} fullWidth />
          ) : (
            <View style={[styles.matchCard, { backgroundColor: colors.success + '0F', borderColor: colors.success + '33' }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{match.businessName}</Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{match.ownerName} · {match.ownerMobile}</Text>
              </View>
              <TouchableOpacity onPress={() => { setMatch(null); setMobile(''); }} accessibilityLabel="Change shop">
                <Feather name="x-circle" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          )}
        </FadeInView>

        {!!match && (
          <FadeInView animValue={anims[1]} style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>DEVICE DETAILS</Text>
            <View style={{ gap: 14 }}>
              <Input label="Device Type" value={deviceType} onChangeText={setDeviceType} placeholder="e.g. Smartphone, Laptop" leftIcon="smartphone" error={errors.deviceType} />
              <Input label="Brand" value={brand} onChangeText={setBrand} placeholder="e.g. Samsung" leftIcon="tag" error={errors.brand} />
              <Input label="Model" value={model} onChangeText={setModel} placeholder="e.g. Galaxy S21" leftIcon="cpu" error={errors.model} />
              <Input label="IMEI / Serial (Optional)" value={imei} onChangeText={setImei} placeholder="15-digit IMEI" keyboardType="number-pad" leftIcon="hash" />
              <Input label="Problem" value={problem} onChangeText={setProblem} placeholder="Describe the issue" leftIcon="alert-circle" multiline error={errors.problem} />
              <Input label="Notes (Optional)" value={notes} onChangeText={setNotes} placeholder="Anything else the repairing shop should know" leftIcon="file-text" multiline />
            </View>
          </FadeInView>
        )}

        {!!match && (
          <FadeInView animValue={anims[2]} style={styles.section}>
            <View style={[styles.infoBox, { backgroundColor: colors.primary + '0F', borderColor: colors.primary + '22', borderRadius: 16 }]}>
              <Feather name="info" size={14} color={colors.primary} />
              <Text style={[styles.infoText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                This creates a repair ticket directly in {match.businessName}'s workflow. You'll see its status update automatically as they work on it.
              </Text>
            </View>
            <Button title="Send Device" onPress={handleSubmit} loading={loading} fullWidth size="lg" />
          </FadeInView>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  backBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20 },
  headerSub: { fontSize: 12 },
  scroll: { padding: 12, gap: 12 },
  section: { gap: 12 },
  sectionLabel: { fontSize: 10, letterSpacing: 1, marginTop: 4 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, padding: 10 },
  infoText: { fontSize: 11, flex: 1, lineHeight: 16 },
  matchCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
});
