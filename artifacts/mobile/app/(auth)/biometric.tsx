import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Dimensions, Platform, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import Reanimated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BIOMETRIC_ENABLED_KEY, completeUnlockSuccess, disableAppLock,
  hasStoredMpin, setUnlocked, storeMpin, verifyMpin,
} from '@/utils/appLock';
import { formatCooldown, usePinThrottle } from '@/hooks/usePinThrottle';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type Mode = 'loading' | 'choose' | 'setup_mpin' | 'enter_mpin' | 'confirm_mpin' | 'bio_unlock';

const DOTS = [0, 1, 2, 3, 4, 5];
const PAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

export default function BiometricScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const colors = useColors();

  const [mode, setMode] = useState<Mode>('loading');
  const [hasBiometric, setHasBiometric] = useState(false);
  const [biometricType, setBiometricType] = useState<'fingerprint' | 'face'>('fingerprint');
  const [mpinSetup, setMpinSetup] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  const [mpin, setMpin] = useState('');
  const [confirmMpin, setConfirmMpin] = useState('');
  const [enteredMpin, setEnteredMpin] = useState('');
  const [mpinError, setMpinError] = useState('');

  const throttle = usePinThrottle();
  const cooldownActive = throttle.cooldownMs > 0;
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const shakeX = useSharedValue(0);

  useEffect(() => {
    checkCapabilities();
  }, []);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  async function checkCapabilities() {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      setBiometricType(hasFace ? 'face' : 'fingerprint');
      setHasBiometric(compatible && enrolled);

      const savedMpin = await hasStoredMpin();
      const bioEnabled = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);

      setMpinSetup(savedMpin);
      setBiometricEnabled(bioEnabled === 'true');

      if (savedMpin) {
        setMode('enter_mpin');
      } else if (bioEnabled === 'true') {
        setMode('bio_unlock');
        if (compatible && enrolled) triggerBiometric();
      } else {
        setMode('choose');
      }
    } catch {
      setMode('enter_mpin');
      setMpinError('Could not verify lock settings. Enter your PIN.');
    }
  }

  const triggerBiometric = useCallback(async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to continue',
        fallbackLabel: 'Use MPIN',
        cancelLabel: 'Cancel',
        disableDeviceFallback: true,
      });
      if (result.success) {
        await completeUnlockSuccess();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace('/(tabs)');
      }
    } catch {}
  }, []);

  const shake = () => {
    shakeX.value = withSequence(
      withTiming(-10, { duration: 60 }),
      withTiming(10, { duration: 60 }),
      withTiming(-8, { duration: 60 }),
      withTiming(8, { duration: 60 }),
      withTiming(0, { duration: 60 }),
    );
    if (Platform.OS !== 'web') Vibration.vibrate(300);
  };

  const handlePad = (key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (mode === 'setup_mpin') {
      if (key === '⌫') { setMpin((p) => p.slice(0, -1)); return; }
      if (mpin.length >= 6) return;
      const next = mpin + key;
      setMpin(next);
      if (next.length === 6) {
        setTimeout(() => { setMode('confirm_mpin'); setConfirmMpin(''); }, 300);
      }
    }

    if (mode === 'confirm_mpin') {
      if (key === '⌫') { setConfirmMpin((p) => p.slice(0, -1)); return; }
      if (confirmMpin.length >= 6) return;
      const next = confirmMpin + key;
      setConfirmMpin(next);
      if (next.length === 6) {
        setTimeout(async () => {
          if (next === mpin) {
            await storeMpin(mpin);
            setUnlocked(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.replace('/(tabs)');
          } else {
            setMpinError('PINs do not match. Try again.');
            shake();
            setConfirmMpin('');
            setMpin('');
            setMode('setup_mpin');
          }
        }, 300);
      }
    }

    if (mode === 'enter_mpin') {
      if (cooldownActive || !throttle.ready || submittingRef.current) return;
      if (key === '⌫') { setEnteredMpin((p) => p.slice(0, -1)); setMpinError(''); return; }
      if (enteredMpin.length >= 6) return;
      const next = enteredMpin + key;
      setEnteredMpin(next);
      if (next.length === 6) {
        submittingRef.current = true;
        setSubmitting(true);
        setTimeout(async () => {
          try {
            const ok = await verifyMpin(next);
            if (ok) {
              await throttle.recordSuccess();
              await completeUnlockSuccess();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.replace('/(tabs)');
            } else {
              const state = await throttle.recordFailure();
              if (state.lockedUntilMs != null) {
                setMpinError('Too many wrong attempts.');
              } else {
                const left = Math.max(0, 5 - state.failedAttempts);
                setMpinError(
                  left <= 2
                    ? `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left before a cooldown.`
                    : 'Incorrect PIN. Try again.',
                );
              }
              shake();
              setEnteredMpin('');
            }
          } finally {
            submittingRef.current = false;
            setSubmitting(false);
          }
        }, 300);
      }
    }
  };

  const enableBiometric = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Verify your identity',
      cancelLabel: 'Cancel',
    });
    if (result.success) {
      await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
      await completeUnlockSuccess();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    }
  };

  const [forgotBusy, setForgotBusy] = useState(false);

  const performForgotPin = async () => {
    if (forgotBusy) return;
    setForgotBusy(true);
    try {
      await disableAppLock();
      await logout();
      setUnlocked(false);
      router.replace('/(auth)');
    } catch {
      setMpinError('Could not reset the PIN. Try again.');
      setForgotBusy(false);
    }
  };

  const handleForgotPin = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Reset your PIN? You will be signed out and must log in again with your account credentials, then set a new PIN.')) {
        performForgotPin();
      }
      return;
    }
    Alert.alert(
      'Forgot PIN?',
      'You will be signed out and must log in again with your account credentials, then set a new PIN.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out & Reset PIN', style: 'destructive', onPress: performForgotPin },
      ],
    );
  };

  const skipAll = () => {
    setUnlocked(true);
    router.replace('/(tabs)');
  };

  const currentPin = mode === 'setup_mpin' ? mpin : mode === 'confirm_mpin' ? confirmMpin : enteredMpin;

  const title =
    mode === 'loading' ? 'Checking Security' :
    mode === 'choose' ? 'Secure Your App' :
    mode === 'setup_mpin' ? 'Create 6-digit PIN' :
    mode === 'confirm_mpin' ? 'Confirm Your PIN' :
    mode === 'bio_unlock' ? 'Unlock' :
    'Enter Your PIN';

  const subtitle =
    mode === 'loading' ? 'One moment…' :
    mode === 'choose' ? 'Choose how you want to unlock the app next time' :
    mode === 'setup_mpin' ? 'Pick a 6-digit PIN you\'ll remember' :
    mode === 'confirm_mpin' ? 'Re-enter the same PIN to confirm' :
    mode === 'bio_unlock' ? 'Authenticate to continue' :
    'Enter your PIN to continue';

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + '15' }]}>
          <Feather
            name={mode === 'enter_mpin' || mode === 'setup_mpin' || mode === 'confirm_mpin' ? 'lock' : biometricType === 'face' ? 'camera' : 'shield'}
            size={36}
            color={colors.primary}
          />
        </View>

        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>{subtitle}</Text>
        </View>

        {mode === 'bio_unlock' && (
          <View style={styles.optionsWrap}>
            <TouchableOpacity style={[styles.optionCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={triggerBiometric} activeOpacity={0.8}>
              <View style={[styles.optionIcon, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
                <Feather name={biometricType === 'face' ? 'camera' : 'shield'} size={24} color={colors.primary} />
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  Unlock with {biometricType === 'face' ? 'Face ID' : 'Fingerprint'}
                </Text>
                <Text style={[styles.optionSub, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
                  Tap to authenticate
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.primary} />
            </TouchableOpacity>

            <TouchableOpacity onPress={handleForgotPin} activeOpacity={0.7} disabled={forgotBusy} style={styles.forgotBtnCentered}>
              <Text style={[styles.forgotText, { color: colors.textMuted, fontFamily: 'Inter_500Medium' }]}>
                {forgotBusy ? 'Signing out…' : "Can't unlock? Sign out & reset"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {mode === 'choose' && (
          <View style={styles.optionsWrap}>
            {hasBiometric && (
              <TouchableOpacity style={[styles.optionCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={enableBiometric} activeOpacity={0.8}>
                <View style={[styles.optionIcon, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
                  <Feather name={biometricType === 'face' ? 'camera' : 'shield'} size={24} color={colors.primary} />
                </View>
                <View style={styles.optionText}>
                  <Text style={[styles.optionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                    {biometricType === 'face' ? 'Face ID' : 'Fingerprint'}
                  </Text>
                  <Text style={[styles.optionSub, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
                    Use biometric to unlock instantly
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}

            <TouchableOpacity style={[styles.optionCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => { setMode('setup_mpin'); setMpin(''); }} activeOpacity={0.8}>
              <View style={[styles.optionIcon, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
                <Feather name="lock" size={24} color={colors.primary} />
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Set MPIN</Text>
                <Text style={[styles.optionSub, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
                  Create a 6-digit security PIN
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.primary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipBtn} onPress={skipAll} activeOpacity={0.7}>
              <Text style={[styles.skipText, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        )}

        {(mode === 'setup_mpin' || mode === 'confirm_mpin' || mode === 'enter_mpin') && (
          <View style={styles.pinWrap}>
            <Reanimated.View style={[styles.dotsRow, shakeStyle]}>
              {DOTS.map((i) => (
                <View key={i} style={[styles.dot, { borderColor: colors.border }, currentPin.length > i && { backgroundColor: colors.primary, borderColor: colors.primary }, mpinError && { borderColor: colors.destructive }]} />
              ))}
            </Reanimated.View>

            {!!mpinError && (
              <Text style={[styles.pinError, { color: colors.destructive, fontFamily: 'Inter_500Medium' }]}>{mpinError}</Text>
            )}

            {mode === 'enter_mpin' && cooldownActive && (
              <View style={[styles.cooldownWrap, { backgroundColor: colors.warning + '15', borderColor: colors.warning + '30' }]}>
                <Feather name="clock" size={14} color={colors.warning} />
                <Text style={[styles.cooldownText, { color: colors.warning, fontFamily: 'Inter_600SemiBold' }]}>
                  Try again in {formatCooldown(throttle.cooldownMs)}
                </Text>
              </View>
            )}

            <View style={styles.pad}>
              {PAD.map((row, ri) => (
                <View key={ri} style={styles.padRow}>
                  {row.map((key, ki) => {
                    if (key === '') return <View key={ki} style={styles.padEmpty} />;
                    return (
                      <TouchableOpacity
                        key={ki}
                        style={[styles.padKey, { backgroundColor: colors.card, borderColor: colors.border }, key === '⌫' && { backgroundColor: colors.input }, mode === 'enter_mpin' && (cooldownActive || submitting) && { opacity: 0.35 }]}
                        onPress={() => handlePad(key)}
                        activeOpacity={0.7}
                        disabled={mode === 'enter_mpin' && (cooldownActive || submitting)}
                      >
                        {key === '⌫' ? (
                          <Feather name="delete" size={24} color={colors.foreground} />
                        ) : (
                          <Text style={[styles.padKeyText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{key}</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>

            <View style={styles.pinActions}>
              {mode === 'enter_mpin' && hasBiometric && biometricEnabled && (
                <TouchableOpacity onPress={triggerBiometric} style={styles.bioBtnSmall} activeOpacity={0.7}>
                  <Feather name={biometricType === 'face' ? 'camera' : 'shield'} size={18} color={colors.primary} />
                  <Text style={[styles.bioBtnText, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>
                    Use {biometricType === 'face' ? 'Face ID' : 'Fingerprint'}
                  </Text>
                </TouchableOpacity>
              )}
              {mode === 'enter_mpin' && (
                <TouchableOpacity onPress={handleForgotPin} activeOpacity={0.7} disabled={forgotBusy}>
                  <Text style={[styles.forgotText, { color: colors.textMuted, fontFamily: 'Inter_500Medium' }]}>
                    {forgotBusy ? 'Signing out…' : 'Forgot PIN?'}
                  </Text>
                </TouchableOpacity>
              )}
              {mode !== 'enter_mpin' && (
                <TouchableOpacity onPress={() => setMode('choose')} activeOpacity={0.7}>
                  <Text style={[styles.backText, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>← Back</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 24 },
  cooldownWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  cooldownText: { fontSize: 13 },
  iconWrap: { width: 88, height: 88, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  titleWrap: { alignItems: 'center', gap: 8 },
  title: { fontSize: 26, textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, maxWidth: 280 },
  optionsWrap: { width: '100%', gap: 16 },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 16, borderWidth: 1 },
  optionIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  optionText: { flex: 1, gap: 4 },
  optionTitle: { fontSize: 16 },
  optionSub: { fontSize: 13 },
  skipBtn: { alignItems: 'center', paddingVertical: 12 },
  skipText: { fontSize: 14 },
  pinWrap: { width: '100%', alignItems: 'center', gap: 24 },
  dotsRow: { flexDirection: 'row', gap: 16 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, backgroundColor: 'transparent' },
  pinError: { fontSize: 14, marginTop: -8 },
  pad: { gap: 12, width: '100%', maxWidth: 320 },
  padRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  padKey: { flex: 1, height: 72, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  padEmpty: { flex: 1, height: 72 },
  padKeyText: { fontSize: 26 },
  pinActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  bioBtnSmall: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  bioBtnText: { fontSize: 14 },
  backText: { fontSize: 14 },
  forgotText: { fontSize: 14 },
  forgotBtnCentered: { alignItems: 'center', paddingVertical: 12 },
});
