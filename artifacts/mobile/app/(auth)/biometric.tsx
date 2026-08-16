import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BIOMETRIC_ENABLED_KEY,
  completeUnlockSuccess,
  disableAppLock,
  hasStoredMpin,
  setUnlocked,
  storeMpin,
  verifyMpin,
} from '@/utils/appLock';
import { formatCooldown, usePinThrottle } from '@/hooks/usePinThrottle';
import { useAuth } from '@/context/AuthContext';

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

  const [mode, setMode] = useState<Mode>('loading');
  const [hasBiometric, setHasBiometric] = useState(false);
  const [biometricType, setBiometricType] = useState<'fingerprint' | 'face'>('fingerprint');
  const [mpinSetup, setMpinSetup] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // MPIN state
  const [mpin, setMpin] = useState('');
  const [confirmMpin, setConfirmMpin] = useState('');
  const [enteredMpin, setEnteredMpin] = useState('');
  const [mpinError, setMpinError] = useState('');

  // Brute-force throttling for PIN entry (persisted across restarts).
  const throttle = usePinThrottle();
  const cooldownActive = throttle.cooldownMs > 0;
  // Synchronous guard: set the moment the 6th digit is entered, cleared only
  // after verification + throttle writes finish. Blocks any further pad input
  // (including backspace/re-entry) so concurrent guesses are impossible.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  // Animations
  const cardY = useSharedValue(40);
  const cardOpacity = useSharedValue(0);
  const shakeX = useSharedValue(0);
  const dotScale = useSharedValue(1);

  useEffect(() => {
    cardY.value = withSpring(0, { damping: 20, stiffness: 140 });
    cardOpacity.value = withTiming(1, { duration: 500 });
    checkCapabilities();
  }, []);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardY.value }],
    opacity: cardOpacity.value,
  }));

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

      // If already configured — go directly to verify. Skip is only reachable
      // once we've positively confirmed no lock is configured.
      if (savedMpin) {
        setMode('enter_mpin');
      } else if (bioEnabled === 'true') {
        // Biometric lock is configured — never show setup/skip, even if
        // biometric hardware/enrollment is currently unavailable.
        setMode('bio_unlock');
        if (compatible && enrolled) triggerBiometric();
      } else {
        setMode('choose');
      }
    } catch {
      // Fail closed: if we can't read the lock configuration, require the PIN.
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
        // Shared success path: resets the PIN attempt counter/cooldown too.
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
      // Block input entirely while a cooldown is active, a submission is in
      // flight, or the throttle state is unknown.
      if (cooldownActive || !throttle.ready || submittingRef.current) return;
      if (key === '⌫') { setEnteredMpin((p) => p.slice(0, -1)); setMpinError(''); return; }
      if (enteredMpin.length >= 6) return;
      const next = enteredMpin + key;
      setEnteredMpin(next);
      if (next.length === 6) {
        // Close the pre-submit window synchronously: no more input (delete or
        // re-entry) until this guess and its throttle write fully complete.
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
      // Clear the local lock (biometric flag first, then PIN), then sign out.
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
      // eslint-disable-next-line no-alert
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
    // Skipping is only allowed during first-time setup (no lock configured yet).
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
    <View style={styles.root}>
      <LinearGradient
        colors={['#0B0F1A', '#0E1422']}
        locations={[0, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Glow circles */}
      <View style={[styles.glow, { top: -100, left: -80, width: 280, height: 280, backgroundColor: '#3A8FF7' }]} />
      <View style={[styles.glow, { bottom: -80, right: -60, width: 220, height: 220, backgroundColor: '#2F80ED' }]} />

      <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        {/* Icon */}
        <Reanimated.View style={[styles.iconWrap, cardStyle]}>
          <LinearGradient colors={['#2F80ED', '#3A8FF7']} style={styles.iconGrad}>
            <Feather
              name={mode === 'enter_mpin' || mode === 'setup_mpin' || mode === 'confirm_mpin'
                ? 'lock' : biometricType === 'face' ? 'camera' : 'shield'}
              size={32}
              color="#FFFFFF"
            />
          </LinearGradient>
        </Reanimated.View>

        {/* Title */}
        <Reanimated.View style={[styles.titleWrap, cardStyle]}>
          <Text style={[styles.title, { fontFamily: 'Inter_700Bold' }]}>{title}</Text>
          <Text style={[styles.subtitle, { fontFamily: 'Inter_400Regular' }]}>{subtitle}</Text>
        </Reanimated.View>

        {/* ── Biometric-only unlock (no skip) ── */}
        {mode === 'bio_unlock' && (
          <Reanimated.View style={[styles.optionsWrap, cardStyle]}>
            <TouchableOpacity style={styles.optionCard} onPress={triggerBiometric} activeOpacity={0.8}>
              {Platform.OS === 'ios' ? (
                <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
              ) : null}
              <LinearGradient colors={['rgba(47, 128, 237, 0.10)', 'rgba(47, 128, 237, 0.10)']} style={StyleSheet.absoluteFill} />
              <View style={styles.optionIcon}>
                <Feather name={biometricType === 'face' ? 'camera' : 'shield'} size={28} color="#3A8FF7" />
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionTitle, { fontFamily: 'Inter_600SemiBold' }]}>
                  Unlock with {biometricType === 'face' ? 'Face ID' : 'Fingerprint'}
                </Text>
                <Text style={[styles.optionSub, { fontFamily: 'Inter_400Regular' }]}>
                  Tap to authenticate
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color="#3A8FF7" />
            </TouchableOpacity>

            {/* Recovery: always available, even when biometric hardware/enrollment is unavailable */}
            <TouchableOpacity
              onPress={handleForgotPin}
              activeOpacity={0.7}
              disabled={forgotBusy}
              style={styles.forgotBtnCentered}
            >
              <Text style={[styles.forgotText, { fontFamily: 'Inter_500Medium' }]}>
                {forgotBusy ? 'Signing out…' : "Can't unlock? Sign out & reset"}
              </Text>
            </TouchableOpacity>
          </Reanimated.View>
        )}

        {/* ── Choose mode ── */}
        {mode === 'choose' && (
          <Reanimated.View style={[styles.optionsWrap, cardStyle]}>
            {/* Fingerprint option */}
            {hasBiometric && (
              <TouchableOpacity style={styles.optionCard} onPress={enableBiometric} activeOpacity={0.8}>
                {Platform.OS === 'ios' ? (
                  <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
                ) : null}
                <LinearGradient colors={['rgba(47, 128, 237, 0.10)', 'rgba(47, 128, 237, 0.10)']} style={StyleSheet.absoluteFill} />
                <View style={styles.optionIcon}>
                  <Feather name={biometricType === 'face' ? 'camera' : 'shield'} size={28} color="#3A8FF7" />
                </View>
                <View style={styles.optionText}>
                  <Text style={[styles.optionTitle, { fontFamily: 'Inter_600SemiBold' }]}>
                    {biometricType === 'face' ? 'Face ID' : 'Fingerprint'}
                  </Text>
                  <Text style={[styles.optionSub, { fontFamily: 'Inter_400Regular' }]}>
                    Use biometric to unlock instantly
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color="#3A8FF7" />
              </TouchableOpacity>
            )}

            {/* MPIN option */}
            <TouchableOpacity
              style={styles.optionCard}
              onPress={() => { setMode('setup_mpin'); setMpin(''); }}
              activeOpacity={0.8}
            >
              {Platform.OS === 'ios' ? (
                <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
              ) : null}
              <LinearGradient colors={['rgba(47, 128, 237, 0.10)', 'rgba(47, 128, 237, 0.10)']} style={StyleSheet.absoluteFill} />
              <View style={styles.optionIcon}>
                <Feather name="lock" size={28} color="#3A8FF7" />
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionTitle, { fontFamily: 'Inter_600SemiBold' }]}>Set MPIN</Text>
                <Text style={[styles.optionSub, { fontFamily: 'Inter_400Regular' }]}>
                  Create a 6-digit security PIN
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color="#3A8FF7" />
            </TouchableOpacity>

            {/* Skip */}
            <TouchableOpacity style={styles.skipBtn} onPress={skipAll} activeOpacity={0.7}>
              <Text style={[styles.skipText, { fontFamily: 'Inter_400Regular' }]}>Skip for now</Text>
            </TouchableOpacity>
          </Reanimated.View>
        )}

        {/* ── PIN pad (setup / confirm / enter) ── */}
        {(mode === 'setup_mpin' || mode === 'confirm_mpin' || mode === 'enter_mpin') && (
          <Reanimated.View style={[styles.pinWrap, cardStyle]}>
            {/* Dot indicators */}
            <Reanimated.View style={[styles.dotsRow, shakeStyle]}>
              {DOTS.map((i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    currentPin.length > i && styles.dotFilled,
                    mpinError && styles.dotError,
                  ]}
                />
              ))}
            </Reanimated.View>

            {/* Error message */}
            {!!mpinError && (
              <Text style={[styles.pinError, { fontFamily: 'Inter_400Regular' }]}>{mpinError}</Text>
            )}

            {/* Cooldown countdown */}
            {mode === 'enter_mpin' && cooldownActive && (
              <View style={styles.cooldownWrap}>
                <Feather name="clock" size={14} color="#F59E0B" />
                <Text style={[styles.cooldownText, { fontFamily: 'Inter_600SemiBold' }]}>
                  Try again in {formatCooldown(throttle.cooldownMs)}
                </Text>
              </View>
            )}

            {/* Numpad */}
            <View style={styles.pad}>
              {PAD.map((row, ri) => (
                <View key={ri} style={styles.padRow}>
                  {row.map((key, ki) => {
                    if (key === '') return <View key={ki} style={styles.padEmpty} />;
                    return (
                      <TouchableOpacity
                        key={ki}
                        style={[
                          styles.padKey,
                          key === '⌫' && styles.padBackspace,
                          mode === 'enter_mpin' && (cooldownActive || submitting) && { opacity: 0.35 },
                        ]}
                        onPress={() => handlePad(key)}
                        activeOpacity={0.7}
                        disabled={mode === 'enter_mpin' && (cooldownActive || submitting)}
                      >
                        {key === '⌫' ? (
                          <Feather name="delete" size={20} color="#A8B3C7" />
                        ) : (
                          <Text style={[styles.padKeyText, { fontFamily: 'Inter_600SemiBold' }]}>{key}</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Bottom actions */}
            <View style={styles.pinActions}>
              {mode === 'enter_mpin' && hasBiometric && biometricEnabled && (
                <TouchableOpacity onPress={triggerBiometric} style={styles.bioBtnSmall} activeOpacity={0.7}>
                  <Feather name={biometricType === 'face' ? 'camera' : 'shield'} size={18} color="#3A8FF7" />
                  <Text style={[styles.bioBtnText, { fontFamily: 'Inter_500Medium' }]}>
                    Use {biometricType === 'face' ? 'Face ID' : 'Fingerprint'}
                  </Text>
                </TouchableOpacity>
              )}
              {mode === 'enter_mpin' && (
                <TouchableOpacity onPress={handleForgotPin} activeOpacity={0.7} disabled={forgotBusy}>
                  <Text style={[styles.forgotText, { fontFamily: 'Inter_500Medium' }]}>
                    {forgotBusy ? 'Signing out…' : 'Forgot PIN?'}
                  </Text>
                </TouchableOpacity>
              )}
              {mode !== 'enter_mpin' && (
                <TouchableOpacity onPress={() => setMode('choose')} activeOpacity={0.7}>
                  <Text style={[styles.backText, { fontFamily: 'Inter_400Regular' }]}>← Back</Text>
                </TouchableOpacity>
              )}
            </View>
          </Reanimated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  glow: { position: 'absolute', borderRadius: 999, opacity: 0.02 },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 20,
  },

  // Cooldown
  cooldownWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F59E0B15',
    borderWidth: 1,
    borderColor: '#F59E0B33',
  },
  cooldownText: { fontSize: 13, color: '#F59E0B' },

  // Icon
  iconWrap: { marginBottom: 4 },
  iconGrad: {
    width: 80, height: 80, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#3A8FF7', shadowOpacity: 0.45, shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 }, elevation: 10,
  },

  // Title
  titleWrap: { alignItems: 'center', gap: 8 },
  title: { fontSize: 22, color: '#F5F7FA', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#A8B3C7', textAlign: 'center', lineHeight: 20, maxWidth: 260 },

  // Options (choose mode)
  optionsWrap: { width: '100%', gap: 14 },
  optionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: Platform.OS === 'ios' ? 'rgba(20, 30, 48, 0.58)' : 'rgba(20, 30, 48, 0.58)',
    overflow: 'hidden',
  },
  optionIcon: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: 'rgba(17, 27, 45, 0.68)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  optionText: { flex: 1, gap: 4 },
  optionTitle: { fontSize: 15, color: '#F5F7FA' },
  optionSub: { fontSize: 12, color: '#A8B3C7' },

  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipText: { fontSize: 13, color: '#7F8BA3' },

  // PIN pad
  pinWrap: { width: '100%', alignItems: 'center', gap: 24 },
  dotsRow: { flexDirection: 'row', gap: 14 },
  dot: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: '#3A8FF7', borderColor: '#3A8FF7' },
  dotError: { borderColor: '#EF4444' },
  pinError: { fontSize: 13, color: '#EF4444', marginTop: -8 },

  pad: { gap: 12, width: '100%', maxWidth: 300 },
  padRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  padKey: {
    flex: 1, height: 68, borderRadius: 16,
    backgroundColor: 'rgba(20, 30, 48, 0.58)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  padBackspace: { backgroundColor: 'rgba(17, 27, 45, 0.68)' },
  padEmpty: { flex: 1, height: 68 },
  padKeyText: { fontSize: 22, color: '#F5F7FA' },

  pinActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  bioBtnSmall: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  bioBtnText: { fontSize: 13, color: '#3A8FF7' },
  backText: { fontSize: 13, color: '#7F8BA3' },
  forgotText: { fontSize: 13, color: '#A8B3C7' },
  forgotBtnCentered: { alignItems: 'center', paddingVertical: 10 },
});
