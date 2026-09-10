import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAuth } from '@/context/AuthContext';
import { completeUnlockSuccess, isBiometricLockEnabled, setUnlocked } from '@/utils/appLock';
import { onBlue } from '@/constants/brand';

export default function BiometricScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // The unlock gate is part of the opening experience, so it shares the same
  // flat brand-blue surface as the rest of the sign-in path.
  const theme = {
    bg: onBlue.background,
    card: onBlue.surface,
    border: onBlue.surfaceBorder,
    primary: onBlue.text,
    text: onBlue.text,
    textMuted: onBlue.textMuted,
    danger: onBlue.danger,
    dangerBg: onBlue.noticeBackground,
  };

  const { isAuthenticated, isLoading, logout } = useAuth();
  const [checking, setChecking] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState('');
  const [methodLabel, setMethodLabel] = useState('biometric or device password');

  const unlock = useCallback(async () => {
    if (authenticating) return;
    setAuthenticating(true);
    setError('');
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Avarpus',
        fallbackLabel: 'Use device password',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (result.success) {
        await completeUnlockSuccess();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace('/(tabs)');
      } else if (result.error !== 'user_cancel' && result.error !== 'system_cancel') {
        setError('Authentication failed. Use your biometric or device password and try again.');
      }
    } catch {
      setError('Could not open device authentication. Try again.');
    } finally {
      setAuthenticating(false);
    }
  }, [authenticating, router]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (isLoading) return;
      if (!isAuthenticated) {
        router.replace('/(auth)');
        return;
      }
      try {
        const enabled = await isBiometricLockEnabled();
        if (!enabled) {
          await completeUnlockSuccess();
          router.replace('/(tabs)');
          return;
        }
        const [types, level] = await Promise.all([
          LocalAuthentication.supportedAuthenticationTypesAsync(),
          LocalAuthentication.getEnrolledLevelAsync(),
        ]);
        if (!active) return;
        const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
        const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
        if (hasFace) setMethodLabel('Face ID or device password');
        else if (hasFingerprint) setMethodLabel('fingerprint or device password');
        else if (level === LocalAuthentication.SecurityLevel.SECRET) setMethodLabel('device password');
        setChecking(false);
        void unlock();
      } catch {
        if (active) {
          setChecking(false);
          setError('Could not check device authentication. Try again.');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [isAuthenticated, isLoading]);

  const signOut = async () => {
    await logout();
    setUnlocked(false);
    router.replace('/(auth)');
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={[styles.iconWrap, { backgroundColor: theme.primary + '15' }]}>
          <Feather name="shield" size={32} color={theme.primary} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: theme.text, fontFamily: 'Inter_700Bold' }]}>
            Unlock Avarpus
          </Text>
          <Text style={[styles.subtitle, { color: theme.textMuted, fontFamily: 'Inter_400Regular' }]}>
            Continue with your {methodLabel}.
          </Text>
        </View>

        {!!error && (
          <View style={[styles.errorBox, { backgroundColor: theme.dangerBg, borderColor: theme.dangerBg }]}>
            <Feather name="alert-circle" size={14} color={theme.danger} />
            <Text style={[styles.errorText, { color: theme.danger, fontFamily: 'Inter_500Medium' }]}>
              {error}
            </Text>
          </View>
        )}

        <TouchableOpacity
          onPress={unlock}
          disabled={checking || authenticating}
          style={[styles.unlockButton, { backgroundColor: onBlue.controlBackground }, (checking || authenticating) && { opacity: 0.75 }]}
          activeOpacity={0.8}
        >
          {checking || authenticating ? (
            <ActivityIndicator color={onBlue.controlText} />
          ) : (
            <>
              <Feather name="unlock" size={18} color={onBlue.controlText} />
              <Text style={[styles.unlockText, { fontFamily: 'Inter_600SemiBold' }]}>Authenticate</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={signOut} style={styles.signOutButton} activeOpacity={0.7}>
          <Text style={[styles.signOutText, { color: theme.textMuted, fontFamily: 'Inter_500Medium' }]}>
            Sign out instead
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, gap: 20 },
  iconWrap: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { alignItems: 'center', gap: 6 },
  title: { fontSize: 24, textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  errorBox: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 8, borderWidth: 1 },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  unlockButton: { width: '100%', minHeight: 50, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  unlockText: { color: onBlue.controlText, fontSize: 15 },
  signOutButton: { paddingVertical: 10, paddingHorizontal: 16 },
  signOutText: { fontSize: 13 },
});
