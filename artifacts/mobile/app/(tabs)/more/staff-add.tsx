import React, { useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { staffCreate, useDealersList } from '@workspace/api-client-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { ROLE_LABELS } from '@/utils/helpers';

// Roles a dealer can assign — dealer/admin accounts can never be created here.
// dealer_owner / dealer_staff are read-only B2B dealer-portal logins that must
// be linked to a dealer profile.
const STAFF_ROLES = ['reception', 'technician', 'store_manager', 'accountant', 'dealer_owner', 'dealer_staff'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

const PORTAL_ROLES: StaffRole[] = ['dealer_owner', 'dealer_staff'];

const ROLE_ICONS: Record<StaffRole, keyof typeof Feather.glyphMap> = {
  reception: 'phone',
  technician: 'tool',
  store_manager: 'package',
  accountant: 'dollar-sign',
  dealer_owner: 'briefcase',
  dealer_staff: 'users',
};

const ROLE_PERMISSION_HINTS: Record<StaffRole, string> = {
  reception: 'Inbox, repairs & customers',
  technician: 'Assigned repairs & status updates',
  store_manager: 'Inventory & purchases',
  accountant: 'Finance, reports, income & expenses',
  dealer_owner: 'B2B dealer login — sees only their own repairs (read-only)',
  dealer_staff: 'B2B dealer staff login — same read-only view',
};

export default function AddStaffScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [designation, setDesignation] = useState('');
  const [role, setRole] = useState<StaffRole>('reception');
  const [dealerId, setDealerId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const isPortalRole = PORTAL_ROLES.includes(role);
  const { data: dealersData } = useDealersList({}, { query: { enabled: isPortalRole } } as any);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const anims = useStaggerAnim(3);

  const handleCreate = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Valid email is required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = 'Valid 10-digit mobile required';
    if (!password || password.length < 8) e.password = 'Min. 8 characters';
    else if (!/[A-Z]/.test(password)) e.password = 'Include an uppercase letter';
    else if (!/[a-z]/.test(password)) e.password = 'Include a lowercase letter';
    else if (!/[0-9]/.test(password)) e.password = 'Include a number';
    if (isPortalRole && !dealerId) e.dealer = 'Select the dealer this login belongs to';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setLoading(true);
    try {
      await staffCreate({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        mobile: mobile.trim(),
        password,
        role,
        designation: designation.trim() || undefined,
        dealerId: isPortalRole ? dealerId ?? undefined : undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err: any) {
      const msg = err?.data?.message ?? 'Could not create the staff account. Please try again.';
      setErrors({ email: msg });
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
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Add Staff</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Create a staff account for your shop</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

              <KeyboardAwareScrollViewCompat
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FadeInView animValue={anims[0]} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>ROLE & PERMISSIONS</Text>
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
                  <Text style={[styles.roleHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    {ROLE_PERMISSION_HINTS[r]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {isPortalRole && (
            <View style={{ gap: 8 }}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>LINK TO DEALER</Text>
              {errors.dealer ? (
                <Text style={{ fontSize: 12, color: colors.destructive, fontFamily: 'Inter_500Medium' }}>{errors.dealer}</Text>
              ) : null}
              {(dealersData?.dealers || []).length === 0 ? (
                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                  No dealers yet — add a dealer first from Repairs → Dealers.
                </Text>
              ) : (
                (dealersData?.dealers || []).map((d) => {
                  const active = dealerId === d.id;
                  return (
                    <TouchableOpacity
                      key={d.id}
                      onPress={() => setDealerId(d.id)}
                      activeOpacity={0.8}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12,
                        borderWidth: 1.5, backgroundColor: active ? colors.primary + '15' : colors.primary + '08',
                        borderColor: active ? colors.primary : colors.primary + '18',
                      }}
                    >
                      <Text style={{ fontSize: 11, color: colors.primary, fontFamily: 'Inter_700Bold' }}>{d.dealerCode}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{d.name}</Text>
                        {!!d.shopName && <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{d.shopName}</Text>}
                      </View>
                      {active && <Feather name="check" size={16} color={colors.primary} />}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}
          </FadeInView>

          <FadeInView animValue={anims[1]} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>DETAILS</Text>
          <View style={{ gap: 14 }}>
            <Input label="Full Name" value={name} onChangeText={setName}
              placeholder="Staff member's name" leftIcon="user" error={errors.name} />
            <Input label="Email Address" value={email} onChangeText={setEmail}
              placeholder="name@company.com" keyboardType="email-address"
              autoCapitalize="none" leftIcon="mail" error={errors.email} />
            <Input label="Mobile Number" value={mobile}
              onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile" keyboardType="phone-pad"
              leftIcon="phone" error={errors.mobile} />
            <Input label="Password" value={password} onChangeText={setPassword}
              placeholder="8+ chars, A-z, 0-9" isPassword leftIcon="lock" error={errors.password} />
            <Input label="Designation (Optional)" value={designation} onChangeText={setDesignation}
              placeholder="e.g. Senior Technician" leftIcon="tag" error={errors.designation} />
          </View>
          </FadeInView>

          <FadeInView animValue={anims[2]} style={styles.section}>
          <View style={[styles.infoBox, { backgroundColor: colors.primary + '0F', borderColor: colors.primary + '22', borderRadius: 16 }]}>
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              The staff member signs in with this email/mobile and password. Their access is limited by the role you assign.
            </Text>
          </View>

          <Button title="Create Staff Account" onPress={handleCreate} loading={loading} fullWidth size="lg" />
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
  roleCard: { width: '48%', flexGrow: 1, borderWidth: 1.5, padding: 14, gap: 6 },
  roleName: { fontSize: 13 },
  roleHint: { fontSize: 11, lineHeight: 15 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, padding: 12 },
  infoText: { fontSize: 12, flex: 1, lineHeight: 18 },
});
