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

/** True when a PIN or biometric unlock has been configured. */
export async function isLockEnabled(): Promise<boolean> {
  const [mpin, bio] = await Promise.all([
    getStoredMpin(),
    AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY),
  ]);
  return !!mpin || bio === 'true';
}
