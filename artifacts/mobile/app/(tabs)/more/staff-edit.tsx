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
import { staffUpdate } from '@workspace/api-client-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { ROLE_LABELS } from '@/utils/helpers';

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

  const [name, setName] = useState(params.name ?? '');
  const [mobile, setMobile] = useState(params.mobile ?? '');
  const [designation, setDesignation] = useState(params.designation ?? '');
  const [password, setPassword] = useState('');
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
    if (password) {
      if (password.length < 8) e.password = 'Min. 8 characters';
      else if (!/[A-Z]/.test(password)) e.password = 'Include an uppercase letter';
      else if (!/[a-z]/.test(password)) e.password = 'Include a lowercase letter';
      else if (!/[0-9]/.test(password)) e.password = 'Include a number';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setLoading(true);
    try {
      await staffUpdate(String(params.id), {
        name: name.trim(),
        mobile: mobile.trim(),
        role,
        designation: designation.trim(),
        ...(password ? { password } : {}),
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Edit Staff</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
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
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>ROLE</Text>
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
                  <Text style={[styles.roleName, { color: active ? colors.primary : colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                    {ROLE_LABELS[r] ?? r}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </FadeInView>

        <FadeInView animValue={anims[1]} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>DETAILS</Text>
          <View style={{ gap: 14 }}>
            <Input label="Full Name" value={name} onChangeText={setName}
              placeholder="Staff member's name" leftIcon="user" error={errors.name} />
            <Input label="Mobile Number" value={mobile}
              onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile" keyboardType="phone-pad"
              leftIcon="phone" error={errors.mobile} />
            <Input label="Designation (Optional)" value={designation} onChangeText={setDesignation}
              placeholder="e.g. Senior Technician" leftIcon="tag" error={errors.designation} />
            <Input label="New Password (Optional)" value={password} onChangeText={setPassword}
              placeholder="Leave blank to keep current" isPassword leftIcon="lock" error={errors.password} />
          </View>
        </FadeInView>

        <FadeInView animValue={anims[2]} style={styles.section}>
          <View style={[styles.infoBox, { backgroundColor: colors.primary + '0F', borderColor: colors.primary + '22', borderRadius: 16 }]}>
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Email cannot be changed — it is the staff member's login ID. Setting a new password signs them in with it on their next login.
            </Text>
          </View>

          <Button title="Save Changes" onPress={handleSave} loading={loading} fullWidth size="lg" />
        </FadeInView>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22 },
  headerSub: { fontSize: 13 },
  scroll: { padding: 16, gap: 16 },
  section: { gap: 16 },
  sectionLabel: { fontSize: 11, letterSpacing: 1, marginTop: 4 },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  roleCard: { width: '48%', flexGrow: 1, borderWidth: 1.5, padding: 14, gap: 6, alignItems: 'flex-start' },
  roleName: { fontSize: 13 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, padding: 12 },
  infoText: { fontSize: 12, flex: 1, lineHeight: 18 },
});
