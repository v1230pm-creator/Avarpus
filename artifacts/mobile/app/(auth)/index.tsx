import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { authOtpRequest } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';

type LoginTab = 'email' | 'mobile';

export default function LoginScreen() {
  const { login, signedOutNotice, clearSignedOutNotice } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const [activeTab, setActiveTab] = useState<LoginTab>('email');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const switchTab = (tab: LoginTab) => {
    setActiveTab(tab);
    setError('');
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password');
      return;
    }
    setLoading(true);
    setError('');
    clearSignedOutNotice();
    const result = await login(email.trim(), password, rememberMe);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Invalid credentials. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(auth)/biometric');
    }
  };

  const [otpLoading, setOtpLoading] = useState(false);

  const handleSendOtp = async () => {
    if (!mobile.trim() || mobile.length < 10) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    setError('');
    setOtpLoading(true);
    try {
      const res = await authOtpRequest({ mobile: mobile.trim() });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push({
        pathname: '/(auth)/otp',
        params: { mobile: mobile.trim(), rememberMe: rememberMe ? '1' : '0' },
      });
    } catch (err: any) {
      setError(err?.data?.message ?? 'Could not send OTP. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setOtpLoading(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 280, backgroundColor: '#0F172A' }} />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Image
            source={require('@/assets/images/vmc-text.png')}
            style={styles.logoImg}
            contentFit="contain"
          />
          <Text style={[styles.electronicText, { color: '#94A3B8' }]}>ELECTRONIC</Text>
          <Image
            source={require('@/assets/images/vmc-hands.png')}
            style={styles.handsImg}
            contentFit="contain"
          />
          <Text style={[styles.tagline, { color: '#94A3B8' }]}>Business Management System</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Welcome Back</Text>
            <Text style={[styles.cardSub, { color: colors.textMuted }]}>Sign in to manage your business.</Text>
          </View>

          <View style={[styles.tabContainer, { backgroundColor: colors.secondary }]}>
            <TouchableOpacity
              onPress={() => switchTab('email')}
              style={[styles.tabBtn, activeTab === 'email' && { backgroundColor: colors.card, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}
              activeOpacity={0.8}
            >
              <Feather name="mail" size={14} color={activeTab === 'email' ? colors.primary : colors.textMuted} />
              <Text style={[styles.tabText, { color: activeTab === 'email' ? colors.foreground : colors.textMuted, fontFamily: activeTab === 'email' ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>Email</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => switchTab('mobile')}
              style={[styles.tabBtn, activeTab === 'mobile' && { backgroundColor: colors.card, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}
              activeOpacity={0.8}
            >
              <Feather name="smartphone" size={14} color={activeTab === 'mobile' ? colors.primary : colors.textMuted} />
              <Text style={[styles.tabText, { color: activeTab === 'mobile' ? colors.foreground : colors.textMuted, fontFamily: activeTab === 'mobile' ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>Mobile OTP</Text>
            </TouchableOpacity>
          </View>

          {!!signedOutNotice && !error && (
            <View style={[styles.alertBox, { backgroundColor: colors.infoLight, borderColor: colors.infoLight }]}>
              <Feather name="info" size={14} color={colors.info} />
              <Text style={[styles.alertText, { color: colors.info }]}>{signedOutNotice}</Text>
            </View>
          )}

          {!!error && (
            <View style={[styles.alertBox, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '30' }]}>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text style={[styles.alertText, { color: colors.destructive }]}>{error}</Text>
            </View>
          )}

          {activeTab === 'email' ? (
            <View style={styles.form}>
              <Input
                label="Email Address"
                value={email}
                onChangeText={setEmail}
                placeholder="name@company.com"
                keyboardType="email-address"
                autoCapitalize="none"
                leftIcon="mail"
              />
              <Input
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Enter password"
                isPassword
                leftIcon="lock"
                onSubmitEditing={handleSignIn}
                returnKeyType="done"
              />

              <View style={styles.rememberRow}>
                <TouchableOpacity onPress={() => setRememberMe(!rememberMe)} style={styles.checkboxRow} activeOpacity={0.7}>
                  <View style={[styles.checkbox, { borderColor: colors.border, backgroundColor: rememberMe ? colors.primary : colors.input }]}>
                    {rememberMe && <Feather name="check" size={12} color="#FFFFFF" />}
                  </View>
                  <Text style={[styles.rememberText, { color: colors.foreground }]}>Remember me</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.push('/(auth)/forgot')} activeOpacity={0.7}>
                  <Text style={[styles.forgotText, { color: colors.primary }]}>Forgot Password?</Text>
                </TouchableOpacity>
              </View>

              <Button title="Sign In" onPress={handleSignIn} loading={loading} fullWidth size="lg" />
            </View>
          ) : (
            <View style={styles.form}>
              <Input
                label="Mobile Number"
                value={mobile}
                onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile number"
                keyboardType="phone-pad"
                leftText="+91"
              />

              <View style={styles.rememberRow}>
                <TouchableOpacity onPress={() => setRememberMe(!rememberMe)} style={styles.checkboxRow} activeOpacity={0.7}>
                  <View style={[styles.checkbox, { borderColor: colors.border, backgroundColor: rememberMe ? colors.primary : colors.input }]}>
                    {rememberMe && <Feather name="check" size={12} color="#FFFFFF" />}
                  </View>
                  <Text style={[styles.rememberText, { color: colors.foreground }]}>Remember me</Text>
                </TouchableOpacity>
              </View>

              <Button title="Send OTP" onPress={handleSendOtp} loading={otpLoading} fullWidth size="lg" />
            </View>
          )}
        </View>

        <View style={styles.bottomSection}>
          <TouchableOpacity onPress={() => router.push('/(auth)/register')} activeOpacity={0.7}>
            <Text style={[styles.bottomText, { color: colors.textMuted }]}>
              Don't have an account? <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Create Account</Text>
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(auth)/activate')} activeOpacity={0.7}>
            <Text style={[styles.bottomText, { color: colors.textMuted }]}>
              Received a customer invite? <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Activate Account</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 32 },
  header: { alignItems: 'center', gap: 4 },
  logoImg: { width: 180, height: 44 },
  electronicText: { fontSize: 12, letterSpacing: 4, fontFamily: 'Inter_500Medium' },
  handsImg: { width: 160, height: 36, marginTop: 4 },
  tagline: { fontSize: 13, marginTop: 4, fontFamily: 'Inter_400Regular' },
  card: { borderRadius: 16, padding: 24, borderWidth: 1, gap: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  cardHeader: { gap: 4 },
  cardTitle: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  cardSub: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  tabContainer: { flexDirection: 'row', padding: 4, borderRadius: 10, gap: 4 },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8, gap: 6 },
  tabText: { fontSize: 14 },
  alertBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 8, borderWidth: 1 },
  alertText: { fontSize: 13, flex: 1, fontFamily: 'Inter_500Medium', lineHeight: 18 },
  form: { gap: 16 },
  rememberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rememberText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  forgotText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  bottomSection: { gap: 16, alignItems: 'center' },
  bottomText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
});
