import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { isLockEnabled, isUnlocked } from '@/utils/appLock';
import { SplashIntro } from '@/components/ui/SplashIntro';

const SPLASH_STALL_HANDOFF_MS = 3600;

export default function Index() {
  const {
    isAuthenticated,
    isLoading,
    trustedDeviceStatus,
    useOtpInstead,
    user,
  } = useAuth();
  const colors = useColors();
  const [lockCheck, setLockCheck] = useState<'pending' | 'locked' | 'open'>('pending');
  const [showVerified, setShowVerified] = useState(true);
  const [introFinished, setIntroFinished] = useState(false);
  const [splashStallHandoffReady, setSplashStallHandoffReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const locked = (await isLockEnabled()) && !isUnlocked();
        if (active) setLockCheck(locked ? 'locked' : 'open');
      } catch {
        if (active) setLockCheck('locked');
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (trustedDeviceStatus !== 'verified') return;
    const timer = setTimeout(() => setShowVerified(false), 1200);
    return () => clearTimeout(timer);
  }, [trustedDeviceStatus]);

  useEffect(() => {
    if (introFinished) return;
    const timer = setTimeout(
      () => setSplashStallHandoffReady(true),
      SPLASH_STALL_HANDOFF_MS,
    );
    return () => clearTimeout(timer);
  }, [introFinished]);

  const startupReady =
    !isLoading &&
    lockCheck !== 'pending' &&
    trustedDeviceStatus !== 'checking';

  if (!introFinished) {
    return (
      <SplashIntro
        onFinish={() => setIntroFinished(true)}
        loadingReady={startupReady || splashStallHandoffReady}
      />
    );
  }

  if (isLoading && trustedDeviceStatus === 'checking') {
    return (
      <View style={[styles.statusRoot, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.statusTitle, { color: colors.foreground }]}>Checking trusted device</Text>
        <Text style={[styles.statusBody, { color: colors.textMuted }]}>
          Securely checking whether this Android device was recently verified.
        </Text>
        <TouchableOpacity onPress={useOtpInstead} style={styles.otpButton}>
          <Text style={[styles.otpButtonText, { color: colors.primary }]}>Use OTP instead</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isLoading && isAuthenticated && trustedDeviceStatus === 'verified' && showVerified) {
    return (
      <View style={[styles.statusRoot, { backgroundColor: colors.background }]}>
        <View style={[styles.verifiedIcon, { backgroundColor: colors.success + '18' }]}>
          <Text style={[styles.checkmark, { color: colors.success }]}>✓</Text>
        </View>
        <Text style={[styles.statusTitle, { color: colors.foreground }]}>Trusted device verified</Text>
        <Text style={[styles.statusBody, { color: colors.textMuted }]}>
          Signing you in without another OTP.
        </Text>
      </View>
    );
  }

  if (isLoading || lockCheck === 'pending') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)" />;
  }

  if (user?.needsDisplayName) {
    return <Redirect href="/(auth)/otp?setup=display-name" />;
  }

  if (lockCheck === 'locked') {
    return <Redirect href="/(auth)/biometric" />;
  }

  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  statusRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  statusTitle: { fontSize: 21, fontWeight: '700', textAlign: 'center' },
  statusBody: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 320 },
  otpButton: { paddingHorizontal: 18, paddingVertical: 12, marginTop: 6 },
  otpButtonText: { fontSize: 15, fontWeight: '600' },
  verifiedIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  checkmark: { fontSize: 36, fontWeight: '700' },
});
