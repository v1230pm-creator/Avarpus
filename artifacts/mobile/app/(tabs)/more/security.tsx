import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/ui/Card';
import { ScreenGlow, FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import {
  BIOMETRIC_ENABLED_KEY,
  disableAppLock,
  getStoredMpin,
  storeMpin,
} from '@/utils/appLock';
import { formatCooldown, usePinThrottle } from '@/hooks/usePinThrottle';

const DOTS = [0, 1, 2, 3, 4, 5];
const PAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

// What the PIN pad is currently being used for.
type PadPurpose =
  | 'verify_change' // verify current PIN before changing it
  | 'new_pin' // enter the new PIN
  | 'confirm_new' // confirm the new PIN
  | 'setup_pin' // first-time PIN setup (no current PIN)
  | 'confirm_setup' // confirm first-time PIN
  | 'verify_disable' // verify current PIN before disabling the lock
  | 'verify_bio_off'; // verify current PIN before turning biometric off

export default function SecurityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const [loading, setLoading] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [hasBiometricHw, setHasBiometricHw] = useState(false);
  const [biometricType, setBiometricType] = useState<'fingerprint' | 'face'>('fingerprint');
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // PIN pad state
  const [padPurpose, setPadPurpose] = useState<PadPurpose | null>(null);
  const [entered, setEntered] = useState('');
  const [pendingNewPin, setPendingNewPin] = useState('');
  const [padError, setPadError] = useState('');
  const [busy, setBusy] = useState(false);

  // Brute-force throttling: only applies to purposes that verify the
  // existing PIN (not to entering/confirming a new one).
  const throttle = usePinThrottle();
  const isVerifyPurpose =
    padPurpose === 'verify_change' || padPurpose === 'verify_disable' || padPurpose === 'verify_bio_off';
  const cooldownBlocked = isVerifyPurpose && (throttle.cooldownMs > 0 || !throttle.ready);

  // Operation token: bumped whenever the pad flow starts, changes purpose, or
  // is cancelled, so any queued (deferred) PIN submission from a previous or
  // cancelled flow is invalidated and can never mutate lock state.
  const opTokenRef = useRef(0);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Synchronous in-flight guard: true while completePin is executing, so
  // cancel/back cannot interrupt a submission mid-write.
  const inFlightRef = useRef(false);
  // Synchronous pre-submit guard: set the moment the 6th digit is entered
  // (before the deferred submission fires) so no further input — backspace or
  // re-entry — can race an in-flight guess.
  const pendingSubmitRef = useRef(false);

  const invalidatePendingSubmit = () => {
    opTokenRef.current += 1;
    pendingSubmitRef.current = false;
    if (submitTimerRef.current) {
      clearTimeout(submitTimerRef.current);
      submitTimerRef.current = null;
    }
  };

  useEffect(() => () => invalidatePendingSubmit(), []);

  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  const refresh = useCallback(async () => {
    try {
      const [pin, bio, compatible, enrolled, types] = await Promise.all([
        getStoredMpin(),
        AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
      ]);
      setHasPin(!!pin);
      setBiometricEnabled(bio === 'true');
      setHasBiometricHw(compatible && enrolled);
      setBiometricType(
        types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
          ? 'face'
          : 'fingerprint',
      );
    } catch {
      setBanner({ kind: 'error', text: 'Could not read security settings.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  const showBanner = (kind: 'success' | 'error', text: string) => {
    setBanner({ kind, text });
    setTimeout(() => setBanner(null), 3500);
  };

  const startPad = (purpose: PadPurpose) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    invalidatePendingSubmit();
    setBanner(null);
    setPadPurpose(purpose);
    setEntered('');
    setPendingNewPin('');
    setPadError('');
  };

  // Internal close that skips the in-flight guard — only called by the
  // submission itself once its writes have fully completed.
  const forceClosePad = () => {
    invalidatePendingSubmit();
    setPadPurpose(null);
    setEntered('');
    setPendingNewPin('');
    setPadError('');
  };

  const closePad = () => {
    // Never allow cancelling once a submission is committing lock-state
    // changes — it could leave the lock configuration half-updated.
    if (inFlightRef.current) return;
    forceClosePad();
  };

  const handleWrongPin = async () => {
    const state = await throttle.recordFailure();
    if (state.lockedUntilMs != null) {
      setPadError('Too many wrong attempts.');
    } else {
      const left = Math.max(0, 5 - state.failedAttempts);
      setPadError(
        left <= 2
          ? `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left before a cooldown.`
          : 'Incorrect PIN. Try again.',
      );
    }
    shake();
    setEntered('');
  };

  const completePin = async (pin: string, token: number) => {
    // Ignore submissions from a cancelled or superseded pad flow.
    if (inFlightRef.current || busy || !padPurpose || token !== opTokenRef.current) return;
    // From here until `finally`, cancellation is blocked (closePad / back are
    // no-ops while in flight), so lock-state writes cannot be interrupted or
    // left half-applied.
    inFlightRef.current = true;
    setBusy(true);
    try {
      const saved = await getStoredMpin();
      // Re-verify this is still the active flow before acting on the result.
      if (token !== opTokenRef.current) return;

      switch (padPurpose) {
        case 'verify_change': {
          if (pin === saved) {
            await throttle.recordSuccess();
            setPadPurpose('new_pin');
            setEntered('');
            setPadError('');
          } else {
            await handleWrongPin();
          }
          break;
        }
        case 'new_pin': {
          setPendingNewPin(pin);
          setPadPurpose('confirm_new');
          setEntered('');
          setPadError('');
          break;
        }
        case 'confirm_new': {
          if (pin === pendingNewPin) {
            await storeMpin(pin);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            forceClosePad();
            await refresh();
            showBanner('success', 'Your PIN has been changed.');
          } else {
            setPadError('PINs do not match. Enter the new PIN again.');
            shake();
            setPendingNewPin('');
            setEntered('');
            setPadPurpose('new_pin');
          }
          break;
        }
        case 'setup_pin': {
          setPendingNewPin(pin);
          setPadPurpose('confirm_setup');
          setEntered('');
          setPadError('');
          break;
        }
        case 'confirm_setup': {
          if (pin === pendingNewPin) {
            await storeMpin(pin);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            forceClosePad();
            await refresh();
            showBanner('success', 'PIN lock is now enabled.');
          } else {
            setPadError('PINs do not match. Enter the new PIN again.');
            shake();
            setPendingNewPin('');
            setEntered('');
            setPadPurpose('setup_pin');
          }
          break;
        }
        case 'verify_disable': {
          if (pin === saved) {
            await throttle.recordSuccess();
            // disableAppLock removes the biometric flag before the PIN, so a
            // mid-way failure can never leave a biometric-only lock.
            await disableAppLock();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            forceClosePad();
            await refresh();
            showBanner('success', 'App lock has been turned off.');
          } else {
            await handleWrongPin();
          }
          break;
        }
        case 'verify_bio_off': {
          if (pin === saved) {
            await throttle.recordSuccess();
            await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            forceClosePad();
            await refresh();
            showBanner('success', 'Biometric unlock turned off.');
          } else {
            await handleWrongPin();
          }
          break;
        }
      }
    } catch {
      setPadError('Something went wrong. Your lock was not fully updated — check the current status and try again.');
      shake();
      setEntered('');
      // Re-read storage so the UI reflects the actual (possibly partially
      // updated) lock state rather than an assumed one.
      refresh();
    } finally {
      inFlightRef.current = false;
      pendingSubmitRef.current = false;
      setBusy(false);
    }
  };

  const handlePad = (key: string) => {
    if (busy || cooldownBlocked || pendingSubmitRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (key === '⌫') {
      setEntered((p) => p.slice(0, -1));
      setPadError('');
      return;
    }
    if (entered.length >= 6) return;
    const next = entered + key;
    setEntered(next);
    if (next.length === 6) {
      const token = opTokenRef.current;
      pendingSubmitRef.current = true;
      submitTimerRef.current = setTimeout(() => {
        submitTimerRef.current = null;
        completePin(next, token);
      }, 250);
    }
  };

  const onToggleBiometric = async (value: boolean) => {
    Haptics.selectionAsync();
    setBanner(null);
    if (value) {
      // Enabling requires a successful biometric authentication.
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Verify your identity',
          cancelLabel: 'Cancel',
        });
        if (result.success) {
          await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
          await refresh();
          showBanner('success', 'Biometric unlock enabled.');
        }
      } catch {
        showBanner('error', 'Could not enable biometric unlock.');
      }
    } else if (hasPin) {
      // Turning it off requires the current PIN.
      startPad('verify_bio_off');
    } else {
      // Biometric-only lock: verify biometric before removing it.
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Verify your identity to turn off the lock',
          cancelLabel: 'Cancel',
        });
        if (result.success) {
          await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
          await refresh();
          showBanner('success', 'Biometric unlock turned off.');
        }
      } catch {
        showBanner('error', 'Could not turn off biometric unlock.');
      }
    }
  };

  const padTitle =
    padPurpose === 'verify_change' ? 'Enter current PIN' :
    padPurpose === 'new_pin' ? 'Enter new PIN' :
    padPurpose === 'confirm_new' ? 'Confirm new PIN' :
    padPurpose === 'setup_pin' ? 'Create 6-digit PIN' :
    padPurpose === 'confirm_setup' ? 'Confirm your PIN' :
    padPurpose === 'verify_disable' ? 'Enter PIN to turn off lock' :
    'Enter PIN to continue';

  const padSubtitle =
    padPurpose === 'verify_change' ? 'Verify your current PIN before changing it' :
    padPurpose === 'new_pin' ? 'Pick a new 6-digit PIN you\'ll remember' :
    padPurpose === 'confirm_new' ? 'Re-enter the new PIN to confirm' :
    padPurpose === 'setup_pin' ? 'Pick a 6-digit PIN you\'ll remember' :
    padPurpose === 'confirm_setup' ? 'Re-enter the same PIN to confirm' :
    padPurpose === 'verify_disable' ? 'This removes PIN and biometric lock from this device' :
    'Verify your current PIN to continue';

  const bioLabel = biometricType === 'face' ? 'Face ID' : 'Fingerprint';
  const anims = useStaggerAnim(3);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />

      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity
          onPress={() => (padPurpose ? closePad() : router.back())}
          style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          Security
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {padPurpose ? (
        /* ── PIN pad ── */
        <View style={styles.padScreen}>
          <View style={styles.padTitleWrap}>
            <Text style={[styles.padTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {padTitle}
            </Text>
            <Text style={[styles.padSubtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {padSubtitle}
            </Text>
          </View>

          <Reanimated.View style={[styles.dotsRow, shakeStyle]}>
            {DOTS.map((i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { borderColor: colors.border },
                  entered.length > i && { backgroundColor: colors.primary, borderColor: colors.primary },
                  !!padError && { borderColor: colors.destructive },
                ]}
              />
            ))}
          </Reanimated.View>

          {!!padError && (
            <Text style={[styles.padErrorText, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>
              {padError}
            </Text>
          )}

          {isVerifyPurpose && throttle.cooldownMs > 0 && (
            <View style={[styles.cooldownWrap, { backgroundColor: colors.warning + '15', borderColor: colors.warning + '33' }]}>
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
                      style={[
                        styles.padKey,
                        { backgroundColor: colors.card, borderColor: colors.border },
                        cooldownBlocked && { opacity: 0.35 },
                      ]}
                      onPress={() => handlePad(key)}
                      activeOpacity={0.7}
                      disabled={busy || cooldownBlocked}
                    >
                      {key === '⌫' ? (
                        <Feather name="delete" size={20} color={colors.mutedForeground} />
                      ) : (
                        <Text style={[styles.padKeyText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                          {key}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>

          <TouchableOpacity onPress={closePad} activeOpacity={0.7} style={[styles.cancelBtn, busy && { opacity: 0.4 }]} disabled={busy}>
            <Text style={[styles.cancelText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* ── Overview ── */
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}
        >
          {!!banner && (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: (banner.kind === 'success' ? colors.success : colors.destructive) + '15',
                  borderColor: (banner.kind === 'success' ? colors.success : colors.destructive) + '33',
                },
              ]}
            >
              <Feather
                name={banner.kind === 'success' ? 'check-circle' : 'alert-circle'}
                size={16}
                color={banner.kind === 'success' ? colors.success : colors.destructive}
              />
              <Text
                style={[
                  styles.bannerText,
                  { color: banner.kind === 'success' ? colors.success : colors.destructive, fontFamily: 'Inter_600SemiBold' },
                ]}
              >
                {banner.text}
              </Text>
            </View>
          )}

          {loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : (
            <>
              <FadeInView animValue={anims[0]}>
                <Card>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                        PIN lock
                      </Text>
                      <Text style={[styles.rowSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                        {hasPin
                          ? 'A 6-digit PIN is required to unlock the app.'
                          : 'No PIN is set. Set one to protect the app.'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: (hasPin ? colors.success : colors.mutedForeground) + '15' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          { color: hasPin ? colors.success : colors.mutedForeground, fontFamily: 'Inter_700Bold' },
                        ]}
                      >
                        {hasPin ? 'ON' : 'OFF'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.actionsRow}>
                    {hasPin ? (
                      <TouchableOpacity
                        onPress={() => startPad('verify_change')}
                        style={[styles.actionBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '22' }]}
                      >
                        <Feather name="edit-3" size={16} color={colors.primary} />
                        <Text style={[styles.actionText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                          Change PIN
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={() => startPad('setup_pin')}
                        style={[styles.actionBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '22' }]}
                      >
                        <Feather name="lock" size={16} color={colors.primary} />
                        <Text style={[styles.actionText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                          Set PIN
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </Card>
              </FadeInView>

              <FadeInView animValue={anims[1]}>
                <Card>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                        Unlock with {bioLabel}
                      </Text>
                      <Text style={[styles.rowSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                        {hasBiometricHw
                          ? `Use ${bioLabel.toLowerCase()} instead of typing your PIN.`
                          : 'Biometric authentication is not available on this device.'}
                      </Text>
                    </View>
                    <Switch
                      value={biometricEnabled}
                      onValueChange={onToggleBiometric}
                      disabled={!hasBiometricHw && !biometricEnabled}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                </Card>
              </FadeInView>

              {(hasPin || biometricEnabled) && (
                <FadeInView animValue={anims[2]}>
                  <Card>
                    <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                      Turn off app lock
                    </Text>
                    <Text style={[styles.rowSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      Removes the PIN and biometric lock from this device.
                      {hasPin ? ' You\'ll need to enter your current PIN.' : ''}
                    </Text>
                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        onPress={() => {
                          if (hasPin) {
                            startPad('verify_disable');
                          } else {
                            onToggleBiometric(false);
                          }
                        }}
                        style={[styles.actionBtn, { backgroundColor: colors.destructive + '11', borderColor: colors.destructive + '33' }]}
                      >
                        <Feather name="unlock" size={16} color={colors.destructive} />
                        <Text style={[styles.actionText, { color: colors.destructive, fontFamily: 'Inter_600SemiBold' }]}>
                          Turn off lock
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                </FadeInView>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22 },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },

  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  bannerText: { fontSize: 13, flex: 1 },

  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabel: { fontSize: 15 },
  rowSub: { fontSize: 12, marginTop: 2, lineHeight: 18 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  statusText: { fontSize: 12 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  actionText: { fontSize: 13 },

  // PIN pad
  padScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 22 },
  padTitleWrap: { alignItems: 'center', gap: 6 },
  padTitle: { fontSize: 20, textAlign: 'center' },
  padSubtitle: { fontSize: 13, textAlign: 'center', maxWidth: 280, lineHeight: 19 },
  dotsRow: { flexDirection: 'row', gap: 14 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, backgroundColor: 'transparent' },
  padErrorText: { fontSize: 13, marginTop: -8 },
  cooldownWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  cooldownText: { fontSize: 13 },
  pad: { gap: 12, width: '100%', maxWidth: 300 },
  padRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  padKey: { flex: 1, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  padEmpty: { flex: 1, height: 64 },
  padKeyText: { fontSize: 22 },
  cancelBtn: { paddingVertical: 10 },
  cancelText: { fontSize: 13 },
});
