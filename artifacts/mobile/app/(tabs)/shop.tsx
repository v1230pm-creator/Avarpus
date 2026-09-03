import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  shopClaim,
  shopMe,
  shopRecoveryRequest,
  shopRecoveryVerify,
  shopSetupRequest,
  shopSetupVerify,
  shopSwitch,
  type ShopMeResponse,
} from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

type Mode = 'overview' | 'setup' | 'claim' | 'recovery';

function messageOf(error: unknown, fallback: string) {
  const data = (error as { data?: { message?: string } })?.data;
  return data?.message ?? (error instanceof Error ? error.message : fallback);
}

export default function ShopScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { refreshUser, refreshFeatures, canAccess } = useAuth();
  const [mode, setMode] = useState<Mode>('overview');
  const [workspace, setWorkspace] = useState<ShopMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [address, setAddress] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [staffId, setStaffId] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryShopId, setRecoveryShopId] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const load = useCallback(async () => {
    setError(null);
    try {
      setWorkspace(await shopMe());
    } catch (err) {
      setError(messageOf(err, 'Could not load your workspace.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const resetBusinessQueries = async () => {
    const prefixes = ['/repairs', '/customers', '/inventory', '/purchases', '/finance', '/payments', '/dashboard', '/dealers', '/approvals'];
    await queryClient.cancelQueries({
      predicate: (query) => typeof query.queryKey[0] === 'string' && prefixes.some((prefix) => String(query.queryKey[0]).startsWith(prefix)),
    });
    queryClient.removeQueries({
      predicate: (query) => typeof query.queryKey[0] === 'string' && prefixes.some((prefix) => String(query.queryKey[0]).startsWith(prefix)),
    });
  };

  const requestVerification = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await shopSetupRequest({
        businessName: businessName.trim(),
        email: businessEmail.trim(),
        address: address.trim(),
        ...(gstNumber.trim() ? { gstNumber: gstNumber.trim() } : {}),
      });
      setBusinessEmail(result.email);
      setVerificationSent(true);
    } catch (err) {
      setError(messageOf(err, 'Could not send the verification code.'));
    } finally {
      setSaving(false);
    }
  };

  const verifyAndCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      await shopSetupVerify({ email: businessEmail.trim(), code: verificationCode.trim() });
      await resetBusinessQueries();
      await refreshUser();
      await refreshFeatures();
      setMode('overview');
      setVerificationSent(false);
      setLoading(true);
      await load();
    } catch (err) {
      setError(messageOf(err, 'Could not create the workspace.'));
    } finally {
      setSaving(false);
    }
  };

  const claimWorkspace = async () => {
    setSaving(true);
    setError(null);
    try {
      await shopClaim({ staffId: staffId.trim().toUpperCase(), claimCode: claimCode.trim().toUpperCase() });
      await resetBusinessQueries();
      await refreshUser();
      await refreshFeatures();
      setMode('overview');
      setLoading(true);
      await load();
    } catch (err) {
      setError(messageOf(err, 'Could not join this workspace.'));
    } finally {
      setSaving(false);
    }
  };

  const beginRecovery = async () => {
    const target = workspace?.memberships[0];
    if (!target) return;
    setMode('recovery');
    setSaving(true);
    setError(null);
    setRecoveryShopId(target.id);
    try {
      const result = await shopRecoveryRequest(target.id);
      setRecoveryMessage(result.message);
    } catch (err) {
      setError(messageOf(err, 'Could not send the recovery code.'));
    } finally {
      setSaving(false);
    }
  };

  const verifyRecovery = async () => {
    setSaving(true);
    setError(null);
    try {
      await shopRecoveryVerify({
        shopId: recoveryShopId,
        email: recoveryEmail.trim().toLowerCase(),
        code: recoveryCode.trim(),
      });
      await resetBusinessQueries();
      await refreshUser();
      await refreshFeatures();
      setMode('overview');
      setLoading(true);
      await load();
    } catch (err) {
      setError(messageOf(err, 'Could not restore this workspace.'));
    } finally {
      setSaving(false);
    }
  };

  const switchWorkspace = async (shopId: string) => {
    if (shopId === workspace?.activeShopId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await shopSwitch(shopId);
      await resetBusinessQueries();
      await refreshUser();
      await refreshFeatures();
      setLoading(true);
      await load();
    } catch (err) {
      setError(messageOf(err, 'Could not switch workspace.'));
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
      {mode !== 'overview' && (
        <TouchableOpacity onPress={() => { setMode('overview'); setError(null); }} style={styles.iconButton}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Shop</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your secure business workspace</Text>
      </View>
      <TouchableOpacity onPress={() => router.push({ pathname: '/(tabs)/more', params: { scope: 'business' } })} style={styles.iconButton} accessibilityLabel="Open settings">
        <Feather name="settings" size={21} color={colors.foreground} />
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return <View style={[styles.container, { backgroundColor: colors.background }]}>{header}<View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View></View>;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {header}
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} keyboardShouldPersistTaps="handled">
        {!!error && (
          <View style={[styles.errorBox, { borderColor: colors.destructive, backgroundColor: `${colors.destructive}10` }]}>
            <Text style={{ color: colors.destructive, flex: 1 }}>{error}</Text>
            {mode === 'overview' && <TouchableOpacity onPress={() => void load()}><Text style={{ color: colors.primary }}>Retry</Text></TouchableOpacity>}
          </View>
        )}

        {mode === 'setup' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Set up your Shop</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Your personal account stays the same. Business records are stored separately and unlock only after business email verification.
            </Text>
            {!verificationSent ? (
              <>
                <Field label="Business name" value={businessName} onChangeText={setBusinessName} colors={colors} />
                <Field label="Business email" value={businessEmail} onChangeText={setBusinessEmail} colors={colors} keyboardType="email-address" autoCapitalize="none" />
                <Field label="Shop address" value={address} onChangeText={setAddress} colors={colors} multiline />
                <Field label="GST number (optional)" value={gstNumber} onChangeText={setGstNumber} colors={colors} autoCapitalize="characters" />
                <PrimaryButton label="Send verification code" onPress={requestVerification} disabled={saving} colors={colors} />
              </>
            ) : (
              <>
                <View style={[styles.verifiedEmail, { backgroundColor: colors.surfaceSecondary }]}>
                  <Feather name="mail" size={18} color={colors.primary} />
                  <Text style={{ color: colors.foreground, flex: 1 }}>{businessEmail}</Text>
                </View>
                <Field label="6-digit verification code" value={verificationCode} onChangeText={setVerificationCode} colors={colors} keyboardType="number-pad" maxLength={6} />
                <PrimaryButton label="Verify and create Shop" onPress={verifyAndCreate} disabled={saving || verificationCode.trim().length !== 6} colors={colors} />
                <TouchableOpacity onPress={() => setVerificationSent(false)}><Text style={[styles.link, { color: colors.primary }]}>Change details or resend</Text></TouchableOpacity>
              </>
            )}
          </View>
        )}

        {mode === 'claim' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Join a Shop</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Ask the Shop owner for your Staff ID and one-time claim code. This connects your existing mobile-verified personal account.
            </Text>
            <Field label="Staff ID" value={staffId} onChangeText={setStaffId} colors={colors} autoCapitalize="characters" />
            <Field label="Claim code" value={claimCode} onChangeText={setClaimCode} colors={colors} autoCapitalize="characters" />
            <PrimaryButton label="Join workspace" onPress={claimWorkspace} disabled={saving || !staffId.trim() || !claimCode.trim()} colors={colors} />
          </View>
        )}

        {mode === 'recovery' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Recover Shop backup</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Your signed-in mobile account and a one-time code sent to the verified business email are both required.
            </Text>
            {!!recoveryMessage && <Text style={[styles.body, { color: colors.primary }]}>{recoveryMessage}</Text>}
            <Field label="Verified business email" value={recoveryEmail} onChangeText={setRecoveryEmail} colors={colors} keyboardType="email-address" autoCapitalize="none" />
            <Field label="Recovery code" value={recoveryCode} onChangeText={setRecoveryCode} colors={colors} keyboardType="number-pad" maxLength={6} />
            <PrimaryButton
              label="Verify and restore"
              onPress={verifyRecovery}
              disabled={saving || !recoveryShopId || !recoveryEmail.trim() || recoveryCode.trim().length !== 6}
              colors={colors}
            />
          </View>
        )}

        {mode === 'overview' && !workspace?.shop && (
          <>
            <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.heroIcon, { backgroundColor: `${colors.primary}14` }]}>
                <Feather name="briefcase" size={34} color={colors.primary} />
              </View>
              <Text style={[styles.heroTitle, { color: colors.foreground }]}>
                {workspace?.backupDetected ? 'Business backup detected' : 'Run your Shop on Avarpus'}
              </Text>
              <Text style={[styles.heroText, { color: colors.mutedForeground }]}>
                {workspace?.backupDetected
                  ? 'Restore your protected workspace with your mobile-authenticated account and verified business email.'
                  : 'Repairs, Khata, customers, staff and reports stay protected inside a separate business workspace.'}
              </Text>
              {workspace?.backupDetected ? (
                <PrimaryButton label="Recover Shop backup" onPress={beginRecovery} disabled={saving} colors={colors} />
              ) : (
                <>
                  <PrimaryButton label="Set up your Shop" onPress={() => setMode('setup')} colors={colors} />
                  <TouchableOpacity onPress={() => setMode('claim')} style={[styles.secondaryButton, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Join with Staff ID</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
            <View style={styles.securityNote}>
              <Feather name="shield" size={17} color={colors.success} />
              <Text style={[styles.body, { color: colors.mutedForeground, flex: 1 }]}>Personal chats, calls, status and profile work without creating a Shop.</Text>
            </View>
          </>
        )}

        {mode === 'overview' && workspace?.shop && (
          <>
            <View style={[styles.workspaceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.workspaceHeading}>
                <View style={[styles.workspaceIcon, { backgroundColor: `${colors.primary}14` }]}><Feather name="briefcase" size={24} color={colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{workspace.shop.businessName}</Text>
                  <Text style={[styles.body, { color: colors.mutedForeground }]}>{workspace.shop.role === 'owner' ? 'Owner' : workspace.shop.role.replace('_', ' ')}</Text>
                </View>
                {workspace.shop.businessEmailVerified && <Feather name="check-circle" size={20} color={colors.success} />}
              </View>
              {!!workspace.shop.businessEmail && <Text style={[styles.body, { color: colors.mutedForeground }]}>{workspace.shop.businessEmail}</Text>}
            </View>

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>BUSINESS TOOLS</Text>
            <View style={[styles.toolList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {(canAccess('repairs') || canAccess('repairs_portal')) && <ToolRow icon="tool" label="Repairs" detail="Jobs, testing and delivery" onPress={() => router.push('/(tabs)/repairs')} colors={colors} />}
              {(canAccess('payments') || canAccess('repairs')) && <ToolRow icon="book-open" label="Khata" detail="Balances and payments" onPress={() => router.push('/(tabs)/khata')} colors={colors} />}
              {canAccess('customers') && <ToolRow icon="users" label="Customers" detail="Contacts and repair history" onPress={() => router.push('/(tabs)/customers')} colors={colors} />}
              {canAccess('inventory') && <ToolRow icon="package" label="Inventory" detail="Parts and stock" onPress={() => router.push('/(tabs)/inventory')} colors={colors} />}
            </View>

            {workspace.memberships.length > 1 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SWITCH WORKSPACE</Text>
                <View style={[styles.toolList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  {workspace.memberships.map((membership) => (
                    <ToolRow
                      key={membership.id}
                      icon={membership.id === workspace.activeShopId ? 'check-circle' : 'circle'}
                      label={membership.businessName}
                      detail={membership.role}
                      onPress={() => void switchWorkspace(membership.id)}
                      colors={colors}
                    />
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Field({ label, colors, ...props }: React.ComponentProps<typeof TextInput> & { label: string; colors: any }) {
  return <View style={{ gap: 6 }}>
    <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
    <TextInput
      {...props}
      placeholderTextColor={colors.mutedForeground}
      style={[styles.input, props.multiline && styles.multiline, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
    />
  </View>;
}

function PrimaryButton({ label, onPress, disabled, colors }: { label: string; onPress: () => void; disabled?: boolean; colors: any }) {
  return <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: disabled ? 0.55 : 1 }]}>
    {disabled ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>{label}</Text>}
  </TouchableOpacity>;
}

function ToolRow({ icon, label, detail, onPress, colors }: { icon: keyof typeof Feather.glyphMap; label: string; detail: string; onPress: () => void; colors: any }) {
  return <TouchableOpacity onPress={onPress} style={[styles.toolRow, { borderBottomColor: colors.border }]}>
    <View style={[styles.toolIcon, { backgroundColor: `${colors.primary}12` }]}><Feather name={icon} size={18} color={colors.primary} /></View>
    <View style={{ flex: 1 }}><Text style={[styles.toolLabel, { color: colors.foreground }]}>{label}</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>{detail}</Text></View>
    <Feather name="chevron-right" size={19} color={colors.mutedForeground} />
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 60, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 14 },
  errorBox: { padding: 12, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 12, alignItems: 'center' },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 },
  cardTitle: { fontSize: 19, fontFamily: 'Inter_700Bold' },
  body: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_400Regular' },
  fieldLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, fontFamily: 'Inter_400Regular' },
  multiline: { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' },
  primaryButton: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  secondaryButton: { minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  link: { textAlign: 'center', fontFamily: 'Inter_600SemiBold', padding: 4 },
  verifiedEmail: { minHeight: 46, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  hero: { borderWidth: 1, borderRadius: 18, padding: 22, gap: 14, alignItems: 'stretch' },
  heroIcon: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  heroTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  heroText: { fontSize: 14, lineHeight: 21, textAlign: 'center', fontFamily: 'Inter_400Regular', marginBottom: 4 },
  securityNote: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  workspaceCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  workspaceHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  workspaceIcon: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 11, letterSpacing: 0.9, fontFamily: 'Inter_600SemiBold', marginTop: 8, marginLeft: 3 },
  toolList: { borderWidth: 1, borderRadius: 15, overflow: 'hidden' },
  toolRow: { minHeight: 68, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  toolIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toolLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
});