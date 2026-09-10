import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { isLockEnabled, isUnlocked } from '@/utils/appLock';
import { SPLASH_BACKGROUND, SplashIntro } from '@/components/ui/SplashIntro';
import { onBlue } from '@/constants/brand';

// Only a safety net: the splash normally hands off as soon as auth and lock
// state resolve, so this cap just prevents a stalled check from trapping the
// user on the splash.
const SPLASH_STALL_HANDOFF_MS = 2200;

export default function Index() {
  const {
    isAuthenticated,
    isLoading,
    trustedDeviceStatus,
    useOtpInstead,
    user,
  } = useAuth();
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
      <View style={[styles.statusRoot, { backgroundColor: onBlue.background }]}>
        <ActivityIndicator color={onBlue.text} size="large" />
        <Text style={[styles.statusTitle, { color: onBlue.text }]}>Checking trusted device</Text>
        <Text style={[styles.statusBody, { color: onBlue.textMuted }]}>
          Securely checking whether this Android device was recently verified.
        </Text>
        <TouchableOpacity onPress={useOtpInstead} style={styles.otpButton}>
          <Text style={[styles.otpButtonText, { color: onBlue.text }]}>Use OTP instead</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isLoading && isAuthenticated && trustedDeviceStatus === 'verified' && showVerified) {
    return (
      <View style={[styles.statusRoot, { backgroundColor: onBlue.background }]}>
        <View style={[styles.verifiedIcon, { backgroundColor: onBlue.surface }]}>
          <Text style={[styles.checkmark, { color: onBlue.text }]}>✓</Text>
        </View>
        <Text style={[styles.statusTitle, { color: onBlue.text }]}>Trusted device verified</Text>
        <Text style={[styles.statusBody, { color: onBlue.textMuted }]}>
          Signing you in without another OTP.
        </Text>
      </View>
    );
  }

  // Continuity fallback: this only shows if startup work outlives the splash.
  // It reuses the splash surface so the app never flashes a bare white screen
  // between opening and the first real screen.
  if (isLoading || lockCheck === 'pending') {
    return (
      <View style={[styles.continuityRoot, { backgroundColor: SPLASH_BACKGROUND }]}>
        <ActivityIndicator color={onBlue.text} size="large" />
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
  continuityRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
