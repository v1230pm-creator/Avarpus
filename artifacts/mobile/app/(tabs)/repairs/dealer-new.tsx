import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { dealersCreate, getDealersListQueryKey } from '@workspace/api-client-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

export default function AddDealerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [shopName, setShopName] = useState('');
  const [mobile, setMobile] = useState('');
  const [location, setLocation] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const anims = useStaggerAnim(2);

  const handleCreate = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Dealer name is required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = 'Valid 10-digit mobile required';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setLoading(true);
    try {
      const res = await dealersCreate({
        name: name.trim(),
        shopName: shopName.trim() || undefined,
        mobile: mobile.trim(),
        location: location.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: getDealersListQueryKey() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/(tabs)/repairs/dealer/${res.dealer.id}`);
    } catch (err: any) {
      const msg = err?.data?.message ?? 'Could not create the dealer. Please try again.';
      setErrors({ mobile: msg });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <View style={[styles.header, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}>
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Add Dealer</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Register a B2B dealer for bulk repairs</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FadeInView animValue={anims[0]} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DEALER DETAILS</Text>
          <View style={{ gap: 14 }}>
            <Input label="Dealer Name" value={name} onChangeText={setName}
              placeholder="Owner / contact person" leftIcon="user" error={errors.name} />
            <Input label="Shop Name (Optional)" value={shopName} onChangeText={setShopName}
              placeholder="e.g. Sharma Mobile Center" leftIcon="briefcase" error={errors.shopName} />
            <Input label="Mobile Number" value={mobile}
              onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile" keyboardType="phone-pad"
              leftIcon="phone" error={errors.mobile} />
            <Input label="Location (Optional)" value={location} onChangeText={setLocation}
              placeholder="City / area" leftIcon="map-pin" error={errors.location} />
          </View>
        </FadeInView>

        <FadeInView animValue={anims[1]} style={styles.section}>
          <View style={[styles.infoBox, { backgroundColor: colors.primary + '0F', borderColor: colors.primary + '22', borderRadius: radius.md }]}>
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              A dealer code (DLR-001, DLR-002…) is assigned automatically. You can link repairs to this dealer at intake and track all their repairs from the dealer profile.
            </Text>
          </View>
          <Button title="Create Dealer" onPress={handleCreate} loading={loading} fullWidth size="lg" />
        </FadeInView>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: layout.headerHeight, paddingHorizontal: layout.listInset, gap: space.sm },
  backBtn: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  headerSub: { ...font.caption },
  scroll: { padding: layout.screenPadding, gap: space.md },
  section: { gap: space.md },
  sectionLabel: { ...font.overline, marginTop: space.xs },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, padding: 10 },
  infoText: { ...font.caption, flex: 1 },
});
