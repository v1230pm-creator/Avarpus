import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { authForgotRequest, authForgotReset, authForgotVerify } from '@workspace/api-client-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';

type Step = 'email' | 'otp' | 'reset' | 'done';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const refs = useRef<(TextInput | null)[]>([]);
  const [timer, setTimer] = useState(60);

  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [resetToken, setResetToken] = useState('');

  useEffect(() => {
    if (step !== 'otp') return;
    setTimer(60);
    const t = setInterval(() => setTimer((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [step === 'otp']);

  const handleSendOtp = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    setLoading(true);
    try {
      await authForgotRequest({ email: email.trim().toLowerCase() });
    } catch (err: any) {
      setError(err?.data?.message ?? 'Could not send OTP. Please try again.');
      setLoading(false);
      return;
    }
    setLoading(false);
    setError('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOtp(['', '', '', '', '', '']);
    setStep('otp');
    setTimeout(() => refs.current[0]?.focus(), 350);
  };

  const handleOtpChange = (val: string, idx: number) => {
    const d = val.replace(/\D/g, '');
    if (d.length > 1) {
      const digits = d.split('').slice(0, 6 - idx);
      const next = [...otp];
      digits.forEach((ch, i) => { if (idx + i < 6) next[idx + i] = ch; });
      setOtp(next);
      refs.current[Math.min(idx + digits.length, 5)]?.focus();
      return;
    }
    const next = [...otp];
    next[idx] = d;
    setOtp(next);
    if (d && idx < 5) refs.current[idx + 1]?.focus();
  };

  const handleVerifyOtp = async () => {
    const entered = otp.join('');
    if (entered.length < 6) { setError('Enter the 6-digit OTP'); return; }
    setLoading(true);
    try {
      const res = await authForgotVerify({ email: email.trim().toLowerCase(), code: entered });
      setResetToken(res.resetToken);
    } catch (err: any) {
      setError(err?.data?.message ?? 'Incorrect OTP. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setLoading(false);
      return;
    }
    setLoading(false);
    setError('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('reset');
  };

  const validatePassword = (p: string) => {
    if (p.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(p)) return 'Include at least one uppercase letter';
    if (!/[a-z]/.test(p)) return 'Include at least one lowercase letter';
    if (!/[0-9]/.test(p)) return 'Include at least one number';
    return '';
  };

  const handleReset = async () => {
    const pErr = validatePassword(newPass);
    if (pErr) { setError(pErr); return; }
    if (newPass !== confirmPass) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      await authForgotReset({
        email: email.trim().toLowerCase(),
        resetToken,
        newPassword: newPass,
      });
    } catch (err: any) {
      setError(err?.data?.message ?? 'Could not reset password. Please try again.');
      setLoading(false);
      return;
    }
    setLoading(false);
    setError('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('done');
  };

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <View>
            <Text style={[s.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Forgot Password</Text>
            <Text style={[s.subtitle, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>Reset your account password</Text>
          </View>
        </View>

        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {step === 'email' && (
            <>
              <View style={[s.iconWrap, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
                <Feather name="key" size={28} color={colors.primary} />
              </View>
              <Text style={[s.cardTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Enter Your Email</Text>
              <Text style={[s.cardSub, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
                We'll send a 6-digit OTP to your registered email to reset your password.
              </Text>
              <Input label="Email Address" value={email} onChangeText={(t) => { setEmail(t); setError(''); }}
                placeholder="name@company.com" keyboardType="email-address"
                autoCapitalize="none" leftIcon="mail" error={error} />
              <Button title="Send OTP" onPress={handleSendOtp} loading={loading} fullWidth size="lg" />
            </>
          )}

          {step === 'otp' && (
            <>
              <View style={[s.iconWrap, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
                <Feather name="shield" size={28} color={colors.primary} />
              </View>
              <Text style={[s.cardTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Verify OTP</Text>
              <Text style={[s.cardSub, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
                Enter the 6-digit OTP sent to <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>{email}</Text>
              </Text>

              <View style={s.otpRow}>
                {otp.map((digit, idx) => (
                  <TextInput
                    key={idx}
                    ref={(r) => { refs.current[idx] = r; }}
                    value={digit}
                    onChangeText={(v) => handleOtpChange(v, idx)}
                    onKeyPress={(e) => {
                      if (e.nativeEvent.key === 'Backspace' && !digit && idx > 0) refs.current[idx - 1]?.focus();
                    }}
                    keyboardType="number-pad"
                    maxLength={1}
                    selectTextOnFocus
                    textAlign="center"
                    style={[s.otpCell, { backgroundColor: colors.input, color: colors.foreground, borderColor: digit ? colors.primary : colors.border }]}
                  />
                ))}
              </View>

              {!!error && (
                <View style={[s.errorBox, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '30' }]}>
                  <Feather name="alert-circle" size={13} color={colors.destructive} />
                  <Text style={[s.errorText, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>{error}</Text>
                </View>
              )}

              <TouchableOpacity
                onPress={async () => {
                  if (timer > 0) return;
                  try {
                    await authForgotRequest({ email: email.trim().toLowerCase() });
                    setTimer(60);
                    setOtp(['', '', '', '', '', '']);
                    setError('');
                  } catch (err: any) {
                    setError(err?.data?.message ?? 'Could not resend OTP.');
                  }
                }}
                disabled={timer > 0}
                style={{ alignItems: 'center' }}
              >
                <Text style={[s.timerText, { color: timer > 0 ? colors.textMuted : colors.primary, fontFamily: 'Inter_500Medium' }]}>
                  {timer > 0 ? `Resend OTP in ${timer}s` : 'Resend OTP'}
                </Text>
              </TouchableOpacity>

              <Button title="Verify OTP" onPress={handleVerifyOtp} loading={loading}
                disabled={otp.join('').length < 6} fullWidth size="lg" />
            </>
          )}

          {step === 'reset' && (
            <>
              <View style={[s.iconWrap, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
                <Feather name="lock" size={28} color={colors.primary} />
              </View>
              <Text style={[s.cardTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Set New Password</Text>
              <Text style={[s.cardSub, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
                Use 8+ characters with uppercase, lowercase and a number.
              </Text>
              <Input label="New Password" value={newPass} onChangeText={(t) => { setNewPass(t); setError(''); }}
                placeholder="New password" isPassword leftIcon="lock" />
              <Input label="Confirm Password" value={confirmPass} onChangeText={(t) => { setConfirmPass(t); setError(''); }}
                placeholder="Re-enter new password" isPassword leftIcon="lock" error={error} />
              <Button title="Reset Password" onPress={handleReset} loading={loading} fullWidth size="lg" />
            </>
          )}

          {step === 'done' && (
            <>
              <View style={[s.iconWrap, { backgroundColor: colors.success + '15', borderColor: colors.success + '30' }]}>
                <Feather name="check-circle" size={30} color={colors.success} />
              </View>
              <Text style={[s.cardTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Password Reset!</Text>
              <Text style={[s.cardSub, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
                Your password has been updated successfully. Sign in with your new password.
              </Text>
              <Button title="Back to Sign In" onPress={() => router.replace('/(auth)')} fullWidth size="lg" />
            </>
          )}
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 20, flexGrow: 1, justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  title: { fontSize: 24 },
  subtitle: { fontSize: 14, marginTop: 2 },
  card: { borderRadius: 16, borderWidth: 1, padding: 24, gap: 16, alignItems: 'stretch' },
  iconWrap: { width: 64, height: 64, borderRadius: 16, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  cardTitle: { fontSize: 22, textAlign: 'center' },
  cardSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  otpCell: { width: 48, height: 58, borderRadius: 12, fontSize: 22, fontFamily: 'Inter_700Bold', borderWidth: 1.5 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 12, borderWidth: 1 },
  errorText: { fontSize: 13, flex: 1 },
  timerText: { fontSize: 14 },
});
