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

// ── PIN attempt throttling ────────────────────────────────────────────────
// After MAX_FREE_ATTEMPTS wrong PINs, further attempts are blocked by an
// escalating cooldown. State is persisted so restarting the app doesn't
// reset the counter.

export const PIN_FAILED_ATTEMPTS_KEY = '@vmc_pin_failed_attempts';
export const PIN_LOCKOUT_UNTIL_KEY = '@vmc_pin_lockout_until';

/** Wrong attempts allowed before the first cooldown kicks in. */
export const MAX_FREE_ATTEMPTS = 5;

/**
 * Escalating cooldown for a given failed-attempt count.
 * Returns 0 while under the free-attempt threshold.
 * 5th wrong attempt → 30s, 6th → 1m, 7th → 5m, 8th → 15m, 9th+ → 30m.
 */
export function getCooldownMs(failedAttempts: number): number {
  if (failedAttempts < MAX_FREE_ATTEMPTS) return 0;
  const over = failedAttempts - MAX_FREE_ATTEMPTS;
  const steps = [30_000, 60_000, 5 * 60_000, 15 * 60_000];
  return over < steps.length ? steps[over] : 30 * 60_000;
}

export interface PinThrottleState {
  failedAttempts: number;
  /** Epoch ms until which attempts are blocked, or null when not locked out. */
  lockedUntilMs: number | null;
}

/** Reads the persisted throttle state. Fails closed on storage errors. */
export async function getPinThrottleState(): Promise<PinThrottleState> {
  const [attemptsRaw, untilRaw] = await Promise.all([
    AsyncStorage.getItem(PIN_FAILED_ATTEMPTS_KEY),
    AsyncStorage.getItem(PIN_LOCKOUT_UNTIL_KEY),
  ]);
  const failedAttempts = Math.max(0, parseInt(attemptsRaw ?? '0', 10) || 0);
  const until = parseInt(untilRaw ?? '0', 10) || 0;
  return { failedAttempts, lockedUntilMs: until > 0 ? until : null };
}

// Serializes all throttle read-modify-write operations so concurrent callers
// (e.g. rapid UI submissions) can never lose increments.
let throttleQueue: Promise<unknown> = Promise.resolve();
function enqueueThrottleOp<T>(op: () => Promise<T>): Promise<T> {
  const next = throttleQueue.then(op, op);
  throttleQueue = next.catch(() => {});
  return next;
}

/**
 * Records a wrong PIN entry and returns the new state (including any new
 * cooldown). `nowMs` defaults to Date.now(). Calls are serialized, so
 * concurrent failures each count.
 */
export function recordFailedPinAttempt(nowMs: number = Date.now()): Promise<PinThrottleState> {
  return enqueueThrottleOp(async () => {
    const prev = await getPinThrottleState();
    const failedAttempts = prev.failedAttempts + 1;
    const cooldown = getCooldownMs(failedAttempts);
    const lockedUntilMs = cooldown > 0 ? nowMs + cooldown : null;
    await AsyncStorage.setItem(PIN_FAILED_ATTEMPTS_KEY, String(failedAttempts));
    if (lockedUntilMs != null) {
      await AsyncStorage.setItem(PIN_LOCKOUT_UNTIL_KEY, String(lockedUntilMs));
    } else {
      await AsyncStorage.removeItem(PIN_LOCKOUT_UNTIL_KEY);
    }
    return { failedAttempts, lockedUntilMs };
  });
}

/** Clears the failed-attempt counter and any active cooldown (successful unlock). */
export function resetPinAttempts(): Promise<void> {
  return enqueueThrottleOp(async () => {
    await AsyncStorage.removeItem(PIN_FAILED_ATTEMPTS_KEY);
    await AsyncStorage.removeItem(PIN_LOCKOUT_UNTIL_KEY);
  });
}

/**
 * Remaining cooldown in ms at `nowMs`, or 0 when input is allowed.
 * A persisted lockout that has expired counts as 0 (but the attempt counter
 * stays until a successful unlock, so the next failure escalates).
 */
export function remainingCooldownMs(state: PinThrottleState, nowMs: number = Date.now()): number {
  if (state.lockedUntilMs == null) return 0;
  return Math.max(0, state.lockedUntilMs - nowMs);
}

/**
 * Shared success path for ANY unlock method (PIN or biometric): clears the
 * failed-attempt counter/cooldown, then marks the session unlocked. Every
 * successful unlock must go through this so no method leaves a stale
 * escalated cooldown behind.
 */
export async function completeUnlockSuccess(): Promise<void> {
  try {
    await resetPinAttempts();
  } finally {
    // Even if clearing the counter fails, a successful auth must unlock.
    setUnlocked(true);
  }
}

/** True when a PIN or biometric unlock has been configured. */
export async function isLockEnabled(): Promise<boolean> {
  const [mpin, bio] = await Promise.all([
    getStoredMpin(),
    AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY),
  ]);
  return !!mpin || bio === 'true';
}
