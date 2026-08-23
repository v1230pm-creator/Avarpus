// Lightweight in-memory rate limiting for auth endpoints.
//
// Two mechanisms:
// 1. Failure-based lockout (password login): record failed attempts per key
//    (account identifier and IP). After MAX_FAILURES failures within the
//    window, further attempts are blocked until the lockout expires.
//    A successful login clears the account's failure counter.
// 2. Fixed-window request throttle (OTP request): cap the number of requests
//    per key within a window regardless of outcome, to prevent email flooding.
//
// State is per-process and resets on restart — acceptable for this app's
// single-instance deployment; a restart simply gives attackers a fresh window.

interface FailureEntry {
  count: number;
  firstFailureAt: number;
  lockedUntil: number | null;
}

interface WindowEntry {
  count: number;
  windowStart: number;
}

const FAILURE_WINDOW_MS = 15 * 60 * 1000; // failures older than this are forgotten
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const failures = new Map<string, FailureEntry>();
const windows = new Map<string, WindowEntry>();
const locks = new Map<string, Promise<void>>();

function now(): number {
  return Date.now();
}

export interface LimitStatus {
  limited: boolean;
  retryAfterMs: number;
}

/** Human-friendly wait description, e.g. "14 minutes" or "45 seconds". */
export function retryAfterText(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (ms >= 60_000) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

/** Check whether a failure-lockout key is currently blocked. */
export function checkFailureLockout(key: string): LimitStatus {
  const entry = failures.get(key);
  if (!entry) return { limited: false, retryAfterMs: 0 };
  const t = now();
  if (entry.lockedUntil !== null) {
    if (t < entry.lockedUntil) {
      return { limited: true, retryAfterMs: entry.lockedUntil - t };
    }
    failures.delete(key); // lockout expired
    return { limited: false, retryAfterMs: 0 };
  }
  if (t - entry.firstFailureAt > FAILURE_WINDOW_MS) {
    failures.delete(key); // stale window
  }
  return { limited: false, retryAfterMs: 0 };
}

/** Record a failed attempt; starts a lockout once MAX_FAILURES is reached. */
export function recordFailure(key: string): void {
  const t = now();
  const entry = failures.get(key);
  if (!entry || t - entry.firstFailureAt > FAILURE_WINDOW_MS) {
    failures.set(key, { count: 1, firstFailureAt: t, lockedUntil: null });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    entry.lockedUntil = t + LOCKOUT_MS;
  }
}

/** Clear failures for a key (call on successful authentication). */
export function clearFailures(key: string): void {
  failures.delete(key);
}

/**
 * Serialize async work for one rate-limit key. OTP verification holds this
 * lock while it checks the failure state and calls its remote provider, so
 * concurrent attempts cannot all bypass a just-created lockout.
 */
export async function acquireRateLimitLock(key: string): Promise<() => void> {
  const previous = locks.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;

  return () => {
    releaseCurrent();
    if (locks.get(key) === queued) locks.delete(key);
  };
}

/**
 * Fixed-window throttle: allow at most `max` calls per `windowMs` for a key.
 * Counts every call, successful or not.
 */
export function checkWindowLimit(key: string, max: number, windowMs: number): LimitStatus {
  const t = now();
  const entry = windows.get(key);
  if (!entry || t - entry.windowStart > windowMs) {
    windows.set(key, { count: 1, windowStart: t });
    return { limited: false, retryAfterMs: 0 };
  }
  if (entry.count >= max) {
    return { limited: true, retryAfterMs: entry.windowStart + windowMs - t };
  }
  entry.count += 1;
  return { limited: false, retryAfterMs: 0 };
}

// Periodically drop stale entries so the maps don't grow unbounded.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const t = now();
  for (const [key, e] of failures) {
    const expired =
      (e.lockedUntil !== null && t >= e.lockedUntil) ||
      (e.lockedUntil === null && t - e.firstFailureAt > FAILURE_WINDOW_MS);
    if (expired) failures.delete(key);
  }
  for (const [key, e] of windows) {
    // Longest window used anywhere is 15 minutes; anything older is stale.
    if (t - e.windowStart > 15 * 60 * 1000) windows.delete(key);
  }
}, SWEEP_INTERVAL_MS).unref();

// Exported for tests/tuning visibility.
export const RATE_LIMIT_CONSTANTS = {
  FAILURE_WINDOW_MS,
  MAX_FAILURES,
  LOCKOUT_MS,
};
