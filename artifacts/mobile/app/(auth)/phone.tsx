import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { authOtpRequest } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';

export default function PhoneScreen() {
  const { signedOutNotice, clearSignedOutNotice } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [termsReady, setTermsReady] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem('avarpus_terms_accepted').then((value) => {
      if (!active) return;
      if (value !== 'true') {
        router.replace('/(auth)');
        return;
      }
      setTermsReady(true);
    });
    return () => { active = false; };
  }, [router]);

  const handleSendOtp = async () => {
    if (mobile.length !== 10) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    setError('');
    setOtpLoading(true);
    try {
      clearSignedOutNotice();
      await authOtpRequest({ mobile });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push({ pathname: '/(auth)/otp', params: { mobile, rememberMe: rememberMe ? '1' : '0' } });
    } catch (err: any) {
      setError(err?.data?.message ?? 'Could not send OTP. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setOtpLoading(false);
    }
  };

  if (!termsReady) {
    return (
      <View style={[styles.loadingRoot, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <View style={styles.topbar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back to welcome">
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.step, { color: colors.textMuted }]}>2 of 2</Text>
        </View>

        <View style={styles.content}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>Avarpus secure sign in</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Enter your mobile number</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            We will send a one-time code to verify your account and continue securely.
          </Text>

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

          <Input
            label="Mobile number"
            value={mobile}
            onChangeText={(text) => setMobile(text.replace(/\D/g, '').slice(0, 10))}
            placeholder="10-digit mobile number"
            keyboardType="phone-pad"
            leftText="+91"
            autoFocus
            accessibilityLabel="Mobile number"
          />
          <Text style={[styles.helper, { color: colors.textMuted }]}>Use the mobile number registered with your Avarpus account.</Text>
          <TouchableOpacity
            onPress={() => setRememberMe((value) => !value)}
            style={styles.checkboxRow}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: rememberMe }}
          >
            <View style={[styles.checkbox, { borderColor: rememberMe ? colors.primary : colors.border, backgroundColor: rememberMe ? colors.primary : colors.input }]}>
              {rememberMe && <Feather name="check" size={13} color="#FFFFFF" />}
            </View>
            <Text style={[styles.checkboxText, { color: colors.foreground }]}>Keep me signed in on this device</Text>
          </TouchableOpacity>
          <Button title={otpLoading ? 'Sending code...' : 'Continue'} onPress={handleSendOtp} loading={otpLoading} fullWidth size="lg" />
          <Text style={[styles.privacy, { color: colors.textMuted }]}>By continuing, you agree to receive a verification code by SMS.</Text>
          <View style={styles.accountLinks}>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')} accessibilityRole="link">
              <Text style={[styles.accountText, { color: colors.textMuted }]}>
                New dealer? <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Create account</Text>
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/(auth)/activate')} accessibilityRole="link">
              <Text style={[styles.accountText, { color: colors.textMuted }]}>
                Received an invite? <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Activate account</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingRoot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' },
  step: { fontSize: 12, letterSpacing: 1, fontFamily: 'Inter_500Medium', textTransform: 'uppercase' },
  content: { flex: 1, justifyContent: 'center', paddingVertical: 28, gap: 14 },
  eyebrow: { fontSize: 12, letterSpacing: 1.5, fontFamily: 'Inter_700Bold', textTransform: 'uppercase' },
  title: { fontSize: 36, lineHeight: 42, letterSpacing: -1, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  subtitle: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_400Regular', marginBottom: 14 },
  helper: { fontSize: 12, lineHeight: 18, fontFamily: 'Inter_400Regular', marginTop: -4 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkboxText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' },
  privacy: { fontSize: 12, lineHeight: 18, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 4 },
  accountLinks: { alignItems: 'center', gap: 10, marginTop: 6 },
  accountText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  alertBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 2 },
  alertText: { fontSize: 13, flex: 1, fontFamily: 'Inter_500Medium', lineHeight: 18 },
});