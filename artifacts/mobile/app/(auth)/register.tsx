import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { authRegisterStart, authRegisterVerify } from '@workspace/api-client-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { onBlue } from '@/constants/brand';

type Step = 'form' | 'email_otp' | 'success';

function OtpInput({ value, onChange, onBack, inputRef, theme }: {
  value: string[];
  onChange: (val: string, idx: number) => void;
  onBack: (idx: number) => void;
  inputRef: React.MutableRefObject<(TextInput | null)[]>;
  theme: any;
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
            {
              backgroundColor: theme.inputBg,
              color: theme.text,
              borderColor: digit ? theme.primary : theme.border
            },
          ]}
        />
      ))}
    </View>
  );
}

const otpStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  cell: {
    width: 44, height: 52, borderRadius: 8,
    fontSize: 20, fontFamily: 'Inter_700Bold',
    borderWidth: 1,
  },
});

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    info: onBlue.info,
    infoBg: onBlue.noticeBackground,
    success: onBlue.success,
  };

  const [step, setStep] = useState<Step>('form');

  // Form fields
  const [businessName, setBusinessName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
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

  // OTP state
  const [emailOtp, setEmailOtp] = useState(['', '', '', '', '', '']);
  const emailRefs = useRef<(TextInput | null)[]>([]);
  const [emailTimer, setEmailTimer] = useState(60);
  const [emailError, setEmailError] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  useEffect(() => {
    if (step !== 'email_otp') return;
    setEmailTimer(60);
    const t = setInterval(() => setEmailTimer((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [step === 'email_otp']);

  const registerPayload = () => ({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    mobile: mobile.trim(),
    businessName: businessName.trim(),
    gstNumber: gstNumber.trim() || undefined,
    shopAddress: shopAddress.trim(),
  });

  const handleFormNext = async () => {
    const e: Record<string, string> = {};
    if (!businessName.trim()) e.businessName = 'Business name is required';
    if (!name.trim()) e.name = 'Owner name is required';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Valid email is required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = 'Valid 10-digit mobile required';
    if (!shopAddress.trim()) e.shopAddress = 'Shop address is required';
    if (gstNumber.trim() && gstNumber.trim().length !== 15) e.gstNumber = 'GST number must be 15 characters';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setFormLoading(true);
    try {
      await authRegisterStart(registerPayload());
    } catch (err: any) {
      const msg = err?.data?.message ?? 'Could not send OTP. Please try again.';
      setErrors({ email: msg });
      return;
    } finally {
      setFormLoading(false);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setEmailOtp(['', '', '', '', '', '']);
    setEmailError('');
    setStep('email_otp');
    setTimeout(() => emailRefs.current[0]?.focus(), 400);
  };

  const handleOtpChange = (setter: any, refs: any, otp: string[], val: string, idx: number) => {
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

  const handleOtpBack = (setter: any, otp: string[], idx: number) => {
    const next = [...otp];
    next[idx - 1] = '';
    setter(next);
  };

  const handleEmailVerify = async () => {
    const entered = emailOtp.join('');
    if (entered.length < 6) { setEmailError('Enter the 6-digit OTP'); return; }
    setEmailLoading(true);
    try {
      const result = await authRegisterVerify({ email: email.trim().toLowerCase(), code: entered });
    } catch (err: any) {
      setEmailError(err?.data?.message ?? 'Verification failed. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    } finally {
      setEmailLoading(false);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('success');
  };

  const handleResendEmailOtp = async () => {
    if (emailTimer > 0) return;
    try {
      await authRegisterStart(registerPayload());
      setEmailTimer(60);
      setEmailOtp(['', '', '', '', '', '']);
      setEmailError('');
    } catch (err: any) {
      setEmailError(err?.data?.message ?? 'Could not resend OTP. Please try again.');
    }
  };

  return (
    <View style={[gs.root, { backgroundColor: theme.bg }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[gs.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={gs.headerRow}>
          <TouchableOpacity
            onPress={() => {
              if (step === 'form' || step === 'success') router.back();
              else setStep('form');
            }}
            style={gs.backBtn}
          >
            <Feather name="arrow-left" size={20} color={theme.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[gs.title, { color: theme.text, fontFamily: 'Inter_700Bold' }]}>
              Create Dealer Account
            </Text>
            <Text style={[gs.subtitle, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]}>
              Register your shop / business
            </Text>
          </View>
        </View>

        {step === 'form' && (
          <View style={[gs.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Input onBlue label="Business Name" value={businessName} onChangeText={setBusinessName} placeholder="Your shop / business name" leftIcon="briefcase" error={errors.businessName} />
            <Input onBlue label="Owner Name" value={name} onChangeText={setName} placeholder="Owner full name" leftIcon="user" error={errors.name} />
            <Input onBlue label="Email Address" value={email} onChangeText={setEmail} placeholder="name@company.com" keyboardType="email-address" autoCapitalize="none" leftIcon="mail" error={errors.email} />
            <Input onBlue label="Mobile Number" value={mobile} onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" keyboardType="phone-pad" leftIcon="phone" error={errors.mobile} />

            <Input onBlue label="GST Number (Optional)" value={gstNumber} onChangeText={(t) => setGstNumber(t.toUpperCase().slice(0, 15))} placeholder="15-character GSTIN" autoCapitalize="characters" leftIcon="file-text" error={errors.gstNumber} />
            <Input onBlue label="Shop Address" value={shopAddress} onChangeText={setShopAddress} placeholder="Full shop address" leftIcon="map-pin" multiline error={errors.shopAddress} />

            <View style={gs.photoRow}>
              <TouchableOpacity style={[gs.photoBox, { borderColor: theme.border, backgroundColor: theme.inputBg }]} onPress={() => pickImage(setProfilePhoto)} activeOpacity={0.8}>
                {profilePhoto ? <Image source={{ uri: profilePhoto }} style={gs.photoImg} contentFit="cover" /> : <Feather name="user" size={20} color={theme.textMuted} />}
                <Text style={[gs.photoLabel, { color: theme.textMuted, fontFamily: 'Inter_500Medium' }]}>Profile Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[gs.photoBox, { borderColor: theme.border, backgroundColor: theme.inputBg }]} onPress={() => pickImage(setCompanyLogo)} activeOpacity={0.8}>
                {companyLogo ? <Image source={{ uri: companyLogo }} style={gs.photoImg} contentFit="cover" /> : <Feather name="image" size={20} color={theme.textMuted} />}
                <Text style={[gs.photoLabel, { color: theme.textMuted, fontFamily: 'Inter_500Medium' }]}>Company Logo</Text>
              </TouchableOpacity>
            </View>

            <View style={[gs.infoBox, { backgroundColor: theme.infoBg, borderColor: theme.infoBg }]}>
              <Feather name="info" size={14} color={theme.info} />
              <Text style={[gs.infoText, { color: theme.info, fontFamily: 'Inter_400Regular' }]}>
                We'll send a 6-digit OTP to your email to verify your identity. Your account is created as the shop owner (Dealer).
              </Text>
            </View>

            <Button title="Send OTP & Continue" onPress={handleFormNext} loading={formLoading} variant="onBlue" fullWidth size="lg" />
          </View>
        )}

        {step === 'email_otp' && (
          <View style={[gs.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={gs.otpHeader}>
              <View style={[gs.otpIconWrap, { backgroundColor: theme.primary + '15', borderColor: theme.primary + '30' }]}>
                <Feather name="mail" size={24} color={theme.primary} />
              </View>
              <Text style={[gs.otpTitle, { color: theme.text, fontFamily: 'Inter_700Bold' }]}>Verify Email</Text>
              <Text style={[gs.otpSub, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]}>
                Enter the 6-digit OTP sent to <Text style={{ color: theme.text, fontFamily: 'Inter_600SemiBold' }}>{email}</Text>
              </Text>
            </View>

            <OtpInput value={emailOtp} onChange={(v, i) => handleOtpChange(setEmailOtp, emailRefs, emailOtp, v, i)} onBack={(i) => handleOtpBack(setEmailOtp, emailOtp, i)} inputRef={emailRefs} theme={theme} />

            {!!emailError && (
              <View style={[gs.errorBox, { backgroundColor: theme.dangerBg, borderColor: theme.dangerBg }]}>
                <Feather name="alert-circle" size={13} color={theme.danger} />
                <Text style={[gs.errorText, { color: theme.danger, fontFamily: 'Inter_400Regular' }]}>{emailError}</Text>
              </View>
            )}

            <TouchableOpacity onPress={handleResendEmailOtp} disabled={emailTimer > 0} style={{ alignItems: 'center' }}>
              <Text style={[gs.timerText, { color: emailTimer > 0 ? theme.textMuted : theme.primary, fontFamily: 'Inter_500Medium' }]}>
                {emailTimer > 0 ? `Resend OTP in ${emailTimer}s` : 'Resend OTP'}
              </Text>
            </TouchableOpacity>

            <Button title="Verify & Create Dealer Account" onPress={handleEmailVerify} loading={emailLoading} disabled={emailOtp.join('').length < 6} variant="onBlue" fullWidth size="lg" />
          </View>
        )}

        {step === 'success' && (
          <View style={[gs.successCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={gs.successIcon}>
              <View style={[gs.successIconGrad, { backgroundColor: theme.success }]}>
                <Feather name="check" size={32} color={onBlue.controlText} />
              </View>
            </View>
            <Text style={[gs.successTitle, { color: theme.text, fontFamily: 'Inter_700Bold' }]}>
              Account created
            </Text>
            <Text style={[gs.successSub, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]}>
              Your dealer account and shop workspace are ready. Sign in with a mobile verification code to continue.
            </Text>

            <View style={gs.successSteps}>
              {[
                { icon: 'mail', color: theme.primary, label: 'Email verified' },
                { icon: 'briefcase', color: theme.primary, label: 'Shop workspace created' },
                { icon: 'smartphone', color: theme.success, label: 'Mobile OTP sign-in ready' },
              ].map((item, i) => (
                <View key={i} style={gs.successStep}>
                  <View style={[gs.successStepDot, { backgroundColor: item.color + '22' }]}>
                    <Feather name={item.icon as any} size={12} color={item.color} />
                  </View>
                  <Text style={[gs.successStepText, { color: theme.text, fontFamily: 'Inter_400Regular' }]}>{item.label}</Text>
                </View>
              ))}
            </View>

            <Button title="Sign in with mobile OTP" onPress={() => router.replace('/(auth)/phone')} variant="onBlue" fullWidth size="lg" />
          </View>
        )}

        {step === 'form' && (
          <TouchableOpacity onPress={() => router.back()} style={{ alignItems: 'center' }}>
            <Text style={[gs.loginLink, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]}>
              Already have an account? <Text style={{ color: theme.primary, fontFamily: 'Inter_600SemiBold' }}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const gs = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  title: { fontSize: 24, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, marginTop: 2 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 12 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 8, padding: 10, borderWidth: 1 },
  infoText: { fontSize: 12, flex: 1, lineHeight: 16 },
  photoRow: { flexDirection: 'row', gap: 8 },
  photoBox: { flex: 1, height: 76, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4, overflow: 'hidden' },
  photoImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 20 },
  photoLabel: { fontSize: 11, position: 'absolute', bottom: 4 },
  otpHeader: { alignItems: 'center', gap: 4 },
  otpIconWrap: { width: 56, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 4 },
  otpTitle: { fontSize: 20 },
  otpSub: { fontSize: 13, textAlign: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, padding: 10, borderWidth: 1 },
  errorText: { fontSize: 12, flex: 1 },
  timerText: { fontSize: 13 },
  successCard: { borderRadius: 12, borderWidth: 1, padding: 20, gap: 12, alignItems: 'center' },
  successIcon: { marginBottom: 4 },
  successIconGrad: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 20 },
  successSub: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  successSteps: { width: '100%', gap: 10, marginVertical: 8 },
  successStep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  successStepDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  successStepText: { fontSize: 13 },
  loginLink: { fontSize: 13 },
});
