import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  authDeviceRegister,
  authPhoneVerificationStart,
  authPhoneVerificationStatus,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { createOrReadDeviceKey } from '@/utils/deviceKey';
import {
  getSimVerificationDeviceId,
  openSimVerificationComposer,
  smsVerificationNumber,
} from '@/utils/simVerification';

type FlowState = 'number' | 'ready' | 'verifying' | 'failed' | 'unregistered';

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { data?: { message?: string } })?.data?.message;
  return message || fallback;
}

export default function SimVerifyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { adoptSession } = useAuth();
  const params = useLocalSearchParams<{ mobile?: string }>();
  const [mobile, setMobile] = useState(String(params.mobile ?? '').replace(/\D/g, '').slice(0, 10));
  const [state, setState] = useState<FlowState>('number');
  const [verification, setVerification] = useState<{
    verificationId: string;
    challenge: string;
    statusToken: string;
    expiresAt: string;
    registered: boolean;
    deviceId: string;
  } | null>(null);
  const [error, setError] = useState('');
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const polling = useRef(false);

  const clearPolling = () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
    polling.current = false;
  };

  useEffect(() => () => clearPolling(), []);

  const finishSession = async (session: { token: string; user: unknown }, deviceId: string) => {
    await adoptSession(session);
    // Only a custom native build can create a non-exportable Android Keystore
    // key. Expo Go intentionally skips this rather than pretending a JS key is
    // device-bound. The server still enforces a recent SIM verification.
    try {
      const key = await createOrReadDeviceKey(deviceId);
      if (key) await authDeviceRegister({ deviceId, publicKey: key.publicKey, algorithm: 'RSA-SHA256' });
    } catch {
      // Session stays valid; key enrollment can safely be retried after a
      // native module update without weakening the verified session.
    }
    clearPolling();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace('/(tabs)');
  };

  const pollStatus = async () => {
    if (!verification || polling.current) return;
    polling.current = true;
    try {
      const status = await authPhoneVerificationStatus({
        verificationId: verification.verificationId,
        statusToken: verification.statusToken,
      });
      if (status.state === 'verified' && status.session) {
        await finishSession(status.session, verification.deviceId);
        return;
      }
      if (status.state === 'failed') {
        clearPolling();
        if (status.errorCode === 'MOBILE_NOT_REGISTERED') {
          setState('unregistered');
        } else {
          setState('failed');
          setError('Unable to verify this SIM. Please try again.');
        }
      }
    } catch {
      // A temporary network interruption must not incorrectly report that the
      // SIM check failed. Polling continues until the short-lived challenge ends.
    } finally {
      polling.current = false;
    }
  };

  const beginVerification = async () => {
    if (mobile.length !== 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (Platform.OS !== 'android') {
      setError('SIM verification is available only in the Avarpus Android app.');
      return;
    }
    if (!smsVerificationNumber()) {
      setError('SIM verification is not configured yet. Please contact Avarpus support.');
      return;
    }
    setError('');
    setState('number');
    try {
      const deviceId = await getSimVerificationDeviceId();
      const result = await authPhoneVerificationStart({ mobile, deviceId });
      setVerification({ ...result, deviceId });
      if (!result.registered) {
        setState('unregistered');
        return;
      }
      setState('ready');
    } catch (err) {
      setError(errorMessage(err, 'Unable to start secure verification. Please try again.'));
    }
  };

  const sendFromSim = () => {
    if (!verification) return;
    Alert.alert(
      'Verify your mobile number',
      'An SMS will be sent from this SIM to securely verify this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            setError('');
            const result = await openSimVerificationComposer(verification.challenge);
            if (!result.ok) {
              const messages = {
                android_only: 'SIM verification is available only in the Avarpus Android app.',
                bridge_not_configured: 'SIM verification is not configured yet. Please contact Avarpus support.',
                permission_denied: 'SMS permission is required to verify this SIM.',
                composer_unavailable: 'Unable to open your SMS app. Please try again.',
              };
              setState('failed');
              setError(messages[result.reason ?? 'composer_unavailable']);
              return;
            }
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setState('verifying');
            await pollStatus();
            pollTimer.current = setInterval(() => { void pollStatus(); }, 3000);
          },
        },
      ],
    );
  };

  const reset = () => {
    clearPolling();
    setVerification(null);
    setState('number');
    setError('');
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 18 }]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityLabel="Back">
        <Feather name="arrow-left" size={22} color={colors.foreground} />
      </TouchableOpacity>
      <Text style={[styles.brand, { color: colors.primary }]}>AVARPUS</Text>
      <View style={styles.back} />
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {header}
      <View style={styles.content}>
        {state === 'number' && (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + '14' }]}>
              <Feather name="shield" size={30} color={colors.primary} />
            </View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>Avarpus security</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Secure Login</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              Verify the mobile number using the SIM in this Android device.
            </Text>
            {!!error && <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>}
            <Text style={[styles.label, { color: colors.textMuted }]}>MOBILE NUMBER</Text>
            <View style={[styles.mobileInput, { backgroundColor: colors.input, borderColor: colors.border }]}>
              <Text style={[styles.prefix, { color: colors.foreground }]}>+91</Text>
              <TextInput
                value={mobile}
                onChangeText={(value) => setMobile(value.replace(/\D/g, '').slice(0, 10))}
                keyboardType="phone-pad"
                placeholder="10-digit mobile number"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.foreground }]}
                autoFocus
                testID="sim-verify-mobile"
              />
            </View>
            <Button title="Continue" onPress={beginVerification} fullWidth size="lg" />
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/(auth)/phone', params: { mobile } })}
              style={styles.secondary}
              accessibilityRole="link"
              testID="open-existing-login"
            >
              <Text style={[styles.secondaryText, { color: colors.primary }]}>Use existing sign-in method</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'ready' && (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + '14' }]}>
              <Feather name="smartphone" size={30} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Verify your SIM</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              Your SIM will send a secure verification message. You will review and approve it in your SMS app.
            </Text>
            {!!error && <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>}
            <Button title="Verify with SIM" onPress={sendFromSim} fullWidth size="lg" />
            <TouchableOpacity onPress={reset} style={styles.secondary}>
              <Text style={[styles.secondaryText, { color: colors.primary }]}>Use a different number</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'verifying' && (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + '14' }]}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Verifying…</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              Waiting for the secure verification message. Keep this screen open after sending the SMS.
            </Text>
          </>
        )}

        {state === 'unregistered' && (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.destructive + '14' }]}>
              <Feather name="user-x" size={30} color={colors.destructive} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Mobile number not registered</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              This number does not have an Avarpus account yet.
            </Text>
            <Button title="Create Account" onPress={() => router.push('/(auth)/register')} fullWidth size="lg" />
            <TouchableOpacity onPress={reset} style={styles.secondary}>
              <Text style={[styles.secondaryText, { color: colors.primary }]}>Try Again</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'failed' && (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.destructive + '14' }]}>
              <Feather name="x-circle" size={30} color={colors.destructive} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Unable to verify this SIM</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>{error || 'Please try again.'}</Text>
            <Button title="Try Again" onPress={reset} fullWidth size="lg" />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 12, letterSpacing: 2.2, fontFamily: 'Inter_700Bold' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 62, gap: 16 },
  iconCircle: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  eyebrow: { fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', fontFamily: 'Inter_700Bold' },
  title: { fontSize: 34, lineHeight: 40, letterSpacing: -1, fontFamily: 'Inter_700Bold' },
  subtitle: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_400Regular', marginBottom: 8 },
  error: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_500Medium' },
  label: { fontSize: 11, letterSpacing: 0.8, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  mobileInput: { borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', height: 54, paddingHorizontal: 14 },
  prefix: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginRight: 10 },
  input: { flex: 1, fontSize: 16, fontFamily: 'Inter_500Medium', height: '100%' },
  secondary: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  secondaryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});