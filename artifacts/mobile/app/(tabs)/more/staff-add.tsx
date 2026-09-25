import React, { useState } from 'react';
import {
  Platform,
  Alert,
  ScrollView,
  Share,
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
import { shopInvite, staffCreate, useDealersList } from '@workspace/api-client-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { ROLE_LABELS } from '@/utils/helpers';
import { font, fontFamily } from '@/constants/typography';
import { layout, size, space } from '@/constants/spacing';

// Roles an owner can assign. "owner" invites a co-owner (partner, brother,
// second proprietor) with the same full access; super_admin can never be
// created here. dealer_owner / dealer_staff are read-only B2B dealer-portal
// logins that must be linked to a dealer profile.
const STAFF_ROLES = ['owner', 'reception', 'technician', 'store_manager', 'accountant', 'dealer_owner', 'dealer_staff'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

const PORTAL_ROLES: StaffRole[] = ['dealer_owner', 'dealer_staff'];
type InviteRole = Exclude<StaffRole, 'dealer_owner' | 'dealer_staff'>;

const ROLE_ICONS: Record<StaffRole, keyof typeof Feather.glyphMap> = {
  owner: 'key',
  reception: 'phone',
  technician: 'tool',
  store_manager: 'package',
  accountant: 'dollar-sign',
  dealer_owner: 'briefcase',
  dealer_staff: 'users',
};

const ROLE_PERMISSION_HINTS: Record<StaffRole, string> = {
  owner: 'Co-owner — full access to everything, same as you',
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
    if (isPortalRole && !name.trim()) e.name = 'Name is required';
    if (isPortalRole && (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) e.email = 'Valid email is required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = 'Valid 10-digit mobile required';
    if (isPortalRole && !dealerId) e.dealer = 'Select the dealer this login belongs to';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setLoading(true);
    try {
      if (isPortalRole) {
        await staffCreate({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          mobile: mobile.trim(),
          role: role as 'dealer_owner' | 'dealer_staff',
          designation: designation.trim() || undefined,
          dealerId: dealerId ?? undefined,
        });
      } else {
        const invitation = await shopInvite({
          mobile: mobile.trim(),
          role: role as InviteRole,
        });
        const who = role === 'owner' ? 'the co-owner' : 'the staff member';
        const shareText = `Avarpus activation code: ${invitation.activationCode}\n\nSign in to Avarpus with your mobile number, open Shop and enter this code once. Valid for 7 days.`;
        Alert.alert(
          role === 'owner' ? 'Co-owner activation code' : 'Staff activation code',
          `${invitation.activationCode}\n\nShare this once with ${who}. They sign in with their mobile OTP, open Shop and enter the code — one time only. Their number stays linked after that; nothing is verified again.${role === 'owner' ? '\n\nOnce joined they have the same full access as you.' : ''}`,
          [
            { text: 'Share code', onPress: () => { void Share.share({ message: shareText }); } },
            { text: 'Done', style: 'default' },
          ],
        );
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err: any) {
      const msg = err?.data?.message ?? 'Could not create the staff account. Please try again.';
      // Server refusals (duplicate member, number already runs a Shop, …)
      // apply to the whole form, not to a field that may not be rendered.
      setErrors({ form: msg });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}>
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: fontFamily.bold }]}>Add Staff</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>Connect an existing Avarpus account</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

              <KeyboardAwareScrollViewCompat
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FadeInView animValue={anims[0]} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: fontFamily.semibold }]}>ROLE & PERMISSIONS</Text>
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
                  <Text style={[styles.roleHint, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
                    {ROLE_PERMISSION_HINTS[r]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {isPortalRole && (
            <View style={{ gap: 8 }}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: fontFamily.semibold }]}>LINK TO DEALER</Text>
              {errors.dealer ? (
                <Text style={{ ...font.captionStrong, color: colors.destructive }}>{errors.dealer}</Text>
              ) : null}
              {(dealersData?.dealers || []).length === 0 ? (
                <Text style={{ ...font.caption, color: colors.mutedForeground }}>
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
                        flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12,
                        borderWidth: 1.5, backgroundColor: active ? colors.primary + '15' : colors.primary + '08',
                        borderColor: active ? colors.primary : colors.primary + '18',
                      }}
                    >
                      <Text style={{ ...font.captionStrong, color: colors.primary }}>{d.dealerCode}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...font.bodyStrong, color: colors.foreground }}>{d.name}</Text>
                        {!!d.shopName && <Text style={{ ...font.caption, color: colors.mutedForeground }}>{d.shopName}</Text>}
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
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: fontFamily.semibold }]}>DETAILS</Text>
          <View style={{ gap: 8 }}>
            {isPortalRole && <>
              <Input label="Full Name" value={name} onChangeText={setName}
                placeholder="Staff member's name" leftIcon="user" error={errors.name} />
              <Input label="Email Address" value={email} onChangeText={setEmail}
                placeholder="name@company.com" keyboardType="email-address"
                autoCapitalize="none" leftIcon="mail" error={errors.email} />
            </>}
            <Input label="Mobile Number" value={mobile}
              onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile" keyboardType="phone-pad"
              leftIcon="phone" error={errors.mobile} />
            {isPortalRole && <Input label="Designation (Optional)" value={designation} onChangeText={setDesignation}
              placeholder="e.g. Senior Technician" leftIcon="tag" error={errors.designation} />}
          </View>
          </FadeInView>

          <FadeInView animValue={anims[2]} style={styles.section}>
          <View style={[styles.infoBox, { backgroundColor: colors.primary + '0F', borderColor: colors.primary + '22', borderRadius: 16 }]}>
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
              {isPortalRole
                ? 'This creates a restricted B2B dealer portal login.'
                : role === 'owner'
                  ? 'A co-owner gets the same full access as you — repairs, Khata, finance, staff and permissions. The number must already have a personal Avarpus account; you will receive a one-time activation code to share. They enter it once and stay linked.'
                  : 'The mobile number must already have a personal Avarpus account. You will receive a one-time activation code to share; they enter it once and stay linked.'}
            </Text>
          </View>

          {errors.form ? (
            <Text accessibilityRole="alert" style={{ ...font.captionStrong, color: colors.destructive }}>{errors.form}</Text>
          ) : null}
          <Button
            title={isPortalRole ? 'Create Portal Account' : role === 'owner' ? 'Create Co-owner Invitation' : 'Create Staff Invitation'}
            onPress={handleCreate}
            loading={loading}
            fullWidth
            size="lg"
          />
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
  roleCard: { width: '48%', flexGrow: 1, borderWidth: 1.5, padding: 12, gap: 6 },
  roleName: { ...font.captionStrong },
  roleHint: { ...font.caption },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, padding: 12 },
  infoText: { ...font.caption, flex: 1 },
});
