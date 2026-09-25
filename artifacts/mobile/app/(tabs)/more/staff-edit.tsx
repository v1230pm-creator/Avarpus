import React, { useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { staffReject, staffUpdate } from '@workspace/api-client-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { ROLE_LABELS } from '@/utils/helpers';
import { font, fontFamily } from '@/constants/typography';
import { layout, size, space } from '@/constants/spacing';

// Roles a dealer can assign — dealer/admin accounts can never be set here.
const STAFF_ROLES = ['reception', 'technician', 'store_manager', 'accountant'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

const ROLE_ICONS: Record<StaffRole, keyof typeof Feather.glyphMap> = {
  reception: 'phone',
  technician: 'tool',
  store_manager: 'package',
  accountant: 'dollar-sign',
};

export default function EditStaffScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    name?: string;
    email?: string;
    mobile?: string;
    role?: string;
    designation?: string;
  }>();

  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState(params.name ?? '');
  const [mobile, setMobile] = useState(params.mobile ?? '');
  const [designation, setDesignation] = useState(params.designation ?? '');
  const [role, setRole] = useState<StaffRole>(
    (STAFF_ROLES as readonly string[]).includes(params.role ?? '')
      ? (params.role as StaffRole)
      : 'reception',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const anims = useStaggerAnim(3);

  const handleSave = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = 'Valid 10-digit mobile required';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setLoading(true);
    try {
      await staffUpdate(String(params.id), {
        name: name.trim(),
        mobile: mobile.trim(),
        role,
        designation: designation.trim(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err: any) {
      const msg = err?.data?.message ?? 'Could not update the staff profile. Please try again.';
      Alert.alert('Update failed', msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  // One tap removes immediately (owner's request: no confirmation step).
  const handleRemove = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      await staffReject(String(params.id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err: any) {
      if (err?.status === 404) {
        // Already removed elsewhere: nothing left to refuse.
        router.back();
        return;
      }
      const msg = err?.data?.message ?? 'Could not remove this staff member. Please try again.';
      Alert.alert('Removal failed', msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}>
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: fontFamily.bold }]}>Edit Staff</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]} numberOfLines={1}>
            {params.email ?? 'Update profile details'}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FadeInView animValue={anims[0]} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: fontFamily.semibold }]}>ROLE</Text>
          <View style={styles.roleGrid}>
            {STAFF_ROLES.map((r) => {
              const active = role === r;
              return (
                <TouchableOpacity
                  key={r}
                  style={[
                    styles.roleCard,
                    {
                      backgroundColor: active ? colors.primary + '15' : colors.primary + '08',
                      borderColor: active ? colors.primary : colors.primary + '18',
                      borderRadius: 16,
                    },
                  ]}
                  onPress={() => setRole(r)}
                  activeOpacity={0.8}
                >
                  <Feather name={ROLE_ICONS[r]} size={18} color={active ? colors.primary : colors.mutedForeground} />
                  <Text style={[styles.roleName, { color: active ? colors.primary : colors.foreground, fontFamily: fontFamily.semibold }]}>
                    {ROLE_LABELS[r] ?? r}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </FadeInView>

        <FadeInView animValue={anims[1]} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: fontFamily.semibold }]}>DETAILS</Text>
          <View style={{ gap: 8 }}>
            <Input label="Full Name" value={name} onChangeText={setName}
              placeholder="Staff member's name" leftIcon="user" error={errors.name} />
            <Input label="Mobile Number" value={mobile}
              onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile" keyboardType="phone-pad"
              leftIcon="phone" error={errors.mobile} />
            <Input label="Designation (Optional)" value={designation} onChangeText={setDesignation}
              placeholder="e.g. Senior Technician" leftIcon="tag" error={errors.designation} />
          </View>
        </FadeInView>

        <FadeInView animValue={anims[2]} style={styles.section}>
          <View style={[styles.infoBox, { backgroundColor: colors.primary + '0F', borderColor: colors.primary + '22', borderRadius: 16 }]}>
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
              Email cannot be changed — it is kept as a recovery identity. Staff sign in with their registered mobile and a verification code.
            </Text>
          </View>

          <Button title="Save Changes" onPress={handleSave} loading={loading} fullWidth size="lg" />
        </FadeInView>

        <FadeInView animValue={anims[2]} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: fontFamily.semibold }]}>REMOVE ACCESS</Text>
          <TouchableOpacity
            onPress={handleRemove}
            disabled={loading || removing}
            accessibilityRole="button"
            accessibilityLabel="Remove from Shop"
            style={[styles.removeBtn, { backgroundColor: colors.destructive + '10', borderColor: colors.destructive + '33', borderRadius: 16 }]}
            activeOpacity={0.8}
          >
            {removing ? <AvarpusSpinner size={18} /> : <Feather name="user-x" size={18} color={colors.destructive} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.removeTitle, { color: colors.destructive, fontFamily: fontFamily.semibold }]}>Remove from Shop</Text>
              <Text style={[styles.removeText, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
                Removes immediately: their Staff ID and all permissions for this Shop. Their personal account is kept; you can invite the number again.
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </FadeInView>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: layout.headerHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingBottom: space.md, gap: space.sm },
  backBtn: { width: size.iconButton, height: size.iconButton, borderRadius: size.iconButton / 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  headerSub: { ...font.caption },
  scroll: { padding: layout.screenPadding, gap: space.sm },
  section: { gap: 8 },
  sectionLabel: { ...font.overline, marginTop: 4 },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleCard: { width: '48%', flexGrow: 1, borderWidth: 1.5, padding: 12, gap: 6, alignItems: 'flex-start' },
  roleName: { ...font.captionStrong },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, padding: 12 },
  infoText: { ...font.caption, flex: 1 },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, padding: 14 },
  removeTitle: { ...font.bodyStrong },
  removeText: { ...font.caption, marginTop: 2 },
});
