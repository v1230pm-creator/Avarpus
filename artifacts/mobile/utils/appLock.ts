import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureGetItem, secureSetItem, secureDeleteItem } from './secureStorage';

// SecureStore keys may only contain alphanumerics, ".", "-", "_"
export const MPIN_SECURE_KEY = 'vmc_mpin';
export const MPIN_SETUP_KEY = '@vmc_mpin_setup';
export const BIOMETRIC_ENABLED_KEY = '@vmc_biometric_enabled';

// Legacy plaintext AsyncStorage key (migrated to SecureStore on read)
const LEGACY_MPIN_KEY = '@vmc_mpin';

// In-memory flag: true once the user has unlocked in this session.
let unlocked = false;

type LockListener = (unlocked: boolean) => void;
const listeners = new Set<LockListener>();

export function isUnlocked() {
  return unlocked;
}

export function setUnlocked(value: boolean) {
  if (unlocked === value) return;
  unlocked = value;
  listeners.forEach((l) => {
    try {
      l(value);
    } catch {}
  });
}

/**
 * How long the app may stay in the background before it re-locks.
 * Short interruptions (permission dialogs, quick app switches) stay under
 * this and do not force a re-unlock.
 */
export const BACKGROUND_RELOCK_GRACE_MS = 30 * 1000;

/**
 * Pure decision helper: should the app re-lock given when it was backgrounded?
 * `backgroundedAtMs` is null when the app never actually entered background
 * (e.g. an iOS `inactive` blip from a permission dialog or control center).
 */
export function shouldRelockAfterBackground(
  backgroundedAtMs: number | null,
  nowMs: number,
  graceMs: number = BACKGROUND_RELOCK_GRACE_MS,
): boolean {
  if (backgroundedAtMs == null) return false;
  return nowMs - backgroundedAtMs >= graceMs;
}

/** Subscribe to unlock-state changes. Returns an unsubscribe function. */
export function subscribeLockState(listener: LockListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Returns the stored MPIN, migrating any legacy plaintext value to SecureStore. */
export async function getStoredMpin(): Promise<string | null> {
  const secure = await secureGetItem(MPIN_SECURE_KEY);
  if (secure) return secure;

  const legacy = await AsyncStorage.getItem(LEGACY_MPIN_KEY);
  if (legacy) {
    await secureSetItem(MPIN_SECURE_KEY, legacy);
    await AsyncStorage.removeItem(LEGACY_MPIN_KEY);
    return legacy;
  }
  return null;
}

export async function storeMpin(pin: string): Promise<void> {
  await secureSetItem(MPIN_SECURE_KEY, pin);
  await AsyncStorage.setItem(MPIN_SETUP_KEY, 'true');
}

export async function clearMpin(): Promise<void> {
  await secureDeleteItem(MPIN_SECURE_KEY);
  await AsyncStorage.removeItem(MPIN_SETUP_KEY);
  await AsyncStorage.removeItem(LEGACY_MPIN_KEY);
}

/**
 * Turns off the app lock entirely (biometric flag + PIN).
 *
 * Failure-safe ordering: the biometric flag is removed first, then the PIN.
 * If the second step fails the user is left with a working PIN lock — never a
 * biometric-only lock, which can become unusable if biometric enrollment or
 * hardware availability changes.
 */
export async function disableAppLock(): Promise<void> {
  await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
  await clearMpin();
}

/** True when a PIN or biometric unlock has been configured. */
export async function isLockEnabled(): Promise<boolean> {
  const [mpin, bio] = await Promise.all([
    getStoredMpin(),
    AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY),
  ]);
  return !!mpin || bio === 'true';
}
