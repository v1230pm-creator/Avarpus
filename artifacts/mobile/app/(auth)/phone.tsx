import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
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
import { APP_BRAND } from '@/constants/branding';
import { BrandMark } from '@/components/ui/BrandMark';

export default function PhoneScreen() {
  const { signedOutNotice, clearSignedOutNotice } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  
  const theme = {
    bg: isDark ? '#040914' : colors.background,
    card: isDark ? '#0A1221' : colors.card,
    border: isDark ? '#1E293B' : colors.border,
    primary: isDark ? '#2563EB' : colors.primary,
    text: isDark ? '#FFFFFF' : colors.foreground,
    textMuted: isDark ? '#94A3B8' : colors.textMuted,
    gold: isDark ? '#F59E0B' : colors.gold || '#D97706',
    inputBg: isDark ? '#0F172A' : colors.input,
    danger: isDark ? '#EF4444' : colors.destructive,
    dangerBg: isDark ? 'rgba(239, 68, 68, 0.1)' : colors.destructive + '15',
    info: isDark ? '#3B82F6' : colors.info,
    infoBg: isDark ? 'rgba(59, 130, 246, 0.1)' : colors.infoLight,
  };

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
      <View style={[styles.loadingRoot, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        <View style={styles.topbar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back to welcome">
            <Feather name="arrow-left" size={20} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.step, { color: theme.textMuted }]}>2 of 2</Text>
        </View>

        <View style={styles.content}>
          <View style={styles.brandLockup}>
            <BrandMark size={38} />
            <View>
              <Text style={[styles.brandName, { color: theme.text }]}>{APP_BRAND}</Text>
              <Text style={[styles.brandTagline, { color: theme.gold }]}>Secure. Private. Connected.</Text>
            </View>
          </View>
          <Text style={[styles.eyebrow, { color: theme.primary }]}>Secure sign in</Text>
          <Text style={[styles.title, { color: theme.text }]}>Enter your mobile number</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            We will send a one-time code to verify your account and continue securely.
          </Text>

          {!!signedOutNotice && !error && (
            <View style={[styles.alertBox, { backgroundColor: theme.infoBg, borderColor: theme.infoBg }]}>
              <Feather name="info" size={14} color={theme.info} />
              <Text style={[styles.alertText, { color: theme.info }]}>{signedOutNotice}</Text>
            </View>
          )}
          {!!error && (
            <View style={[styles.alertBox, { backgroundColor: theme.dangerBg, borderColor: theme.dangerBg }]}>
              <Feather name="alert-circle" size={14} color={theme.danger} />
              <Text style={[styles.alertText, { color: theme.danger }]}>{error}</Text>
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
          
          <TouchableOpacity
            onPress={() => setRememberMe((value) => !value)}
            style={styles.checkboxRow}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: rememberMe }}
          >
            <View style={[styles.checkbox, { borderColor: rememberMe ? theme.primary : theme.border, backgroundColor: rememberMe ? theme.primary : theme.inputBg }]}>
              {rememberMe && <Feather name="check" size={12} color="#FFFFFF" />}
            </View>
            <Text style={[styles.checkboxText, { color: theme.text }]}>Keep me signed in on this device</Text>
          </TouchableOpacity>
          
          <Button title={otpLoading ? 'Sending code...' : 'Continue'} onPress={handleSendOtp} loading={otpLoading} fullWidth size="lg" />
          <Text style={[styles.privacy, { color: theme.textMuted }]}>By continuing, you agree to receive a verification code by SMS.</Text>
          
          <View style={styles.accountLinks}>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')} accessibilityRole="link">
              <Text style={[styles.accountText, { color: theme.textMuted }]}>
                New dealer? <Text style={{ color: theme.primary, fontFamily: 'Inter_600SemiBold' }}>Create dealer account</Text>
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/(auth)/activate')} accessibilityRole="link">
              <Text style={[styles.accountText, { color: theme.textMuted }]}>
                Received an invite? <Text style={{ color: theme.primary, fontFamily: 'Inter_600SemiBold' }}>Activate account</Text>
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
  scroll: { flexGrow: 1, paddingHorizontal: 16 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  backButton: { width: 36, height: 36, marginLeft: -8, alignItems: 'center', justifyContent: 'center' },
  step: { fontSize: 11, letterSpacing: 0.5, fontFamily: 'Inter_500Medium', textTransform: 'uppercase' },
  content: { flex: 1, justifyContent: 'center', paddingVertical: 16, gap: 12 },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  brandLogo: { width: 40, height: 40 },
  brandName: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  brandTagline: { fontSize: 9, fontFamily: 'Inter_600SemiBold', marginTop: 1 },
  eyebrow: { fontSize: 11, letterSpacing: 1, fontFamily: 'Inter_700Bold', textTransform: 'uppercase' },
  title: { fontSize: 28, lineHeight: 34, letterSpacing: -0.5, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  subtitle: { fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular', marginBottom: 10 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkboxText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: 'Inter_400Regular' },
  privacy: { fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 4 },
  accountLinks: { alignItems: 'center', gap: 10, marginTop: 12 },
  accountText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  alertBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 8, borderWidth: 1 },
  alertText: { fontSize: 12, flex: 1, fontFamily: 'Inter_500Medium', lineHeight: 16 },
});
