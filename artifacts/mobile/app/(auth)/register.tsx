import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

type Step = 'form' | 'email_otp' | 'success';

function OtpInput({ value, onChange, onBack, inputRef }: {
  value: string[];
  onChange: (val: string, idx: number) => void;
  onBack: (idx: number) => void;
  inputRef: React.MutableRefObject<(TextInput | null)[]>;
}) {
  const colors = useColors();
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
              backgroundColor: colors.input,
              color: colors.foreground,
              borderColor: digit ? colors.primary : colors.border
            },
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
    borderWidth: 1.5,
  },
});

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { adoptSession } = useAuth();
  const colors = useColors();

  const [step, setStep] = useState<Step>('form');
  const [accountType, setAccountType] = useState<'dealer' | 'staff'>('dealer');
  const [staffRole, setStaffRole] = useState('technician');
  const [dealerMobile, setDealerMobile] = useState('');
  const [pendingApproval, setPendingApproval] = useState(false);

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
    password,
    ...(accountType === 'dealer'
      ? {
          businessName: businessName.trim(),
          gstNumber: gstNumber.trim() || undefined,
          shopAddress: shopAddress.trim(),
        }
      : {
          role: staffRole as any,
          dealerMobile: dealerMobile.trim(),
        }),
  });

  const handleFormNext = async () => {
    const e: Record<string, string> = {};
    if (accountType === 'dealer' && !businessName.trim()) e.businessName = 'Business name is required';
    if (!name.trim()) e.name = accountType === 'dealer' ? 'Owner name is required' : 'Your name is required';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Valid email is required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = 'Valid 10-digit mobile required';
    if (!password || password.length < 8) e.password = 'Min. 8 characters';
    else if (!/[A-Z]/.test(password)) e.password = 'Include an uppercase letter';
    else if (!/[a-z]/.test(password)) e.password = 'Include a lowercase letter';
    else if (!/[0-9]/.test(password)) e.password = 'Include a number';
    if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';
    if (accountType === 'dealer') {
      if (!shopAddress.trim()) e.shopAddress = 'Shop address is required';
      if (gstNumber.trim() && gstNumber.trim().length !== 15) e.gstNumber = 'GST number must be 15 characters';
    } else {
      if (!dealerMobile.trim() || dealerMobile.trim().length !== 10) e.dealerMobile = "Enter shop owner's 10-digit mobile";
    }
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
      if (result.token && result.user) {
        await adoptSession(result as any);
        setPendingApproval(false);
      } else {
        setPendingApproval(true);
      }
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
    <View style={[gs.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[gs.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 32 }]}
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
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[gs.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {accountType === 'dealer' ? 'Create Dealer Account' : 'Join as Staff'}
            </Text>
            <Text style={[gs.subtitle, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
              {accountType === 'dealer' ? 'Register your shop / business' : "Register to join your shop's team"}
            </Text>
          </View>
        </View>

        {step === 'form' && (
          <View style={[gs.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={gs.roleRow}>
              {[
                { key: 'dealer', icon: 'briefcase', label: 'Shop Owner' },
                { key: 'staff', icon: 'users', label: 'Staff Member' },
              ].map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[gs.roleBtn, { borderColor: colors.border, backgroundColor: accountType === opt.key ? colors.primary + '15' : colors.input }, accountType === opt.key && { borderColor: colors.primary }]}
                  onPress={() => { setAccountType(opt.key as any); setErrors({}); }}
                  activeOpacity={0.8}
                >
                  <Feather name={opt.icon as any} size={15} color={accountType === opt.key ? colors.primary : colors.textMuted} />
                  <Text style={[gs.roleText, { color: accountType === opt.key ? colors.primary : colors.textMuted, fontFamily: 'Inter_600SemiBold' }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {accountType === 'dealer' && (
              <Input label="Business Name" value={businessName} onChangeText={setBusinessName} placeholder="Your shop / business name" leftIcon="briefcase" error={errors.businessName} />
            )}
            <Input label={accountType === 'dealer' ? 'Owner Name' : 'Full Name'} value={name} onChangeText={setName} placeholder={accountType === 'dealer' ? 'Owner full name' : 'Your full name'} leftIcon="user" error={errors.name} />
            <Input label="Email Address" value={email} onChangeText={setEmail} placeholder="name@company.com" keyboardType="email-address" autoCapitalize="none" leftIcon="mail" error={errors.email} />
            <Input label="Mobile Number" value={mobile} onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" keyboardType="phone-pad" leftIcon="phone" error={errors.mobile} />
            <Input label="Password" value={password} onChangeText={setPassword} placeholder="8+ chars, A-z, 0-9" isPassword leftIcon="lock" error={errors.password} />
            <Input label="Confirm Password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Re-enter password" isPassword leftIcon="lock" error={errors.confirmPassword} />

            {accountType === 'dealer' ? (
              <>
                <Input label="GST Number (Optional)" value={gstNumber} onChangeText={(t) => setGstNumber(t.toUpperCase().slice(0, 15))} placeholder="15-character GSTIN" autoCapitalize="characters" leftIcon="file-text" error={errors.gstNumber} />
                <Input label="Shop Address" value={shopAddress} onChangeText={setShopAddress} placeholder="Full shop address" leftIcon="map-pin" multiline error={errors.shopAddress} />
              </>
            ) : (
              <>
                <View>
                  <Text style={[gs.fieldLabel, { color: colors.textMuted, fontFamily: 'Inter_500Medium' }]}>Your Role</Text>
                  <View style={gs.staffRoleWrap}>
                    {[
                      { key: 'reception', label: 'Reception' },
                      { key: 'technician', label: 'Technician' },
                      { key: 'store_manager', label: 'Store Manager' },
                      { key: 'accountant', label: 'Accountant' },
                    ].map((r) => (
                      <TouchableOpacity
                        key={r.key}
                        style={[gs.staffRoleChip, { borderColor: colors.border, backgroundColor: staffRole === r.key ? colors.primary + '15' : colors.input }, staffRole === r.key && { borderColor: colors.primary }]}
                        onPress={() => setStaffRole(r.key)}
                        activeOpacity={0.8}
                      >
                        <Text style={[{ color: staffRole === r.key ? colors.primary : colors.textMuted, fontFamily: 'Inter_500Medium', fontSize: 13 }]}>
                          {r.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <Input label="Shop Owner's Mobile Number" value={dealerMobile} onChangeText={(t) => setDealerMobile(t.replace(/\D/g, '').slice(0, 10))} placeholder="Owner's 10-digit mobile" keyboardType="phone-pad" leftIcon="briefcase" error={errors.dealerMobile} />
              </>
            )}

            <View style={gs.photoRow}>
              <TouchableOpacity style={[gs.photoBox, { borderColor: colors.border, backgroundColor: colors.input }]} onPress={() => pickImage(setProfilePhoto)} activeOpacity={0.8}>
                {profilePhoto ? <Image source={{ uri: profilePhoto }} style={gs.photoImg} contentFit="cover" /> : <Feather name="user" size={22} color={colors.textMuted} />}
                <Text style={[gs.photoLabel, { color: colors.textMuted, fontFamily: 'Inter_500Medium' }]}>Profile Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[gs.photoBox, { borderColor: colors.border, backgroundColor: colors.input }]} onPress={() => pickImage(setCompanyLogo)} activeOpacity={0.8}>
                {companyLogo ? <Image source={{ uri: companyLogo }} style={gs.photoImg} contentFit="cover" /> : <Feather name="image" size={22} color={colors.textMuted} />}
                <Text style={[gs.photoLabel, { color: colors.textMuted, fontFamily: 'Inter_500Medium' }]}>Company Logo</Text>
              </TouchableOpacity>
            </View>

            <View style={[gs.infoBox, { backgroundColor: colors.infoLight, borderColor: colors.infoLight }]}>
              <Feather name="info" size={14} color={colors.info} />
              <Text style={[gs.infoText, { color: colors.info, fontFamily: 'Inter_400Regular' }]}>
                {accountType === 'dealer'
                  ? "We'll send a 6-digit OTP to your email to verify your identity. Your account is created as the shop owner (Dealer) — you can add staff later."
                  : "We'll send a 6-digit OTP to your email. After verification, your account will be PENDING until your shop owner approves it."}
              </Text>
            </View>

            <Button title="Send OTP & Continue" onPress={handleFormNext} loading={formLoading} fullWidth size="lg" />
          </View>
        )}

        {step === 'email_otp' && (
          <View style={[gs.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={gs.otpHeader}>
              <View style={[gs.otpIconWrap, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
                <Feather name="mail" size={28} color={colors.primary} />
              </View>
              <Text style={[gs.otpTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Verify Email</Text>
              <Text style={[gs.otpSub, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
                Enter the 6-digit OTP sent to <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{email}</Text>
              </Text>
            </View>

            <OtpInput value={emailOtp} onChange={(v, i) => handleOtpChange(setEmailOtp, emailRefs, emailOtp, v, i)} onBack={(i) => handleOtpBack(setEmailOtp, emailOtp, i)} inputRef={emailRefs} />

            {!!emailError && (
              <View style={[gs.errorBox, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '30' }]}>
                <Feather name="alert-circle" size={13} color={colors.destructive} />
                <Text style={[gs.errorText, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>{emailError}</Text>
              </View>
            )}

            <TouchableOpacity onPress={handleResendEmailOtp} disabled={emailTimer > 0} style={{ alignItems: 'center' }}>
              <Text style={[gs.timerText, { color: emailTimer > 0 ? colors.textMuted : colors.primary, fontFamily: 'Inter_500Medium' }]}>
                {emailTimer > 0 ? `Resend OTP in ${emailTimer}s` : 'Resend OTP'}
              </Text>
            </TouchableOpacity>

            <Button title="Verify & Create Account" onPress={handleEmailVerify} loading={emailLoading} disabled={emailOtp.join('').length < 6} fullWidth size="lg" />
          </View>
        )}

        {step === 'success' && (
          <View style={[gs.successCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={gs.successIcon}>
              <View style={[gs.successIconGrad, { backgroundColor: pendingApproval ? colors.warning : colors.success }]}>
                <Feather name={pendingApproval ? 'clock' : 'check'} size={36} color="#FFFFFF" />
              </View>
            </View>
            <Text style={[gs.successTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {pendingApproval ? 'Account Pending' : 'Welcome, Dealer!'}
            </Text>
            <Text style={[gs.successSub, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
              {pendingApproval
                ? 'Your registration was submitted. Your shop owner must approve your account from the Staff screen before you can sign in.'
                : 'Your dealer account and shop workspace are ready. You can add staff anytime from Staff Management.'}
            </Text>

            <View style={gs.successSteps}>
              {(pendingApproval
                ? [
                    { icon: 'mail', color: colors.primary, label: 'Email verified' },
                    { icon: 'clock', color: colors.warning, label: 'Waiting for owner approval' },
                  ]
                : [
                    { icon: 'mail', color: colors.primary, label: 'Email verified' },
                    { icon: 'briefcase', color: colors.primary, label: 'Shop workspace created' },
                  ]
              ).map((item, i) => (
                <View key={i} style={gs.successStep}>
                  <View style={[gs.successStepDot, { backgroundColor: item.color + '22' }]}>
                    <Feather name={item.icon as any} size={14} color={item.color} />
                  </View>
                  <Text style={[gs.successStepText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>{item.label}</Text>
                </View>
              ))}
            </View>

            <Button title={pendingApproval ? 'Back to Sign In' : 'Go to Home'} onPress={() => (pendingApproval ? router.replace('/(auth)') : router.replace('/(tabs)'))} fullWidth size="lg" />
          </View>
        )}

        {step === 'form' && (
          <TouchableOpacity onPress={() => router.back()} style={{ alignItems: 'center' }}>
            <Text style={[gs.loginLink, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
              Already have an account? <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const gs = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  title: { fontSize: 24 },
  subtitle: { fontSize: 14, marginTop: 2 },
  card: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 16 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 10, padding: 12, borderWidth: 1 },
  infoText: { fontSize: 13, flex: 1, lineHeight: 18 },
  roleRow: { flexDirection: 'row', gap: 10 },
  roleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 10, borderWidth: 1.5 },
  roleText: { fontSize: 14 },
  fieldLabel: { fontSize: 13, marginBottom: 8 },
  staffRoleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  staffRoleChip: { paddingHorizontal: 12, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoBox: { flex: 1, height: 90, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden' },
  photoImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 24 },
  photoLabel: { fontSize: 12, position: 'absolute', bottom: 6 },
  otpHeader: { alignItems: 'center', gap: 6 },
  otpIconWrap: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 6 },
  otpTitle: { fontSize: 22 },
  otpSub: { fontSize: 14, textAlign: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 12, borderWidth: 1 },
  errorText: { fontSize: 13, flex: 1 },
  timerText: { fontSize: 14 },
  successCard: { borderRadius: 16, borderWidth: 1, padding: 24, gap: 16, alignItems: 'center' },
  successIcon: { marginBottom: 4 },
  successIconGrad: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 22 },
  successSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  successSteps: { width: '100%', gap: 12, marginVertical: 8 },
  successStep: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  successStepDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  successStepText: { fontSize: 14 },
  loginLink: { fontSize: 14 },
});
