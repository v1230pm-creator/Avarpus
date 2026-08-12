import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { scryptAsync } from '@noble/hashes/scrypt.js';
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

// ── PIN hashing ───────────────────────────────────────────────────────────
// PINs are never stored in plain form. The current record format is
//   `v2$scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`
// using the scrypt memory-hard KDF (via @noble/hashes, pure JS — works in
// Hermes and on web). A keychain/SecureStore dump therefore doesn't reveal
// the PIN, and offline brute-force of the 6-digit space is made expensive
// by scrypt's memory cost. Older records are still accepted by verifyMpin
// and upgraded to v2 on the first successful verification:
//   - `v1$<saltHex>$<iterations>$<hashHex>` (iterated SHA-256, capped)
//   - raw plaintext PINs written before hashing existed
// All parameters parsed from a stored record are strictly bounded so a
// tampered/corrupted record can never cause unbounded work.

const PIN_RECORD_V2 = 'v2';
const PIN_RECORD_V1 = 'v1';

// scrypt cost parameters. Chosen so verification completes in well under a
// second even in Hermes' pure-JS runtime (N=32768 took ~15s on-device).
// Online guessing is throttled by the escalating attempt lockout below, so
// the KDF only needs to slow *offline* brute force of a keychain dump —
// N=1024/r=8 (~1 MB) is an acceptable trade-off for a 6-digit PIN.
const SCRYPT_N = 1024; // 2^10
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;

// Strict upper bounds when parsing parameters out of stored records.
const MAX_SCRYPT_N = 1 << 17;
const MAX_SCRYPT_R = 16;
const MAX_SCRYPT_P = 4;
const MAX_V1_ITERATIONS = 10_000;

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/** True when a stored value is a hashed record (vs. a legacy plaintext PIN). */
export function isHashedPinRecord(value: string): boolean {
  return value.startsWith(`${PIN_RECORD_V2}$`) || value.startsWith(`${PIN_RECORD_V1}$`);
}

/** True when a record already uses the current format AND cost parameters. */
export function isCurrentPinRecord(value: string): boolean {
  return value.startsWith(`${PIN_RECORD_V2}$scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$`);
}

async function scryptHex(
  pin: string,
  saltHex: string,
  N: number,
  r: number,
  p: number,
): Promise<string> {
  const hash = await scryptAsync(new TextEncoder().encode(pin), new TextEncoder().encode(saltHex), {
    N,
    r,
    p,
    dkLen: SCRYPT_DKLEN,
  });
  return bytesToHex(hash);
}

/** Legacy v1 derivation: iterated SHA-256 of `<saltHex>:<pin>`. */
async function derivePinHashV1(pin: string, saltHex: string, iterations: number): Promise<string> {
  let digest = `${saltHex}:${pin}`;
  for (let i = 0; i < iterations; i++) {
    digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, digest);
  }
  return digest;
}

/** Produces a salted scrypt hash record for a PIN. Exported for tests. */
export async function hashPin(pin: string): Promise<string> {
  const salt = await Crypto.getRandomBytesAsync(16);
  const saltHex = bytesToHex(salt);
  const hash = await scryptHex(pin, saltHex, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `${PIN_RECORD_V2}$scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${saltHex}$${hash}`;
}

/** Constant-time-ish string comparison (avoids early-exit on first mismatch). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseBoundedInt(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,9}$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** Verifies a PIN against a stored record (hashed or legacy plaintext). */
export async function verifyPinAgainstRecord(pin: string, record: string): Promise<boolean> {
  if (record.startsWith(`${PIN_RECORD_V2}$`)) {
    const parts = record.split('$');
    if (parts.length !== 7 || parts[1] !== 'scrypt') return false;
    const [, , nRaw, rRaw, pRaw, saltHex, hash] = parts;
    const N = parseBoundedInt(nRaw, 2, MAX_SCRYPT_N);
    const r = parseBoundedInt(rRaw, 1, MAX_SCRYPT_R);
    const p = parseBoundedInt(pRaw, 1, MAX_SCRYPT_P);
    // N must be a power of two for scrypt.
    if (N == null || r == null || p == null || (N & (N - 1)) !== 0) return false;
    if (!saltHex || !hash) return false;
    const candidate = await scryptHex(pin, saltHex, N, r, p);
    return safeEqual(candidate, hash);
  }
  if (record.startsWith(`${PIN_RECORD_V1}$`)) {
    const parts = record.split('$');
    if (parts.length !== 4) return false;
    const [, saltHex, iterRaw, hash] = parts;
    const iterations = parseBoundedInt(iterRaw, 1, MAX_V1_ITERATIONS);
    if (!saltHex || !hash || iterations == null) return false;
    const candidate = await derivePinHashV1(pin, saltHex, iterations);
    return safeEqual(candidate, hash);
  }
  // Legacy plaintext record.
  return safeEqual(pin, record);
}

/**
 * Returns the stored MPIN record (hashed or legacy plaintext), migrating any
 * legacy plaintext AsyncStorage value into SecureStore as a hashed record.
 */
async function getStoredMpinRecord(): Promise<string | null> {
  const secure = await secureGetItem(MPIN_SECURE_KEY);
  if (secure) return secure;

  const legacy = await AsyncStorage.getItem(LEGACY_MPIN_KEY);
  if (legacy) {
    // Never persist the plaintext anywhere new — hash it during migration.
    const record = await hashPin(legacy);
    await secureSetItem(MPIN_SECURE_KEY, record);
    await AsyncStorage.removeItem(LEGACY_MPIN_KEY);
    return record;
  }
  return null;
}

/** True when an MPIN has been configured. */
export async function hasStoredMpin(): Promise<boolean> {
  return (await getStoredMpinRecord()) != null;
}

/**
 * Verifies the entered PIN against the stored record. If the stored record is
 * a legacy plaintext PIN or an older hash format, it is upgraded to the
 * current scrypt record on the first successful verification.
 */
export async function verifyMpin(pin: string): Promise<boolean> {
  const record = await getStoredMpinRecord();
  if (!record) return false;
  const ok = await verifyPinAgainstRecord(pin, record);
  if (ok && !isCurrentPinRecord(record)) {
    try {
      await secureSetItem(MPIN_SECURE_KEY, await hashPin(pin));
    } catch {
      // Migration failure is non-fatal: the old record still verifies.
    }
  }
  return ok;
}

export async function storeMpin(pin: string): Promise<void> {
  await secureSetItem(MPIN_SECURE_KEY, await hashPin(pin));
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
    hasStoredMpin(),
    AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY),
  ]);
  return mpin || bio === 'true';
}
