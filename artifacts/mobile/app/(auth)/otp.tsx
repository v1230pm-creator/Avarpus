import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { authMeUpdate, authOtpResend, getChatRoomsListQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { completeUnlockSuccess } from '@/utils/appLock';
import { onBlue } from '@/constants/brand';
import { font, fontFamily } from '@/constants/typography';
import { layout, size, space } from '@/constants/spacing';

export default function OTPScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { loginWithOtp, refreshUser } = useAuth();
  const params = useLocalSearchParams<{ mobile?: string; sentTo?: string; rememberMe?: string; setup?: string }>();
  const mobile = typeof params.mobile === 'string' ? params.mobile : '';
  const rememberMe = params.rememberMe === '1';
  const sentTo = params.sentTo ?? '';
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [timer, setTimer] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [needsDisplayName, setNeedsDisplayName] = useState(params.setup === 'display-name');
  const [savingName, setSavingName] = useState(false);
  const refs = useRef<(TextInput | null)[]>([]);

  const colors = useColors();

  // Sign-in runs on one flat brand-blue surface, so this screen uses the
  // shared on-blue tokens rather than the light/dark app theme.
  const theme = {
    bg: onBlue.background,
    card: onBlue.surface,
    border: onBlue.surfaceBorder,
    primary: onBlue.text,
    text: onBlue.text,
    textMuted: onBlue.textMuted,
    inputBg: onBlue.inputBackground,
    danger: onBlue.danger,
    dangerBg: onBlue.noticeBackground,
  };

  useEffect(() => {
    const interval = setInterval(() => setTimer((t) => (t > 0 ? t - 1 : 0)), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleChange = (val: string, idx: number) => {
    const d = val.replace(/\D/g, '');
    if (d.length > 1) {
      const digits = d.split('').slice(0, 6 - idx);
      const next = [...otp];
      digits.forEach((ch, i) => { if (idx + i < 6) next[idx + i] = ch; });
      setOtp(next);
      const nextFocus = Math.min(idx + digits.length, 5);
      refs.current[nextFocus]?.focus();
      return;
    }
    const next = [...otp];
    next[idx] = d;
    setOtp(next);
    if (d && idx < 5) refs.current[idx + 1]?.focus();
  };

  const handleKeyPress = (e: any, idx: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError('');
    const result = await loginWithOtp(mobile, otp.join(''), rememberMe);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Verification failed. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (result.needsDisplayName) {
      setNeedsDisplayName(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    await completeUnlockSuccess();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace('/(tabs)');
  };

  const saveDisplayName = async () => {
    const trimmed = displayName.normalize('NFC').trim();
    if (!trimmed) {
      setError('Please enter a display name.');
      return;
    }
    if (Array.from(trimmed).length > 120) {
      setError('Display name must be 120 characters or fewer.');
      return;
    }
    if (/[\u0000-\u001F\u007F-\u009F\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069<>]/u.test(trimmed)) {
      setError('Display name contains unsupported characters.');
      return;
    }
    setSavingName(true);
    setError('');
    try {
      await authMeUpdate({ name: trimmed });
      await refreshUser();
      await queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() });
      await completeUnlockSuccess();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err?.data?.message ?? err?.response?.data?.message ?? 'Could not save your display name. Please try again.');
    } finally {
      setSavingName(false);
    }
  };

  const handleResend = async () => {
    if (timer > 0) return;
    try {
      await authOtpResend({ mobile });
      setTimer(60);
      setOtp(['', '', '', '', '', '']);
      setError('');
    } catch (err: any) {
      setError(err?.data?.message ?? 'Could not resend OTP. Please try again.');
    }
  };

  const filled = otp.join('').length === 6;

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <KeyboardAwareScrollViewCompat style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.topbar}>
            {!needsDisplayName && (
              <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                <Feather name="arrow-left" size={20} color={theme.text} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.content}>
            <View style={styles.header}>
              <View style={[styles.iconCircle, { backgroundColor: theme.primary + '15' }]}>
                <Feather name={needsDisplayName ? 'user' : 'smartphone'} size={28} color={theme.primary} />
              </View>
              <Text style={[styles.title, { color: theme.text, fontFamily: fontFamily.bold }]}>
                {needsDisplayName ? 'Choose your display name' : 'Verify Your Mobile'}
              </Text>
              <Text style={[styles.subtitle, { color: theme.textMuted, fontFamily: fontFamily.regular }]}>
                {needsDisplayName
                  ? 'This is how you will appear in conversations.'
                  : sentTo
                  ? `Enter the 6-digit code sent to ${sentTo}`
                  : 'Enter the 6-digit code sent to the mobile number'}
              </Text>
            </View>

            {needsDisplayName ? (
              <>
                <TextInput
                  value={displayName}
                  onChangeText={(value) => setDisplayName(value.slice(0, 120))}
                  autoFocus
                  maxLength={120}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={saveDisplayName}
                  placeholder="Your name"
                  placeholderTextColor={theme.textMuted}
                  style={[styles.nameInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg, borderRadius: colors.radius - 2, fontFamily: fontFamily.medium }]}
                />
                <Button title="Continue" onPress={saveDisplayName} loading={savingName} variant="onBlue" fullWidth size="lg" />
              </>
            ) : (
              <>
                <View style={styles.otpRow}>
                  {otp.map((digit, idx) => (
                    <TextInput
                      key={idx}
                      ref={(r) => { refs.current[idx] = r; }}
                      value={digit}
                      onChangeText={(v) => handleChange(v, idx)}
                      onKeyPress={(e) => handleKeyPress(e, idx)}
                      keyboardType="number-pad"
                      maxLength={1}
                      selectTextOnFocus
                      style={[
                        styles.otpCell,
                        {
                          borderColor: digit ? theme.primary : theme.border,
                          color: theme.text,
                          fontFamily: fontFamily.bold,
                          backgroundColor: theme.inputBg,
                          borderRadius: colors.radius - 2,
                        },
                      ]}
                      textAlign="center"
                    />
                  ))}
                </View>

                {!!error && (
                  <View style={[styles.errorBox, { backgroundColor: theme.dangerBg, borderColor: theme.dangerBg }]}>
                    <Feather name="alert-circle" size={14} color={theme.danger} />
                    <Text style={[styles.errorText, { color: theme.danger, fontFamily: fontFamily.regular }]}>{error}</Text>
                  </View>
                )}

                <TouchableOpacity onPress={handleResend} disabled={timer > 0} style={{ alignItems: 'center' }}>
                  <Text style={[styles.resendText, { color: timer > 0 ? theme.textMuted : theme.primary, fontFamily: fontFamily.medium }]}>
                    {timer > 0 ? `Resend OTP in ${timer}s` : 'Resend OTP'}
                  </Text>
                </TouchableOpacity>

                <Button title="Verify & Continue" onPress={handleVerify} loading={loading} disabled={!filled} variant="onBlue" fullWidth size="lg" />
              </>
            )}
            {needsDisplayName && !!error && (
              <View style={[styles.errorBox, { backgroundColor: theme.dangerBg, borderColor: theme.dangerBg }]}>
                <Feather name="alert-circle" size={14} color={theme.danger} />
                <Text style={[styles.errorText, { color: theme.danger, fontFamily: fontFamily.regular }]}>{error}</Text>
              </View>
            )}
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, paddingHorizontal: layout.screenPadding },
  topbar: { minHeight: layout.headerHeight, justifyContent: 'center', marginBottom: space.sm },
  backBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  content: { flex: 1, justifyContent: 'center', gap: space.xxl },
  header: { alignItems: 'center', gap: 8 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  title: { ...font.title },
  subtitle: { ...font.small, textAlign: 'center' },
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  otpCell: { width: 44, minHeight: size.input, ...font.heading, borderWidth: 1 },
  nameInput: { width: '100%', minHeight: size.input, borderWidth: 1, paddingHorizontal: layout.screenPadding, ...font.input },
  resendText: { ...font.smallStrong },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, padding: 12, borderWidth: 1 },
  errorText: { ...font.small, flex: 1 },
});
