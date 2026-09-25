import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  shopClaim,
  shopMe,
  shopSetupRequest,
  shopSetupVerify,
  type ShopMeResponse,
} from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { resetBusinessQueries, useWorkspaceSwitch } from '@/hooks/useWorkspaceSwitch';
import { AvarpusLoadingScreen, AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { isCustomerRole, isDealerPortalRole } from '@/types';
import { getShopTabTarget } from '@/utils/tabVisibility';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

type Mode = 'overview' | 'setup' | 'claim';

function messageOf(error: unknown, fallback: string) {
  const data = (error as { data?: { message?: string } })?.data;
  return data?.message ?? (error instanceof Error ? error.message : fallback);
}

/**
 * Entry point for accounts that have no workspace to open yet: set up a Shop,
 * join one with an activation code, or open a membership that is already
 * linked. Accounts inside a Shop never see this screen — the Shop tab takes
 * them straight to their first business tool (see getShopTabTarget).
 */
export default function ShopScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { user, refreshUser, refreshFeatures, canAccess } = useAuth();
  const isDealerPortal = isDealerPortalRole(user?.role);
  const workspaceTarget = getShopTabTarget({
    customer: isCustomerRole(user?.role),
    portal: isDealerPortal,
    hasShop: !!user?.shopId,
    canAccess,
  });
  const entersWorkspace = workspaceTarget !== 'shop';
  const { switching, switchTo } = useWorkspaceSwitch();
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
  const [activationCode, setActivationCode] = useState('');
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

  useEffect(() => {
    if (entersWorkspace) return;
    void load();
  }, [entersWorkspace, load]);

  // Deep links and older shortcuts still point here; the workspace itself has
  // no landing page, so hand them on to the first tool.
  if (entersWorkspace) {
    return <Redirect href={`/(tabs)/${workspaceTarget}`} />;
  }

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
      await resetBusinessQueries(queryClient);
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
      // One code, entered once: the server binds it to this signed-in mobile
      // number, and the membership stays linked from then on.
      await shopClaim({ activationCode: activationCode.trim().toUpperCase() });
      setActivationCode('');
      await resetBusinessQueries(queryClient);
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

  // Every active membership — owner or staff — opens directly. A linked
  // account is never asked to verify anything again.
  const teamMemberships = workspace?.memberships ?? [];
  const ownsAShop = teamMemberships.some((membership) => membership.role === 'owner');

  const openWorkspace = async (shopId: string) => {
    if (shopId === workspace?.activeShopId || switching || saving) return;
    setError(null);
    try {
      await switchTo(shopId);
      setLoading(true);
      await load();
    } catch (err) {
      setError(messageOf(err, 'Could not open this workspace.'));
    }
  };

  const busy = saving || switching;

  const header = (
    <View style={[styles.header, { paddingTop: topPad + space.lg, backgroundColor: colors.background }]}>
      {mode !== 'overview' && (
        <TouchableOpacity onPress={() => { setMode('overview'); setError(null); }} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Back">
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Shop</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your secure business workspace</Text>
      </View>
    </View>
  );

  if (loading) {
    return <View style={[styles.container, { backgroundColor: colors.background }]}>{header}<AvarpusLoadingScreen background={colors.background} size={40} /></View>;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {header}
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} keyboardShouldPersistTaps="handled">
        {!!error && (
          <View style={[styles.errorBox, { borderColor: colors.destructive, backgroundColor: `${colors.destructive}10` }]}>
            <Text style={[styles.body, { color: colors.destructive, flex: 1 }]}>{error}</Text>
            {mode === 'overview' && <TouchableOpacity onPress={() => void load()}><Text style={[styles.link, { color: colors.primary }]}>Retry</Text></TouchableOpacity>}
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
                <PrimaryButton label="Send verification code" onPress={requestVerification} busy={saving} colors={colors} />
              </>
            ) : (
              <>
                <View style={[styles.verifiedEmail, { backgroundColor: colors.surfaceSecondary }]}>
                  <Feather name="mail" size={18} color={colors.primary} />
                   <Text style={[styles.body, { color: colors.foreground, flex: 1 }]}>{businessEmail}</Text>
                </View>
                <Field label="6-digit verification code" value={verificationCode} onChangeText={setVerificationCode} colors={colors} keyboardType="number-pad" maxLength={6} />
                <PrimaryButton label="Verify and create Shop" onPress={verifyAndCreate} busy={saving} disabled={verificationCode.trim().length !== 6} colors={colors} />
                <TouchableOpacity onPress={() => setVerificationSent(false)}><Text style={[styles.link, { color: colors.primary }]}>Change details or resend</Text></TouchableOpacity>
              </>
            )}
          </View>
        )}

        {mode === 'claim' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Join a Shop</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Enter the one-time activation code the Shop owner shared with you. It only works for the mobile number you signed in with, and you will never be asked for it again.
            </Text>
            <Field label="Activation code" value={activationCode} onChangeText={setActivationCode} colors={colors} autoCapitalize="characters" autoCorrect={false} placeholder="XXXX-XXXX" />
            <PrimaryButton label="Activate and join" onPress={claimWorkspace} busy={saving} disabled={activationCode.replace(/[^a-z0-9]/gi, '').length < 8} colors={colors} />
          </View>
        )}

        {mode === 'overview' && !workspace?.shop && teamMemberships.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{ownsAShop ? 'Your Shop is linked to this number' : 'You are on a Shop team'}</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Open the workspace to continue. No code is needed — your membership is already active.
            </Text>
            {teamMemberships.map((membership) => (
              <PrimaryButton
                key={membership.id}
                label={`Open ${membership.businessName}${membership.role === 'owner' ? ' (Owner)' : ''}`}
                onPress={() => void openWorkspace(membership.id)}
                busy={switching}
                disabled={busy}
                colors={colors}
              />
            ))}
          </View>
        )}

        {mode === 'overview' && !workspace?.shop && (
          <>
            <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.heroIcon, { backgroundColor: `${colors.primary}14` }]}>
                <Feather name="briefcase" size={34} color={colors.primary} />
              </View>
              <Text style={[styles.heroTitle, { color: colors.foreground }]}>Run your Shop on Avarpus</Text>
              <Text style={[styles.heroText, { color: colors.mutedForeground }]}>
                {isDealerPortal
                  ? 'You are listed as a dealer at another shop. Set up your own Shop here; their repairs for you stay visible under Repairs.'
                  : 'Repairs, Khata, customers, staff and reports stay protected inside a separate business workspace.'}
              </Text>
              <PrimaryButton label="Set up your Shop" onPress={() => { setMode('setup'); setError(null); }} colors={colors} />
              {!isDealerPortal && (
                <TouchableOpacity onPress={() => setMode('claim')} style={[styles.secondaryButton, { borderColor: colors.border }]}>
                   <Text style={[styles.buttonText, { color: colors.foreground }]}>Join with activation code</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.securityNote}>
              <Feather name="shield" size={17} color={colors.success} />
              <Text style={[styles.body, { color: colors.mutedForeground, flex: 1 }]}>Personal chats, calls, status and profile work without creating a Shop.</Text>
            </View>
          </>
        )}

        {/* A Shop exists but every tool is switched off for this role: there is
            nothing to open, so say so instead of bouncing the tap away. */}
        {mode === 'overview' && !!workspace?.shop && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{workspace.shop.businessName}</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              No business tools are enabled for your role yet. Ask the Shop owner to turn them on under Staff Permissions.
            </Text>
          </View>
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
      placeholderTextColor={colors.placeholder}
      style={[styles.input, props.multiline && styles.multiline, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
    />
  </View>;
}

function PrimaryButton({ label, onPress, disabled, busy, colors }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; colors: any }) {
  // `disabled` covers incomplete input as well, so only a real in-flight save
  // may replace the label — otherwise the button spins before anything starts.
  return <TouchableOpacity
    onPress={onPress}
    disabled={disabled || busy}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
    style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: disabled || busy ? 0.55 : 1 }]}
  >
    {busy ? <AvarpusSpinner size={20} color={colors.primaryForeground} accessibilityLabel={null} /> : <Text style={{ color: colors.primaryForeground, ...font.button }}>{label}</Text>}
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: layout.headerHeight, paddingLeft: layout.titleInset, paddingRight: space.xs, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  iconButton: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  title: { ...font.display },
  subtitle: { ...font.caption, marginTop: space.xs },
  scroll: { padding: layout.screenPadding, gap: space.md },
  errorBox: { padding: space.md, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: space.md, alignItems: 'center' },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.lg, gap: space.md },
  cardTitle: { ...font.heading },
  body: { ...font.body },
  fieldLabel: { ...font.labelStrong },
  input: { minHeight: size.input, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: space.md, ...font.input },
  multiline: { minHeight: size.input + space.xxxl, paddingTop: space.md, textAlignVertical: 'top' },
  primaryButton: { minHeight: size.button, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  secondaryButton: { minHeight: size.button, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  link: { textAlign: 'center', ...font.button, padding: space.xs },
  verifiedEmail: { minHeight: size.input, borderRadius: radius.sm, paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md },
  hero: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.md, alignItems: 'stretch' },
  heroIcon: { width: size.fab, height: size.fab, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  heroTitle: { ...font.heading, textAlign: 'center' },
  heroText: { ...font.body, textAlign: 'center', marginBottom: space.xs },
  securityNote: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  buttonText: { ...font.button },
});
