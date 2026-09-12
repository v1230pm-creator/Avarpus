import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { authOtpRequest } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { onBlue } from '@/constants/brand';
import { AvarpusLoadingScreen } from '@/components/ui/AvarpusSpinner';

export default function PhoneScreen() {
  const { signedOutNotice, clearSignedOutNotice } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = {
    bg: onBlue.background,
    // Field underlines must stay findable against the bright blue, so they
    // use the strong hairline rather than the decorative one.
    border: onBlue.lineStrong,
    primary: onBlue.text,
    text: onBlue.text,
    textMuted: onBlue.textMuted,
    danger: onBlue.danger,
    info: onBlue.info,
    noticeBg: onBlue.noticeBackground,
    noticeBorder: onBlue.noticeBorder,
  };

  const [mobile, setMobile] = useState('');
  const [error, setError] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
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

  // Next stays enabled, so validation feedback has to be announced as well as
  // shown: otherwise a screen-reader user just hears nothing when they tap.
  const reportError = (message: string) => {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  };

  const handleSendOtp = async () => {
    if (mobile.length !== 10) {
      reportError('Please enter a valid 10-digit mobile number');
      return;
    }
    setError('');
    setOtpLoading(true);
    try {
      clearSignedOutNotice();
      await authOtpRequest({ mobile });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push({ pathname: '/(auth)/otp', params: { mobile, rememberMe: '1' } });
    } catch (err: any) {
      reportError(err?.data?.message ?? 'Could not send OTP. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setOtpLoading(false);
    }
  };

  if (!termsReady) {
    return <AvarpusLoadingScreen background={theme.bg} color={theme.text} size={20} />;
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        <View style={styles.topbar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back to welcome">
            <Feather name="arrow-left" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerBrand, { color: theme.text }]}>Avarpus</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.content}>
          <Text style={[styles.title, { color: theme.text }]}>Enter your mobile number</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            Avarpus will send a verification code to confirm your phone number. Carrier charges may apply.
          </Text>

          {!!signedOutNotice && !error && (
            <View style={[styles.alertBox, { backgroundColor: theme.noticeBg, borderColor: theme.noticeBorder }]}>
              <Feather name="info" size={14} color={theme.info} />
              <Text style={[styles.alertText, { color: theme.info }]}>{signedOutNotice}</Text>
            </View>
          )}
          {!!error && (
            <View
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={[styles.alertBox, { backgroundColor: theme.noticeBg, borderColor: theme.noticeBorder }]}
            >
              <Feather name="alert-circle" size={14} color={theme.danger} />
              <Text style={[styles.alertText, { color: theme.danger }]}>{error}</Text>
            </View>
          )}

          <View style={styles.phoneForm}>
            <TouchableOpacity style={[styles.countryRow, { borderBottomColor: theme.border }]} activeOpacity={0.75}>
              <Text style={[styles.countryText, { color: theme.text }]}>India</Text>
              <Feather name="chevron-down" size={18} color={theme.text} />
            </TouchableOpacity>
            <View style={styles.phoneRow}>
              <View style={[styles.codeField, { borderBottomColor: theme.border }]}>
                <Text style={[styles.codeText, { color: theme.text }]}>+ 91</Text>
              </View>
              <View collapsable={false} style={[styles.numberField, { borderBottomColor: theme.border }]}>
                <TextInput
                  value={mobile}
                  onChangeText={(text) => { setMobile(text.replace(/\D/g, '').slice(0, 10)); if (error) setError(''); }}
                  placeholder="Phone number"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="phone-pad"
                  autoFocus
                  maxLength={10}
                  accessibilityLabel="Mobile number"
                  style={[styles.numberInput, { color: theme.text }]}
                />
              </View>
            </View>
          </View>
        </View>
        <View style={styles.nextButtonArea}>
          {/* Deliberately always enabled: a dimmed control disappears against
              this blue surface, and an incomplete number is already reported
              inline when the user taps. */}
          <Button
            title={otpLoading ? 'Sending code...' : 'Next'}
            onPress={handleSendOtp}
            loading={otpLoading}
            variant="onBlue"
            fullWidth
            size="lg"
            style={styles.nextButton}
          />
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingRoot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
  backButton: { width: 42, height: 42, marginLeft: -8, alignItems: 'center', justifyContent: 'center' },
  headerBrand: { fontSize: 21, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.8 },
  headerSpacer: { width: 34 },
  content: { flex: 1, alignItems: 'center', paddingTop: 46 },
  title: { fontSize: 28, lineHeight: 36, letterSpacing: -0.5, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  subtitle: { maxWidth: 330, fontSize: 14.5, lineHeight: 21, fontFamily: 'Inter_500Medium', textAlign: 'center', marginTop: 18 },
  phoneForm: { width: '100%', maxWidth: 306, marginTop: 34 },
  countryRow: {
    height: 48,
    borderBottomWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  countryText: { fontSize: 18, fontFamily: 'Inter_500Medium' },
  phoneRow: { flexDirection: 'row', gap: 14, marginTop: 12 },
  codeField: { width: 82, height: 50, borderBottomWidth: 1.5, justifyContent: 'center' },
  codeText: { fontSize: 18, fontFamily: 'Inter_500Medium' },
  numberField: { flex: 1, height: 50, borderBottomWidth: 1.5, justifyContent: 'center' },
  numberInput: { height: 48, fontSize: 18, fontFamily: 'Inter_500Medium', paddingHorizontal: 0 },
  nextButtonArea: { width: '100%', height: 64, marginTop: 'auto', paddingHorizontal: 5, paddingBottom: 10 },
  nextButton: { borderRadius: 28, minHeight: 54, maxHeight: 54 },
  alertBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 18 },
  alertText: { fontSize: 12.5, flex: 1, fontFamily: 'Inter_500Medium', lineHeight: 17 },
});
