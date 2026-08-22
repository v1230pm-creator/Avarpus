import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { authOtpRequest } from '@workspace/api-client-react';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';

export default function OTPScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loginWithOtp } = useAuth();
  const params = useLocalSearchParams<{ mobile?: string; sentTo?: string; rememberMe?: string }>();
  const mobile = typeof params.mobile === 'string' ? params.mobile : '';
  const rememberMe = params.rememberMe === '1';
  const sentTo = params.sentTo ?? '';
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [timer, setTimer] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    const interval = setInterval(() => setTimer((t) => (t > 0 ? t - 1 : 0)), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleChange = (val: string, idx: number) => {
    const d = val.replace(/\D/g, '');
    if (d.length > 1) {
      const digits = d.split('').slice(0, 6 - idx);
      const next = [...otp];
      digits.forEach((ch, i) => { if (idx + i < 6) next[idx + i] = ch; });
      setOtp(next);
      const nextFocus = Math.min(idx + digits.length, 5);
      refs.current[nextFocus]?.focus();
      return;
    }
    const next = [...otp];
    next[idx] = d;
    setOtp(next);
    if (d && idx < 5) refs.current[idx + 1]?.focus();
  };

  const handleKeyPress = (e: any, idx: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError('');
    const result = await loginWithOtp(mobile, otp.join(''), rememberMe);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Verification failed. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace('/(auth)/biometric');
  };

  const handleResend = async () => {
    if (timer > 0) return;
    try {
      await authOtpRequest({ mobile });
      setTimer(60);
      setOtp(['', '', '', '', '', '']);
      setError('');
    } catch (err: any) {
      setError(err?.data?.message ?? 'Could not resend OTP. Please try again.');
    }
  };

  const filled = otp.join('').length === 6;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>

          <View style={styles.content}>
            <View style={styles.header}>
              <View style={[styles.iconCircle, { backgroundColor: colors.primary + '15' }]}>
                <Feather name="smartphone" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Verify Your Mobile</Text>
              <Text style={[styles.subtitle, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
                {sentTo
                  ? `Enter the 6-digit code sent to ${sentTo}`
                  : 'Enter the 6-digit code sent to the mobile number'}
              </Text>
            </View>

            <View style={styles.otpRow}>
              {otp.map((digit, idx) => (
                <TextInput
                  key={idx}
                  ref={(r) => { refs.current[idx] = r; }}
                  value={digit}
                  onChangeText={(v) => handleChange(v, idx)}
                  onKeyPress={(e) => handleKeyPress(e, idx)}
                  keyboardType="number-pad"
                  maxLength={1}
                  selectTextOnFocus
                  style={[
                    styles.otpCell,
                    {
                      borderColor: digit ? colors.primary : colors.border,
                      color: colors.foreground,
                      fontFamily: 'Inter_700Bold',
                      backgroundColor: colors.input,
                      borderRadius: colors.radius - 2,
                    },
                  ]}
                  textAlign="center"
                />
              ))}
            </View>

            {!!error && (
              <View style={[styles.errorBox, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '30' }]}>
                <Feather name="alert-circle" size={14} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>{error}</Text>
              </View>
            )}

            <TouchableOpacity onPress={handleResend} disabled={timer > 0} style={{ alignItems: 'center' }}>
              <Text style={[styles.resendText, { color: timer > 0 ? colors.textMuted : colors.primary, fontFamily: 'Inter_500Medium' }]}>
                {timer > 0 ? `Resend OTP in ${timer}s` : 'Resend OTP'}
              </Text>
            </TouchableOpacity>

            <Button title="Verify & Continue" onPress={handleVerify} loading={loading} disabled={!filled} fullWidth size="lg" />
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 24 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -12 },
  content: { flex: 1, justifyContent: 'center', gap: 32 },
  header: { alignItems: 'center', gap: 12 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  otpCell: { width: 48, height: 60, fontSize: 24, borderWidth: 1.5 },
  resendText: { fontSize: 15 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 14, borderWidth: 1 },
  errorText: { fontSize: 14, flex: 1 },
});
