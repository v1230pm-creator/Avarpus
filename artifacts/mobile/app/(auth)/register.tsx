import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { storage, KEYS } from '@/utils/storage';
import { User } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 'form' | 'email_otp' | 'phone_otp' | 'success';

// ─── Mock OTP (demo – no real sending) ────────────────────────────────────────
const DEMO_OTP = '123456';

// ─── OTP Cell component ───────────────────────────────────────────────────────
function OtpInput({
  value,
  onChange,
  onBack,
  inputRef,
}: {
  value: string[];
  onChange: (val: string, idx: number) => void;
  onBack: (idx: number) => void;
  inputRef: React.MutableRefObject<(TextInput | null)[]>;
}) {
  return (
    <View style={otpStyles.row}>
      {value.map((digit, idx) => (
        <TextInput
          key={idx}
          ref={(r) => { inputRef.current[idx] = r; }}
          value={digit}
          onChangeText={(v) => onChange(v, idx)}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === 'Backspace' && !digit && idx > 0) {
              inputRef.current[idx - 1]?.focus();
              onBack(idx);
            }
          }}
          keyboardType="number-pad"
          maxLength={1}
          selectTextOnFocus
          textAlign="center"
          style={[
            otpStyles.cell,
            digit ? otpStyles.cellFilled : null,
          ]}
        />
      ))}
    </View>
  );
}

const otpStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  cell: {
    width: 48, height: 58, borderRadius: 12,
    fontSize: 22, fontFamily: 'Inter_700Bold',
    color: '#F1F5F9', backgroundColor: '#0A1628',
    borderWidth: 1.5, borderColor: '#1E3A5F66',
  },
  cellFilled: { borderColor: '#2563EB', backgroundColor: '#0D1E3A' },
});

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepBar({ current }: { current: number }) {
  const steps = ['Details', 'Email OTP', 'Phone OTP'];
  return (
    <View style={bar.wrap}>
      {steps.map((label, i) => (
        <React.Fragment key={i}>
          <View style={bar.item}>
            <View style={[bar.dot, current > i && bar.dotDone, current === i && bar.dotActive]}>
              {current > i
                ? <Feather name="check" size={11} color="#FFF" />
                : <Text style={[bar.dotNum, { fontFamily: 'Inter_700Bold' }]}>{i + 1}</Text>
              }
            </View>
            <Text style={[bar.label, current === i && bar.labelActive, { fontFamily: 'Inter_400Regular' }]}>
              {label}
            </Text>
          </View>
          {i < steps.length - 1 && (
            <View style={[bar.line, current > i && bar.lineDone]} />
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

const bar = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  item: { alignItems: 'center', gap: 6 },
  dot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#0A1628', borderWidth: 1.5, borderColor: '#334155',
    alignItems: 'center', justifyContent: 'center',
  },
  dotActive: { borderColor: '#2563EB', backgroundColor: '#1D3A70' },
  dotDone: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  dotNum: { fontSize: 11, color: '#64748B' },
  label: { fontSize: 10, color: '#475569' },
  labelActive: { color: '#60A5FA' },
  line: { flex: 1, height: 1.5, backgroundColor: '#1E3A5F', marginBottom: 18, marginHorizontal: 6 },
  lineDone: { backgroundColor: '#2563EB' },
});

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('form');

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formLoading, setFormLoading] = useState(false);

  // OTP state – email
  const [emailOtp, setEmailOtp] = useState(['', '', '', '', '', '']);
  const emailRefs = useRef<(TextInput | null)[]>([]);
  const [emailTimer, setEmailTimer] = useState(60);
  const [emailError, setEmailError] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  // OTP state – phone
  const [phoneOtp, setPhoneOtp] = useState(['', '', '', '', '', '']);
  const phoneRefs = useRef<(TextInput | null)[]>([]);
  const [phoneTimer, setPhoneTimer] = useState(60);
  const [phoneError, setPhoneError] = useState('');
  const [phoneLoading, setPhoneLoading] = useState(false);

  // Card animation
  const cardY = useSharedValue(32);
  const cardOp = useSharedValue(0);

  useEffect(() => {
    cardY.value = withSpring(0, { damping: 20, stiffness: 140 });
    cardOp.value = withTiming(1, { duration: 500 });
  }, []);

  // Re-animate on step change
  const animateIn = () => {
    cardY.value = 24;
    cardOp.value = 0;
    cardY.value = withSpring(0, { damping: 20, stiffness: 140 });
    cardOp.value = withTiming(1, { duration: 400 });
  };

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardY.value }],
    opacity: cardOp.value,
  }));

  // ── Timers ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'email_otp') return;
    setEmailTimer(60);
    const t = setInterval(() => setEmailTimer((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [step === 'email_otp']);

  useEffect(() => {
    if (step !== 'phone_otp') return;
    setPhoneTimer(60);
    const t = setInterval(() => setPhoneTimer((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [step === 'phone_otp']);

  // ── Step 1: Validate & proceed to email OTP ───────────────────────────────
  const handleFormNext = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Full name is required';
    if (!email.trim() || !email.includes('@')) e.email = 'Valid email is required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = 'Valid 10-digit mobile required';
    if (!password || password.length < 6) e.password = 'Min. 6 characters';
    if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setFormLoading(true);
    const users = (await storage.get<User[]>(KEYS.USERS)) ?? [];
    const exists = users.some((u) => u.email === email.toLowerCase() || u.mobile === mobile);
    setFormLoading(false);

    if (exists) {
      setErrors({ email: 'Account with this email or mobile already exists' });
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setEmailOtp(['', '', '', '', '', '']);
    setEmailError('');
    setStep('email_otp');
    animateIn();
    setTimeout(() => emailRefs.current[0]?.focus(), 400);
  };

  // ── OTP helpers ───────────────────────────────────────────────────────────
  const handleOtpChange = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    refs: React.MutableRefObject<(TextInput | null)[]>,
    otp: string[],
    val: string,
    idx: number,
  ) => {
    const d = val.replace(/\D/g, '');
    if (d.length > 1) {
      const digits = d.split('').slice(0, 6 - idx);
      const next = [...otp];
      digits.forEach((ch, i) => { if (idx + i < 6) next[idx + i] = ch; });
      setter(next);
      refs.current[Math.min(idx + digits.length, 5)]?.focus();
      return;
    }
    const next = [...otp];
    next[idx] = d;
    setter(next);
    if (d && idx < 5) refs.current[idx + 1]?.focus();
  };

  const handleOtpBack = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    otp: string[],
    idx: number,
  ) => {
    const next = [...otp];
    next[idx - 1] = '';
    setter(next);
  };

  // ── Step 2: Verify email OTP ──────────────────────────────────────────────
  const handleEmailVerify = async () => {
    const entered = emailOtp.join('');
    if (entered.length < 6) { setEmailError('Enter the 6-digit OTP'); return; }
    setEmailLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setEmailLoading(false);
    if (entered !== DEMO_OTP) {
      setEmailError('Incorrect OTP. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPhoneOtp(['', '', '', '', '', '']);
    setPhoneError('');
    setStep('phone_otp');
    animateIn();
    setTimeout(() => phoneRefs.current[0]?.focus(), 400);
  };

  // ── Step 3: Verify phone OTP & create account ─────────────────────────────
  const handlePhoneVerify = async () => {
    const entered = phoneOtp.join('');
    if (entered.length < 6) { setPhoneError('Enter the 6-digit OTP'); return; }
    setPhoneLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setPhoneLoading(false);
    if (entered !== DEMO_OTP) {
      setPhoneError('Incorrect OTP. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    // Create account
    const users = (await storage.get<User[]>(KEYS.USERS)) ?? [];
    const newUser: User = {
      id: `u${Date.now()}`,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      mobile: mobile.trim(),
      role: 'reception',
      isActive: false,
      joinDate: new Date().toISOString().split('T')[0],
      designation: 'Staff',
      password,
    };
    await storage.set(KEYS.USERS, [...users, newUser]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('success');
    animateIn();
  };

  const stepIndex = step === 'form' ? 0 : step === 'email_otp' ? 1 : step === 'phone_otp' ? 2 : 3;

  return (
    <LinearGradient colors={['#050912', '#091525', '#030710']} style={{ flex: 1 }}>
      {/* Glow */}
      <View style={[gs.glow, { top: -80, left: -60, width: 240, height: 240, backgroundColor: '#2563EB' }]} />
      <View style={[gs.glow, { bottom: -60, right: -40, width: 180, height: 180, backgroundColor: '#1D4ED8' }]} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[gs.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header row */}
          <View style={gs.headerRow}>
            <TouchableOpacity
              onPress={() => {
                if (step === 'form' || step === 'success') router.back();
                else { setStep(step === 'phone_otp' ? 'email_otp' : 'form'); animateIn(); }
              }}
              style={gs.backBtn}
            >
              <Feather name="arrow-left" size={22} color="#F1F5F9" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[gs.title, { fontFamily: 'Inter_700Bold' }]}>Create Account</Text>
              <Text style={[gs.subtitle, { fontFamily: 'Inter_400Regular' }]}>Request staff access</Text>
            </View>
          </View>

          {/* Step bar */}
          {step !== 'success' && <StepBar current={stepIndex} />}

          {/* ── STEP 1: Form ── */}
          {step === 'form' && (
            <Reanimated.View style={[gs.card, cardStyle]}>
              <Input label="Full Name" value={name} onChangeText={setName}
                placeholder="Your full name" leftIcon="user" error={errors.name} />
              <Input label="Email Address" value={email} onChangeText={setEmail}
                placeholder="name@company.com" keyboardType="email-address"
                autoCapitalize="none" leftIcon="mail" error={errors.email} />
              <Input label="Mobile Number" value={mobile}
                onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile" keyboardType="phone-pad"
                leftIcon="phone" error={errors.mobile} />
              <Input label="Password" value={password} onChangeText={setPassword}
                placeholder="Min. 6 characters" isPassword leftIcon="lock" error={errors.password} />
              <Input label="Confirm Password" value={confirmPassword} onChangeText={setConfirmPassword}
                placeholder="Re-enter password" isPassword leftIcon="lock" error={errors.confirmPassword} />

              <View style={gs.infoBox}>
                <Feather name="info" size={14} color="#60A5FA" />
                <Text style={[gs.infoText, { fontFamily: 'Inter_400Regular' }]}>
                  We'll send a 6-digit OTP to your email and mobile to verify your identity.
                </Text>
              </View>

              <Button title="Send OTP & Continue" onPress={handleFormNext}
                loading={formLoading} fullWidth size="lg" />
            </Reanimated.View>
          )}

          {/* ── STEP 2: Email OTP ── */}
          {step === 'email_otp' && (
            <Reanimated.View style={[gs.card, cardStyle]}>
              <View style={gs.otpHeader}>
                <View style={gs.otpIconWrap}>
                  <Feather name="mail" size={28} color="#3B82F6" />
                </View>
                <Text style={[gs.otpTitle, { fontFamily: 'Inter_700Bold' }]}>Verify Email</Text>
                <Text style={[gs.otpSub, { fontFamily: 'Inter_400Regular' }]}>
                  Enter the 6-digit OTP sent to
                </Text>
                <Text style={[gs.otpTarget, { fontFamily: 'Inter_600SemiBold' }]}>{email}</Text>
              </View>

              <OtpInput
                value={emailOtp}
                onChange={(v, i) => handleOtpChange(setEmailOtp, emailRefs, emailOtp, v, i)}
                onBack={(i) => handleOtpBack(setEmailOtp, emailOtp, i)}
                inputRef={emailRefs}
              />

              {!!emailError && (
                <View style={gs.errorBox}>
                  <Feather name="alert-circle" size={13} color="#F87171" />
                  <Text style={[gs.errorText, { fontFamily: 'Inter_400Regular' }]}>{emailError}</Text>
                </View>
              )}

              {/* Demo hint */}
              <View style={gs.demoHint}>
                <Feather name="zap" size={13} color="#D4AF37" />
                <Text style={[gs.demoHintText, { fontFamily: 'Inter_400Regular' }]}>
                  Demo OTP: <Text style={{ fontFamily: 'Inter_700Bold', color: '#D4AF37' }}>{DEMO_OTP}</Text>
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => { if (emailTimer === 0) { setEmailTimer(60); setEmailOtp(['', '', '', '', '', '']); } }}
                disabled={emailTimer > 0}
                style={{ alignItems: 'center' }}
              >
                <Text style={[gs.timerText, { color: emailTimer > 0 ? '#475569' : '#60A5FA', fontFamily: 'Inter_500Medium' }]}>
                  {emailTimer > 0 ? `Resend OTP in ${emailTimer}s` : 'Resend OTP'}
                </Text>
              </TouchableOpacity>

              <Button title="Verify Email OTP" onPress={handleEmailVerify}
                loading={emailLoading} disabled={emailOtp.join('').length < 6}
                fullWidth size="lg" />
            </Reanimated.View>
          )}

          {/* ── STEP 3: Phone OTP ── */}
          {step === 'phone_otp' && (
            <Reanimated.View style={[gs.card, cardStyle]}>
              <View style={gs.otpHeader}>
                <View style={[gs.otpIconWrap, { backgroundColor: '#1E3A1022' }]}>
                  <Feather name="smartphone" size={28} color="#10B981" />
                </View>
                <Text style={[gs.otpTitle, { fontFamily: 'Inter_700Bold' }]}>Verify Mobile</Text>
                <Text style={[gs.otpSub, { fontFamily: 'Inter_400Regular' }]}>
                  Enter the 6-digit OTP sent to
                </Text>
                <Text style={[gs.otpTarget, { fontFamily: 'Inter_600SemiBold' }]}>+91 {mobile}</Text>
              </View>

              <OtpInput
                value={phoneOtp}
                onChange={(v, i) => handleOtpChange(setPhoneOtp, phoneRefs, phoneOtp, v, i)}
                onBack={(i) => handleOtpBack(setPhoneOtp, phoneOtp, i)}
                inputRef={phoneRefs}
              />

              {!!phoneError && (
                <View style={gs.errorBox}>
                  <Feather name="alert-circle" size={13} color="#F87171" />
                  <Text style={[gs.errorText, { fontFamily: 'Inter_400Regular' }]}>{phoneError}</Text>
                </View>
              )}

              {/* Demo hint */}
              <View style={gs.demoHint}>
                <Feather name="zap" size={13} color="#D4AF37" />
                <Text style={[gs.demoHintText, { fontFamily: 'Inter_400Regular' }]}>
                  Demo OTP: <Text style={{ fontFamily: 'Inter_700Bold', color: '#D4AF37' }}>{DEMO_OTP}</Text>
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => { if (phoneTimer === 0) { setPhoneTimer(60); setPhoneOtp(['', '', '', '', '', '']); } }}
                disabled={phoneTimer > 0}
                style={{ alignItems: 'center' }}
              >
                <Text style={[gs.timerText, { color: phoneTimer > 0 ? '#475569' : '#60A5FA', fontFamily: 'Inter_500Medium' }]}>
                  {phoneTimer > 0 ? `Resend OTP in ${phoneTimer}s` : 'Resend OTP'}
                </Text>
              </TouchableOpacity>

              <Button title="Verify & Create Account" onPress={handlePhoneVerify}
                loading={phoneLoading} disabled={phoneOtp.join('').length < 6}
                fullWidth size="lg" />
            </Reanimated.View>
          )}

          {/* ── STEP 4: Success ── */}
          {step === 'success' && (
            <Reanimated.View style={[gs.successCard, cardStyle]}>
              <LinearGradient
                colors={['#0D1B2E', '#0A1628']}
                style={StyleSheet.absoluteFill}
              />
              <View style={gs.successIcon}>
                <LinearGradient colors={['#059669', '#10B981']} style={gs.successIconGrad}>
                  <Feather name="check" size={36} color="#FFFFFF" />
                </LinearGradient>
              </View>
              <Text style={[gs.successTitle, { fontFamily: 'Inter_700Bold' }]}>Account Created!</Text>
              <Text style={[gs.successSub, { fontFamily: 'Inter_400Regular' }]}>
                Your account has been created successfully. It will be activated after admin approval.
              </Text>

              <View style={gs.successSteps}>
                {[
                  { icon: 'mail', color: '#3B82F6', label: 'Email verified' },
                  { icon: 'smartphone', color: '#10B981', label: 'Mobile verified' },
                  { icon: 'user-check', color: '#D4AF37', label: 'Pending admin approval' },
                ].map((item, i) => (
                  <View key={i} style={gs.successStep}>
                    <View style={[gs.successStepDot, { backgroundColor: item.color + '22' }]}>
                      <Feather name={item.icon as any} size={14} color={item.color} />
                    </View>
                    <Text style={[gs.successStepText, { fontFamily: 'Inter_400Regular' }]}>{item.label}</Text>
                  </View>
                ))}
              </View>

              <TouchableOpacity
                style={gs.goLoginBtn}
                onPress={() => router.replace('/(auth)')}
                activeOpacity={0.8}
              >
                <LinearGradient colors={['#1D4ED8', '#2563EB', '#3B82F6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={gs.goLoginGrad}>
                  <Text style={[gs.goLoginText, { fontFamily: 'Inter_600SemiBold' }]}>Go to Sign In</Text>
                  <Feather name="arrow-right" size={18} color="#FFFFFF" />
                </LinearGradient>
              </TouchableOpacity>
            </Reanimated.View>
          )}

          {step === 'form' && (
            <TouchableOpacity onPress={() => router.back()} style={{ alignItems: 'center' }}>
              <Text style={[gs.loginLink, { fontFamily: 'Inter_400Regular' }]}>
                Already have an account?{' '}
                <Text style={{ color: '#60A5FA', fontFamily: 'Inter_600SemiBold' }}>Sign In</Text>
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const gs = StyleSheet.create({
  glow: { position: 'absolute', borderRadius: 999, opacity: 0.07 },
  scroll: { paddingHorizontal: 24, gap: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, color: '#F1F5F9' },
  subtitle: { fontSize: 13, color: '#64748B' },

  card: {
    backgroundColor: '#0D1B2E', borderRadius: 20,
    borderWidth: 1, borderColor: '#1E3A5F66', padding: 24, gap: 16,
  },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#1E40AF11', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#3B82F622',
  },
  infoText: { fontSize: 12, color: '#93C5FD', flex: 1, lineHeight: 18 },

  // OTP
  otpHeader: { alignItems: 'center', gap: 6 },
  otpIconWrap: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: '#1E3A6E22', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1E3A5F44', marginBottom: 6,
  },
  otpTitle: { fontSize: 20, color: '#F1F5F9' },
  otpSub: { fontSize: 13, color: '#64748B' },
  otpTarget: { fontSize: 14, color: '#93C5FD' },

  demoHint: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: '#1A1200', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#D4AF3733',
  },
  demoHintText: { fontSize: 12, color: '#94A3B8' },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#7F1D1D22', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#EF444433',
  },
  errorText: { fontSize: 12, color: '#F87171', flex: 1 },

  timerText: { fontSize: 13 },
  loginLink: { fontSize: 14, color: '#64748B', textAlign: 'center' },

  // Success
  successCard: {
    borderRadius: 24, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1E3A5F66',
    padding: 32, gap: 18, alignItems: 'center',
  },
  successIcon: { marginBottom: 4 },
  successIconGrad: {
    width: 88, height: 88, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#10B981', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  successTitle: { fontSize: 24, color: '#F1F5F9' },
  successSub: { fontSize: 13, color: '#64748B', textAlign: 'center', lineHeight: 20, maxWidth: 280 },
  successSteps: { width: '100%', gap: 10 },
  successStep: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#080F1D', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#1E3A5F44',
  },
  successStepDot: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  successStepText: { fontSize: 13, color: '#94A3B8' },
  goLoginBtn: { width: '100%', borderRadius: 14, overflow: 'hidden' },
  goLoginGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    height: 54,
    shadowColor: '#2563EB', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
  },
  goLoginText: { fontSize: 16, color: '#FFFFFF' },
});
