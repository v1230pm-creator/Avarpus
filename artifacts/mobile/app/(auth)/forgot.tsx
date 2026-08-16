import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  authForgotRequest,
  authForgotReset,
  authForgotVerify,
} from '@workspace/api-client-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

type Step = 'email' | 'otp' | 'reset' | 'done';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

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

  const cardY = useSharedValue(28);
  const cardOp = useSharedValue(0);

  useEffect(() => {
    cardY.value = withSpring(0, { damping: 20, stiffness: 140 });
    cardOp.value = withTiming(1, { duration: 450 });
  }, []);

  const animateIn = () => {
    cardY.value = 22;
    cardOp.value = 0;
    cardY.value = withSpring(0, { damping: 20, stiffness: 140 });
    cardOp.value = withTiming(1, { duration: 380 });
  };

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardY.value }],
    opacity: cardOp.value,
  }));

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
      return;
    } finally {
      setLoading(false);
    }
    setError('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOtp(['', '', '', '', '', '']);
    setStep('otp');
    animateIn();
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
      return;
    } finally {
      setLoading(false);
    }
    setError('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('reset');
    animateIn();
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
      return;
    } finally {
      setLoading(false);
    }
    setError('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('done');
    animateIn();
  };

  return (
    <LinearGradient colors={['#0B0F1A', '#0E1422']} style={{ flex: 1 }}>
      <View style={[s.glow, { top: -80, left: -60, width: 240, height: 240, backgroundColor: '#3A8FF7' }]} />
              <KeyboardAwareScrollViewCompat
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Feather name="arrow-left" size={22} color="#F5F7FA" />
            </TouchableOpacity>
            <View>
              <Text style={[s.title, { fontFamily: 'Inter_700Bold' }]}>Forgot Password</Text>
              <Text style={[s.subtitle, { fontFamily: 'Inter_400Regular' }]}>Reset your account password</Text>
            </View>
          </View>

          <Reanimated.View style={[s.card, cardStyle]}>
            {/* Step: email */}
            {step === 'email' && (
              <>
                <View style={s.iconWrap}>
                  <Feather name="key" size={28} color="#3A8FF7" />
                </View>
                <Text style={[s.cardTitle, { fontFamily: 'Inter_700Bold' }]}>Enter Your Email</Text>
                <Text style={[s.cardSub, { fontFamily: 'Inter_400Regular' }]}>
                  We'll send a 6-digit OTP to your registered email to reset your password.
                </Text>
                <Input dark label="Email Address" value={email} onChangeText={(t) => { setEmail(t); setError(''); }}
                  placeholder="name@company.com" keyboardType="email-address"
                  autoCapitalize="none" leftIcon="mail" error={error} />
                <Button title="Send OTP" onPress={handleSendOtp} loading={loading} fullWidth size="lg" />
              </>
            )}

            {/* Step: otp */}
            {step === 'otp' && (
              <>
                <View style={s.iconWrap}>
                  <Feather name="shield" size={28} color="#3A8FF7" />
                </View>
                <Text style={[s.cardTitle, { fontFamily: 'Inter_700Bold' }]}>Verify OTP</Text>
                <Text style={[s.cardSub, { fontFamily: 'Inter_400Regular' }]}>
                  Enter the 6-digit OTP sent to{' '}
                  <Text style={{ color: '#4DA3FF', fontFamily: 'Inter_600SemiBold' }}>{email}</Text>
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
                      style={[s.otpCell, digit ? s.otpCellFilled : null]}
                    />
                  ))}
                </View>

                {!!error && (
                  <View style={s.errorBox}>
                    <Feather name="alert-circle" size={13} color="#EF4444" />
                    <Text style={[s.errorText, { fontFamily: 'Inter_400Regular' }]}>{error}</Text>
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
                  <Text style={[s.timerText, { color: timer > 0 ? '#7F8BA3' : '#4DA3FF', fontFamily: 'Inter_500Medium' }]}>
                    {timer > 0 ? `Resend OTP in ${timer}s` : 'Resend OTP'}
                  </Text>
                </TouchableOpacity>

                <Button title="Verify OTP" onPress={handleVerifyOtp} loading={loading}
                  disabled={otp.join('').length < 6} fullWidth size="lg" />
              </>
            )}

            {/* Step: reset */}
            {step === 'reset' && (
              <>
                <View style={s.iconWrap}>
                  <Feather name="lock" size={28} color="#3A8FF7" />
                </View>
                <Text style={[s.cardTitle, { fontFamily: 'Inter_700Bold' }]}>Set New Password</Text>
                <Text style={[s.cardSub, { fontFamily: 'Inter_400Regular' }]}>
                  Use 8+ characters with uppercase, lowercase and a number.
                </Text>
                <Input dark label="New Password" value={newPass} onChangeText={(t) => { setNewPass(t); setError(''); }}
                  placeholder="New password" isPassword leftIcon="lock" />
                <Input dark label="Confirm Password" value={confirmPass} onChangeText={(t) => { setConfirmPass(t); setError(''); }}
                  placeholder="Re-enter new password" isPassword leftIcon="lock" error={error} />
                <Button title="Reset Password" onPress={handleReset} loading={loading} fullWidth size="lg" />
              </>
            )}

            {/* Step: done */}
            {step === 'done' && (
              <>
                <View style={[s.iconWrap, { backgroundColor: 'rgba(52, 211, 153, 0.09)', borderColor: 'rgba(52, 211, 153, 0.09)' }]}>
                  <Feather name="check-circle" size={30} color="#34D399" />
                </View>
                <Text style={[s.cardTitle, { fontFamily: 'Inter_700Bold' }]}>Password Reset!</Text>
                <Text style={[s.cardSub, { fontFamily: 'Inter_400Regular' }]}>
                  Your password has been updated successfully. Sign in with your new password.
                </Text>
                <Button title="Back to Sign In" onPress={() => router.replace('/(auth)')} fullWidth size="lg" />
              </>
            )}
          </Reanimated.View>
        </KeyboardAwareScrollViewCompat>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  glow: { position: 'absolute', borderRadius: 999, opacity: 0.04 },
  scroll: { paddingHorizontal: 24, gap: 20, flexGrow: 1, justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, color: '#F5F7FA' },
  subtitle: { fontSize: 13, color: '#A8B3C7' },

  card: {
    backgroundColor: 'rgba(20, 30, 48, 0.58)', borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', padding: 24, gap: 14,
    alignItems: 'stretch',
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: 20, alignSelf: 'center',
    backgroundColor: 'rgba(47, 128, 237, 0.10)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  cardTitle: { fontSize: 20, color: '#F5F7FA', textAlign: 'center' },
  cardSub: { fontSize: 13, color: '#A8B3C7', textAlign: 'center', lineHeight: 20 },

  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  otpCell: {
    width: 44, height: 54, borderRadius: 12,
    fontSize: 20, fontFamily: 'Inter_700Bold',
    color: '#F5F7FA', backgroundColor: 'rgba(17, 27, 45, 0.68)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.10)',
  },
  otpCellFilled: { borderColor: '#3A8FF7', backgroundColor: 'rgba(20, 30, 48, 0.58)' },

  demoHint: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: 'rgba(47, 128, 237, 0.05)', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: 'rgba(47, 128, 237, 0.16)',
  },
  demoHintText: { fontSize: 12, color: '#A8B3C7' },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.10)', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.16)',
  },
  errorText: { fontSize: 12, color: '#EF4444', flex: 1 },
  timerText: { fontSize: 13 },
});
