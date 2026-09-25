import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  accountDeletionExecute,
  accountDeletionPreview,
  accountDeletionRequestOtp,
  type AccountDeletionPreview,
  type AccountDeletionScope,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { useAuth } from '@/context/AuthContext';

// Settings → Account → Delete Account.
//
// The server decides what the caller may delete and does the deleting; this
// screen only walks the person through choosing a scope, reading what it
// means, confirming, and re-authenticating with a code sent to the mobile
// number already on the account. Nothing here is soft: after success the
// session is gone server-side and the app signs out locally.

type Step = 'select' | 'warning' | 'confirm' | 'otp' | 'success' | 'error';

const SCOPE_LABEL: Record<AccountDeletionScope, string> = {
  chat: 'Chat Account',
  business: 'Business Account',
  both: 'Both Accounts',
};

const DELETE_BUTTON: Record<AccountDeletionScope, string> = {
  chat: 'PERMANENTLY DELETE CHAT ACCOUNT',
  business: 'PERMANENTLY DELETE BUSINESS ACCOUNT',
  both: 'PERMANENTLY DELETE BOTH ACCOUNTS',
};

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { message?: string } })?.data;
  if (typeof data?.message === 'string' && data.message) return data.message;
  // Only surface server-provided text; transport noise or raw HTML is not
  // something the person can act on.
  if (err instanceof Error && err.message && !/fetch|HTTP \d{3}|<html/i.test(err.message)) return err.message;
  return fallback;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default function DeleteAccountScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { logout, holdSessionUntilLogout } = useAuth();

  const [preview, setPreview] = useState<AccountDeletionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [scope, setScope] = useState<AccountDeletionScope | null>(null);
  const [step, setStep] = useState<Step>('select');
  const [acknowledged, setAcknowledged] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setPreviewError(null);
    try {
      setPreview(await accountDeletionPreview());
    } catch (err) {
      setPreviewError(errorMessage(err, 'Could not load your account details. Check your connection and try again.'));
    }
  }, []);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const scopeAllowed = useCallback(
    (s: AccountDeletionScope): { allowed: boolean; reason: string | null } => {
      if (!preview) return { allowed: false, reason: null };
      if (s === 'chat') return { allowed: preview.chat.allowed, reason: preview.chat.reason ?? null };
      if (s === 'business') return { allowed: preview.business.allowed, reason: preview.business.reason ?? null };
      const allowed = preview.chat.allowed && preview.business.allowed;
      return { allowed, reason: preview.business.reason ?? preview.chat.reason ?? null };
    },
    [preview],
  );

  const consequences = useMemo(() => {
    if (!preview || !scope) return [] as string[];
    const chat = [
      `${count(preview.chat.conversationCount, 'conversation', 'conversations')} and every message you sent, with their photos, files and voice notes`,
      `Your chat identity, contacts you matched, blocks and chat settings`,
      `${count(preview.chat.statusCount, 'status update', 'status updates')}`,
    ];
    const business: string[] = [];
    for (const shop of preview.business.ownedShops) {
      business.push(
        `${shop.businessName}: ${count(shop.repairCount, 'repair', 'repairs')}, ${count(shop.customerCount, 'customer', 'customers')}, khata, inventory, purchases, finance, staff and dealer records` +
          (shop.otherMemberCount > 0
            ? ` — ${count(shop.otherMemberCount, 'other member loses', 'other members lose')} access to this business`
            : ''),
      );
    }
    if (preview.business.membershipCount > 0) {
      business.push(
        `Your membership in ${count(preview.business.membershipCount, 'other business', 'other businesses')} (their records stay with them)`,
      );
    }
    if (preview.business.dealerPortalLinked) business.push('Your dealer portal link');
    if (business.length === 0) business.push('Your business role, workspace and permissions');
    if (scope === 'chat') return chat;
    if (scope === 'business') return business;
    return [...chat, ...business, 'Your Avarpus login itself — signing in again with this number creates a brand-new account with nothing in it'];
  }, [preview, scope]);

  const reset = () => {
    setStep('select');
    setAcknowledged(false);
    setCode('');
    setSentTo(null);
    setStepError(null);
    setFailure(null);
  };

  const requestCode = async () => {
    if (!scope || busy) return;
    setBusy(true);
    setStepError(null);
    try {
      const res = await accountDeletionRequestOtp({ scope });
      setSentTo(res.verificationTarget);
      setCode('');
      setStep('otp');
    } catch (err) {
      setStepError(errorMessage(err, 'Could not send the verification code. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const confirmDeletion = async () => {
    if (!scope || busy) return;
    const trimmed = code.trim();
    if (trimmed.length < 4) {
      setStepError('Enter the verification code.');
      return;
    }
    setBusy(true);
    setStepError(null);
    // Every session dies with the deletion; keep this screen mounted so the
    // confirmation is shown before the app returns to sign-in.
    const releaseHold = holdSessionUntilLogout();
    try {
      await accountDeletionExecute({ scope, code: trimmed });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep('success');
    } catch (err) {
      releaseHold();
      const status = (err as { status?: number })?.status;
      // Bad or expired code (400) or throttled (429): the account is untouched,
      // stay on this step so a fresh code can be typed.
      if (status === 400 || status === 429) {
        setStepError(errorMessage(err, 'Incorrect or expired code. Please try again.'));
      } else if (typeof status !== 'number' || [408, 502, 503, 504].includes(status)) {
        // The request never got an answer from the API itself (network drop or
        // a gateway timeout). The server may or may not have finished; if it
        // did, the retry comes back unauthenticated and the app returns to
        // sign-in on its own.
        setFailure('We could not confirm whether the deletion finished. Check your connection and retry. If it already went through, you will be asked to sign in again.');
        setStep('error');
      } else {
        setFailure(errorMessage(err, 'Nothing was deleted. Please try again.'));
        setStep('error');
      }
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    // The server has already revoked every session; this clears local state
    // and returns to the login screen.
    await logout();
  };

  const destructive = colors.destructive;

  const renderScopeOption = (s: AccountDeletionScope, title: string, sub: string, icon: React.ComponentProps<typeof Feather>['name']) => {
    const { allowed, reason } = scopeAllowed(s);
    const selected = scope === s;
    return (
      <TouchableOpacity
        key={s}
        onPress={() => {
          if (!allowed) return;
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          setScope(s);
        }}
        disabled={!allowed}
        activeOpacity={0.8}
        accessibilityRole="radio"
        accessibilityState={{ selected, disabled: !allowed }}
        style={[
          styles.option,
          {
            borderColor: selected ? destructive : colors.border,
            backgroundColor: selected ? destructive + '0D' : colors.card,
            opacity: allowed ? 1 : 0.55,
          },
        ]}
      >
        <View style={[styles.radio, { borderColor: selected ? destructive : colors.mutedForeground }]}>
          {selected && <View style={[styles.radioDot, { backgroundColor: destructive }]} />}
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.optionTitleRow}>
            <Feather name={icon} size={16} color={selected ? destructive : colors.foreground} />
            <Text style={[styles.optionTitle, { color: colors.foreground }]}>{title}</Text>
          </View>
          <Text style={[styles.optionSub, { color: colors.mutedForeground }]}>{sub}</Text>
          {!allowed && reason ? (
            <Text style={[styles.optionSub, { color: destructive }]}>{reason}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const body = () => {
    if (step === 'success') {
      return (
        <Card>
          <View style={styles.centered}>
            <View style={[styles.bigIcon, { backgroundColor: colors.success + '15' }]}>
              <Feather name="check-circle" size={34} color={colors.success} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Account Deleted</Text>
            <Text style={[styles.desc, { color: colors.mutedForeground, textAlign: 'center' }]}>
              {scope === 'both'
                ? 'Your Chat Account and Business Account have been permanently deleted. You have been signed out on every device.'
                : `Your ${SCOPE_LABEL[scope ?? 'chat']} has been permanently deleted. You have been signed out on every device and can sign in again with your mobile number.`}
            </Text>
            <Button title="Back to Sign In" onPress={finish} fullWidth size="lg" />
          </View>
        </Card>
      );
    }

    if (step === 'error') {
      return (
        <Card>
          <View style={styles.centered}>
            <View style={[styles.bigIcon, { backgroundColor: destructive + '15' }]}>
              <Feather name="alert-triangle" size={34} color={destructive} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Deletion could not be completed.</Text>
            <Text style={[styles.desc, { color: colors.mutedForeground, textAlign: 'center' }]}>
              {failure}
            </Text>
            <Button title="Retry" onPress={() => { setFailure(null); setStepError(null); setCode(''); setStep('confirm'); }} fullWidth size="lg" variant="destructive" />
            <Button title="Cancel" onPress={() => router.back()} fullWidth variant="ghost" />
          </View>
        </Card>
      );
    }

    if (step === 'select') {
      return (
        <>
          <Card>
            <Text style={[styles.desc, { color: colors.mutedForeground }]}>
              Choose what to permanently delete. Deletion is immediate, cannot be undone, and nothing can be restored afterwards.
            </Text>
            {previewError ? (
              <View style={styles.inlineError}>
                <Text style={[styles.errorText, { color: destructive }]}>{previewError}</Text>
                <Button title="Try again" onPress={loadPreview} variant="outline" />
              </View>
            ) : !preview ? (
              <View style={styles.centered}><AvarpusSpinner size={size.headerIcon} /></View>
            ) : (
              <View style={styles.options}>
                {renderScopeOption('chat', 'Delete Chat Account', 'Conversations, messages you sent, statuses, chat contacts and settings. Your business data stays.', 'message-circle')}
                {renderScopeOption('business', 'Delete Business Account', 'Businesses you own with all their repairs, customers, khata, inventory and staff. Your chats stay.', 'briefcase')}
                {renderScopeOption('both', 'Delete Both Accounts', 'Everything above plus your Avarpus login. Signing in again with this number starts from zero.', 'user-x')}
              </View>
            )}
          </Card>
          <Button
            title="Continue"
            onPress={() => { setAcknowledged(false); setStep('warning'); }}
            disabled={!scope || !preview}
            fullWidth
            size="lg"
            variant="destructive"
          />
        </>
      );
    }

    if (step === 'warning') {
      return (
        <>
          <Card>
            <View style={styles.warnHeader}>
              <Feather name="alert-triangle" size={20} color={destructive} />
              <Text style={[styles.title, { color: destructive }]}>
                {scope === 'both'
                  ? 'This will permanently delete both of your accounts'
                  : `This will permanently delete your ${SCOPE_LABEL[scope ?? 'chat']}`}
              </Text>
            </View>
            <Text style={[styles.desc, { color: colors.mutedForeground }]}>
              The following will be erased from Avarpus servers right away. It cannot be recovered by you or by Avarpus support.
            </Text>
            <View style={styles.bullets}>
              {consequences.map((line, i) => (
                <View key={i} style={styles.bullet}>
                  <Feather name="x-circle" size={14} color={destructive} style={{ marginTop: 3 }} />
                  <Text style={[styles.bulletText, { color: colors.foreground }]}>{line}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.desc, { color: colors.mutedForeground }]}>
              You will be signed out on every device. Other people keep their own copies of conversations they had with you.
            </Text>
          </Card>
          <Button title="I understand, continue" onPress={() => setStep('confirm')} fullWidth size="lg" variant="destructive" />
          <Button title="Cancel" onPress={() => router.back()} fullWidth variant="ghost" />
        </>
      );
    }

    if (step === 'confirm') {
      return (
        <>
          <Card>
            <Text style={[styles.title, { color: colors.foreground }]}>Final confirmation</Text>
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
                setAcknowledged((v) => !v);
              }}
              activeOpacity={0.8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acknowledged }}
              style={styles.checkRow}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: acknowledged ? destructive : colors.mutedForeground,
                    backgroundColor: acknowledged ? destructive : 'transparent',
                  },
                ]}
              >
                {acknowledged && <Feather name="check" size={14} color="#FFFFFF" />}
              </View>
              <Text style={[styles.checkText, { color: colors.foreground }]}>
                I understand this action is permanent and cannot be undone.
              </Text>
            </TouchableOpacity>
            <Text style={[styles.desc, { color: colors.mutedForeground }]}>
              To confirm it is really you, a one-time code will be sent to the mobile number on this account.
            </Text>
            {stepError ? (
              <Text style={[styles.errorText, { color: destructive }]}>{stepError}</Text>
            ) : null}
          </Card>
          <Button
            title={DELETE_BUTTON[scope ?? 'chat']}
            onPress={requestCode}
            disabled={!acknowledged}
            loading={busy}
            fullWidth
            size="lg"
            variant="destructive"
            textStyle={styles.deleteButtonText}
          />
          <Button title="Cancel" onPress={() => router.back()} fullWidth variant="ghost" />
        </>
      );
    }

    // otp
    return (
      <>
        <Card>
          <Text style={[styles.title, { color: colors.foreground }]}>Enter verification code</Text>
          <Text style={[styles.desc, { color: colors.mutedForeground }]}>
            {sentTo ? `A code was sent to ${sentTo}.` : 'A code was sent to your registered mobile number.'} Entering it deletes your {SCOPE_LABEL[scope ?? 'chat']} immediately.
          </Text>
          <Input
            label="Verification code"
            value={code}
            onChangeText={(t) => { setCode(t.replace(/[^0-9]/g, '')); setStepError(null); }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={8}
            placeholder="6-digit code"
            error={stepError ?? undefined}
            editable={!busy}
          />
          <TouchableOpacity onPress={requestCode} disabled={busy} style={styles.resend}>
            <Text style={[styles.resendText, { color: colors.primary }]}>Resend code</Text>
          </TouchableOpacity>
        </Card>
        <Button
          title={DELETE_BUTTON[scope ?? 'chat']}
          onPress={confirmDeletion}
          disabled={code.trim().length < 4}
          loading={busy}
          fullWidth
          size="lg"
          variant="destructive"
          textStyle={styles.deleteButtonText}
        />
        <Button title="Cancel" onPress={() => router.back()} fullWidth variant="ghost" disabled={busy} />
      </>
    );
  };

  const canGoBack = step !== 'success' && !busy;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => {
            if (!canGoBack) return;
            if (step === 'select' || step === 'error') router.back();
            else if (step === 'warning') reset();
            else if (step === 'confirm') setStep('warning');
            else setStep('confirm');
          }}
          disabled={!canGoBack}
          style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22', opacity: canGoBack ? 1 : 0.4 }]}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Delete Account</Text>
        <View style={{ width: size.iconButton }} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {body()}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: layout.headerHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingBottom: space.md },
  backBtn: { width: size.iconButton, height: size.iconButton, borderRadius: size.iconButton / 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  scroll: { paddingHorizontal: layout.screenPadding, paddingTop: space.lg, gap: space.md },
  title: { ...font.heading, marginBottom: space.sm, flexShrink: 1 },
  desc: { ...font.caption, marginBottom: space.sm },
  options: { gap: 10, marginTop: 6 },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionTitle: { ...font.bodyStrong },
  optionSub: { ...font.caption, marginTop: space.xs },
  warnHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  bullets: { gap: 8, marginBottom: 12 },
  bullet: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletText: { flex: 1, ...font.caption },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, marginBottom: 8 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  checkText: { flex: 1, ...font.body },
  centered: { alignItems: 'center', gap: 12, paddingVertical: 12, width: '100%' },
  bigIcon: { width: size.fab, height: size.fab, borderRadius: size.fab / 2, alignItems: 'center', justifyContent: 'center' },
  inlineError: { gap: 10, marginTop: 4 },
  errorText: { ...font.caption },
  resend: { alignSelf: 'flex-start', paddingVertical: 8 },
  resendText: { ...font.captionStrong },
  deleteButtonText: { ...font.button, letterSpacing: 0.3 },
});
