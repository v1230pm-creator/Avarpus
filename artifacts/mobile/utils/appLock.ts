import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureDeleteItem } from './secureStorage';

export const BIOMETRIC_ENABLED_KEY = '@vmc_biometric_enabled';

// Removed MPIN storage keys. They remain here only so upgraded installations
// can erase old PIN material and throttle state from the device.
const LEGACY_MPIN_SECURE_KEY = 'vmc_mpin';
const LEGACY_MPIN_SETUP_KEY = '@vmc_mpin_setup';
const LEGACY_MPIN_KEY = '@vmc_mpin';
const LEGACY_PIN_FAILED_ATTEMPTS_KEY = '@vmc_pin_failed_attempts';
const LEGACY_PIN_LOCKOUT_UNTIL_KEY = '@vmc_pin_lockout_until';

let unlocked = false;

type LockListener = (unlocked: boolean) => void;
const listeners = new Set<LockListener>();

export function isUnlocked(): boolean {
  return unlocked;
}

export function setUnlocked(value: boolean): void {
  if (unlocked === value) return;
  unlocked = value;
  listeners.forEach((listener) => {
    try {
      listener(value);
    } catch {}
  });
}

export const BACKGROUND_RELOCK_GRACE_MS = 30 * 1000;

export function shouldRelockAfterBackground(
  backgroundedAtMs: number | null,
  nowMs: number,
  graceMs: number = BACKGROUND_RELOCK_GRACE_MS,
): boolean {
  if (backgroundedAtMs == null) return false;
  return nowMs - backgroundedAtMs >= graceMs;
}

export function subscribeLockState(listener: LockListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Removes all obsolete MPIN records. This is safe to call repeatedly and does
 * not touch the biometric app-lock preference.
 */
export async function clearLegacyMpinData(): Promise<void> {
  await Promise.all([
    secureDeleteItem(LEGACY_MPIN_SECURE_KEY),
    AsyncStorage.multiRemove([
      LEGACY_MPIN_SETUP_KEY,
      LEGACY_MPIN_KEY,
      LEGACY_PIN_FAILED_ATTEMPTS_KEY,
      LEGACY_PIN_LOCKOUT_UNTIL_KEY,
    ]),
  ]);
}

export async function isBiometricLockEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY)) === 'true';
}

export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
  } else {
    await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
    setUnlocked(true);
  }
}

export async function completeUnlockSuccess(): Promise<void> {
  setUnlocked(true);
}

/** True only when biometric/device-credential app lock is enabled. */
export async function isLockEnabled(): Promise<boolean> {
  // Cleanup is best-effort here so a SecureStore issue cannot manufacture a
  // lock state. It will be retried on the next startup/settings visit.
  await clearLegacyMpinData().catch(() => {});
  return isBiometricLockEnabled();
}
