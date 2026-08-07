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
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
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
import { authRegisterStart, authRegisterVerify } from '@workspace/api-client-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 'form' | 'email_otp' | 'success';

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
  const steps = ['Details', 'Email OTP'];
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
  const [businessName, setBusinessName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [profilePhoto, setProfilePhoto] = useState('');
  const [companyLogo, setCompanyLogo] = useState('');

  const pickImage = async (setter: (uri: string) => void) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (!result.canceled && result.assets[0]) setter(result.assets[0].uri);
  };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formLoading, setFormLoading] = useState(false);

  // OTP state – email
  const [emailOtp, setEmailOtp] = useState(['', '', '', '', '', '']);
  const emailRefs = useRef<(TextInput | null)[]>([]);
  const [emailTimer, setEmailTimer] = useState(60);
  const [emailError, setEmailError] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

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

  // ── Step 1: Validate & proceed to email OTP ───────────────────────────────
  const handleFormNext = async () => {
    const e: Record<string, string> = {};
    if (!businessName.trim()) e.businessName = 'Business name is required';
    if (!name.trim()) e.name = 'Owner name is required';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Valid email is required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = 'Valid 10-digit mobile required';
    if (!password || password.length < 8) e.password = 'Min. 8 characters';
    else if (!/[A-Z]/.test(password)) e.password = 'Include an uppercase letter';
    else if (!/[a-z]/.test(password)) e.password = 'Include a lowercase letter';
    else if (!/[0-9]/.test(password)) e.password = 'Include a number';
    if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';
    if (!shopAddress.trim()) e.shopAddress = 'Shop address is required';
    if (gstNumber.trim() && gstNumber.trim().length !== 15) e.gstNumber = 'GST number must be 15 characters';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setFormLoading(true);
    try {
      await authRegisterStart({
        name: name.trim(),
        businessName: businessName.trim(),
        email: email.trim().toLowerCase(),
        mobile: mobile.trim(),
        password,
        gstNumber: gstNumber.trim() || undefined,
        shopAddress: shopAddress.trim(),
      });
    } catch (err: any) {
      setErrors({ email: err?.data?.message ?? 'Could not send OTP. Please try again.' });
      return;
    } finally {
      setFormLoading(false);
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

  // ── Step 2: Verify email OTP & create account ─────────────────────────────
  const handleEmailVerify = async () => {
    const entered = emailOtp.join('');
    if (entered.length < 6) { setEmailError('Enter the 6-digit OTP'); return; }
    setEmailLoading(true);
    try {
      await authRegisterVerify({ email: email.trim().toLowerCase(), code: entered });
    } catch (err: any) {
      setEmailError(err?.data?.message ?? 'Verification failed. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    } finally {
      setEmailLoading(false);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('success');
    animateIn();
  };

  const handleResendEmailOtp = async () => {
    if (emailTimer > 0) return;
    try {
      await authRegisterStart({
        name: name.trim(),
        businessName: businessName.trim(),
        email: email.trim().toLowerCase(),
        mobile: mobile.trim(),
        password,
        gstNumber: gstNumber.trim() || undefined,
        shopAddress: shopAddress.trim(),
      });
      setEmailTimer(60);
      setEmailOtp(['', '', '', '', '', '']);
      setEmailError('');
    } catch (err: any) {
      setEmailError(err?.data?.message ?? 'Could not resend OTP. Please try again.');
    }
  };

  const stepIndex = step === 'form' ? 0 : step === 'email_otp' ? 1 : 2;

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
                else { setStep('form'); animateIn(); }
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
              <Input dark label="Business Name" value={businessName} onChangeText={setBusinessName}
                placeholder="Your shop / business name" leftIcon="briefcase" error={errors.businessName} />
              <Input dark label="Owner Name" value={name} onChangeText={setName}
                placeholder="Owner full name" leftIcon="user" error={errors.name} />
              <Input dark label="Email Address" value={email} onChangeText={setEmail}
                placeholder="name@company.com" keyboardType="email-address"
                autoCapitalize="none" leftIcon="mail" error={errors.email} />
              <Input dark label="Mobile Number" value={mobile}
                onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile" keyboardType="phone-pad"
                leftIcon="phone" error={errors.mobile} />
              <Input dark label="Password" value={password} onChangeText={setPassword}
                placeholder="8+ chars, A-z, 0-9" isPassword leftIcon="lock" error={errors.password} />
              <Input dark label="Confirm Password" value={confirmPassword} onChangeText={setConfirmPassword}
                placeholder="Re-enter password" isPassword leftIcon="lock" error={errors.confirmPassword} />
              <Input dark label="GST Number (Optional)" value={gstNumber}
                onChangeText={(t) => setGstNumber(t.toUpperCase().slice(0, 15))}
                placeholder="15-character GSTIN" autoCapitalize="characters"
                leftIcon="file-text" error={errors.gstNumber} />
              <Input dark label="Shop Address" value={shopAddress} onChangeText={setShopAddress}
                placeholder="Full shop address" leftIcon="map-pin"
                multiline error={errors.shopAddress} />

              {/* Photo uploads */}
              <View style={gs.photoRow}>
                <TouchableOpacity style={gs.photoBox} onPress={() => pickImage(setProfilePhoto)} activeOpacity={0.8}>
                  {profilePhoto ? (
                    <Image source={{ uri: profilePhoto }} style={gs.photoImg} contentFit="cover" />
                  ) : (
                    <Feather name="user" size={22} color="#475569" />
                  )}
                  <Text style={[gs.photoLabel, { fontFamily: 'Inter_500Medium' }]}>Profile Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={gs.photoBox} onPress={() => pickImage(setCompanyLogo)} activeOpacity={0.8}>
                  {companyLogo ? (
                    <Image source={{ uri: companyLogo }} style={gs.photoImg} contentFit="cover" />
                  ) : (
                    <Feather name="image" size={22} color="#475569" />
                  )}
                  <Text style={[gs.photoLabel, { fontFamily: 'Inter_500Medium' }]}>Company Logo</Text>
                </TouchableOpacity>
              </View>

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

              <TouchableOpacity
                onPress={handleResendEmailOtp}
                disabled={emailTimer > 0}
                style={{ alignItems: 'center' }}
              >
                <Text style={[gs.timerText, { color: emailTimer > 0 ? '#475569' : '#60A5FA', fontFamily: 'Inter_500Medium' }]}>
                  {emailTimer > 0 ? `Resend OTP in ${emailTimer}s` : 'Resend OTP'}
                </Text>
              </TouchableOpacity>

              <Button title="Verify & Create Account" onPress={handleEmailVerify}
                loading={emailLoading} disabled={emailOtp.join('').length < 6}
                fullWidth size="lg" />
            </Reanimated.View>
          )}

          {/* ── STEP 3: Success ── */}
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

  photoRow: { flexDirection: 'row', gap: 12 },
  photoBox: {
    flex: 1, height: 96, borderRadius: 14,
    backgroundColor: '#0A1628', borderWidth: 1.5, borderColor: '#1E3A5F66', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 8, overflow: 'hidden',
  },
  photoImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 26 },
  photoLabel: { fontSize: 11, color: '#64748B', position: 'absolute', bottom: 8 },

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
