import React, { useState, useRef, useEffect } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
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
  const sentTo = '';
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
    // Route through the lock screen so an existing PIN/biometric lock is enforced
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
    <LinearGradient colors={['#0B0F1A', '#0E1422']} style={{ flex: 1 }}>
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View style={[styles.container, { flex: 1, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color="#F5F7FA" />
          </TouchableOpacity>

          <View style={{ flex: 1, justifyContent: 'center', gap: 36 }}>
            <View style={styles.header}>
              <View style={styles.iconCircle}>
                <Feather name="smartphone" size={32} color="#4DA3FF" />
              </View>
              <Text style={[styles.title, { fontFamily: 'Inter_700Bold' }]}>Verify Your Mobile</Text>
              <Text style={[styles.subtitle, { fontFamily: 'Inter_400Regular' }]}>
                {sentTo
                  ? `Enter the 6-digit code sent to ${sentTo}`
                  : 'Enter the 6-digit code sent to the email registered with this mobile number'}
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
                      borderColor: digit ? '#3A8FF7' : 'rgba(255,255,255,0.10)',
                      color: '#F5F7FA',
                      fontFamily: 'Inter_700Bold',
                      backgroundColor: 'rgba(17, 27, 45, 0.68)',
                      borderRadius: colors.radius - 2,
                    },
                  ]}
                  textAlign="center"
                />
              ))}
            </View>

            {!!error && (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={14} color="#EF4444" />
                <Text style={[styles.errorText, { fontFamily: 'Inter_400Regular' }]}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={handleResend}
              disabled={timer > 0}
              style={{ alignItems: 'center' }}
            >
              <Text style={[styles.resendText, {
                color: timer > 0 ? '#7F8BA3' : '#4DA3FF',
                fontFamily: 'Inter_500Medium',
              }]}>
                {timer > 0 ? `Resend OTP in ${timer}s` : 'Resend OTP'}
              </Text>
            </TouchableOpacity>

            <Button
              title="Verify & Continue"
              onPress={handleVerify}
              loading={loading}
              disabled={!filled}
              fullWidth
              size="lg"
            />
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', gap: 14 },
  iconCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(47, 128, 237, 0.10)', alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 26, color: '#F5F7FA' },
  subtitle: { fontSize: 14, color: '#A8B3C7', textAlign: 'center', lineHeight: 22 },
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  otpCell: { width: 48, height: 60, fontSize: 24, borderWidth: 1.5 },
  resendText: { fontSize: 14 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.10)', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.16)',
  },
  errorText: { fontSize: 12, color: '#EF4444', flex: 1 },
});
