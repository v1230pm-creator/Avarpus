import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, otpVerificationRateLimitsTable } from "@workspace/db";

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
// Password and request/resend throttles below are process-local. Login OTP
// verification uses the durable, cross-instance reservation mechanism below.

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

export interface WindowReservation extends LimitStatus {
  /**
   * Hand the reserved slot back. Only for callers that can prove the guarded
   * action never happened (e.g. the SMS request never left this process).
   * One-shot, and bound to the exact window entry that was reserved: if the
   * window has since rolled over, releasing is a no-op rather than a debit
   * against the newer window. No-op when `limited` is true.
   */
  release(): void;
}

export type OtpVerificationAttempt =
  | { status: "approved" }
  | { status: "rejected" }
  | { status: "provider_error" }
  | { status: "in_flight"; retryAfterMs: number }
  | { status: "limited"; retryAfterMs: number };

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
 * Hash a rate-limit key before persisting it. The durable record only contains
 * the minimum lockout state, never an OTP code or provider credential.
 */
export function otpVerificationRateLimitKeyHash(key: string): string {
  return crypto.createHash("sha256").update(`otp-verification-limit:v1:${key}`).digest("hex");
}

/**
 * Run one login OTP verification attempt under a durable per-mobile reservation.
 *
 * Both database transactions are short. OTP verification runs outside them,
 * so a slow provider cannot monopolize database connections. A random token
 * ensures that only the request that owns the reservation can finalize it.
 */
export async function verifyOtpWithDurableLimit(
  key: string,
  verifyWithProvider: () => Promise<boolean>,
): Promise<OtpVerificationAttempt> {
  const keyHash = otpVerificationRateLimitKeyHash(key);
  const reservation = await reserveOtpVerificationAttempt(key, keyHash);

  if (reservation.status !== "reserved") {
    return reservation;
  }

  let providerError = false;
  let approved = false;
  try {
    approved = await verifyWithProvider();
  } catch {
    providerError = true;
  }

  return finalizeOtpVerificationAttempt(
    key,
    keyHash,
    reservation.token,
    approved,
    providerError,
  );
}

// OTP verification reservations expire after a strict 10-second window.
// Leave additional time for the final short DB transaction and clock skew.
const PROVIDER_RESERVATION_MS = 30 * 1000;

type OtpVerificationReservation =
  | { status: "reserved"; token: string }
  | Extract<OtpVerificationAttempt, { status: "limited" | "in_flight" }>;

async function reserveOtpVerificationAttempt(
  key: string,
  keyHash: string,
): Promise<OtpVerificationReservation> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);

    const nowDate = new Date();
    const nowMs = nowDate.getTime();
    const [existing] = await tx
      .select()
      .from(otpVerificationRateLimitsTable)
      .where(eq(otpVerificationRateLimitsTable.keyHash, keyHash))
      .limit(1);

    if (existing?.lockedUntil && existing.lockedUntil.getTime() > nowMs) {
      return {
        status: "limited" as const,
        retryAfterMs: existing.lockedUntil.getTime() - nowMs,
      };
    }
    if (existing?.inFlightUntil && existing.inFlightUntil.getTime() > nowMs) {
      return {
        status: "in_flight" as const,
        retryAfterMs: existing.inFlightUntil.getTime() - nowMs,
      };
    }

    const currentWindow =
      existing !== undefined &&
      nowMs - existing.windowStartedAt.getTime() <= FAILURE_WINDOW_MS;
    const windowStartedAt = currentWindow ? existing.windowStartedAt : nowDate;
    const inFlightUntil = new Date(nowMs + PROVIDER_RESERVATION_MS);
    const token = crypto.randomUUID();
    const expiresAt = new Date(
      Math.max(windowStartedAt.getTime() + FAILURE_WINDOW_MS, inFlightUntil.getTime()),
    );

    await tx
      .insert(otpVerificationRateLimitsTable)
      .values({
        keyHash,
        failureCount: currentWindow ? existing.failureCount : 0,
        windowStartedAt,
        lockedUntil: null,
        inFlightToken: token,
        inFlightUntil,
        expiresAt,
        updatedAt: nowDate,
      })
      .onConflictDoUpdate({
        target: otpVerificationRateLimitsTable.keyHash,
        set: {
          failureCount: currentWindow ? existing.failureCount : 0,
          windowStartedAt,
          lockedUntil: null,
          inFlightToken: token,
          inFlightUntil,
          expiresAt,
          updatedAt: nowDate,
        },
      });

    return { status: "reserved" as const, token };
  });
}

async function finalizeOtpVerificationAttempt(
  key: string,
  keyHash: string,
  token: string,
  approved: boolean,
  providerError: boolean,
): Promise<OtpVerificationAttempt> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);

    const nowDate = new Date();
    const nowMs = nowDate.getTime();
    const [existing] = await tx
      .select()
      .from(otpVerificationRateLimitsTable)
      .where(eq(otpVerificationRateLimitsTable.keyHash, keyHash))
      .limit(1);

    if (!existing || existing.inFlightToken !== token) {
      return {
        status: "in_flight" as const,
        retryAfterMs: Math.max(
          1_000,
          (existing?.inFlightUntil?.getTime() ?? nowMs) - nowMs,
        ),
      };
    }

    if (approved) {
      await tx
        .delete(otpVerificationRateLimitsTable)
        .where(eq(otpVerificationRateLimitsTable.keyHash, keyHash));
      return { status: "approved" as const };
    }

    const currentWindow = nowMs - existing.windowStartedAt.getTime() <= FAILURE_WINDOW_MS;
    const failureCount = currentWindow ? existing.failureCount + 1 : 1;
    const windowStartedAt = currentWindow ? existing.windowStartedAt : nowDate;
    const lockedUntil =
      failureCount >= MAX_FAILURES ? new Date(nowMs + LOCKOUT_MS) : null;
    const expiresAt = lockedUntil ?? new Date(windowStartedAt.getTime() + FAILURE_WINDOW_MS);

    await tx
      .update(otpVerificationRateLimitsTable)
      .set({
        failureCount,
        windowStartedAt,
        lockedUntil,
        inFlightToken: null,
        inFlightUntil: null,
        expiresAt,
        updatedAt: nowDate,
      })
      .where(eq(otpVerificationRateLimitsTable.keyHash, keyHash));

    return { status: providerError ? "provider_error" as const : "rejected" as const };
  });
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

const NO_RELEASE = () => {};

function releaseFrom(key: string, entry: WindowEntry): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Identity check: a rolled-over window is a fresh object, and a slot from
    // the old window must never be refunded against the new one.
    if (windows.get(key) !== entry) return;
    entry.count -= 1;
    if (entry.count <= 0) windows.delete(key);
  };
}

/**
 * Fixed-window throttle: allow at most `max` calls per `windowMs` for a key.
 * Counts every call, successful or not, unless the caller explicitly gives the
 * slot back via `release()` (see `WindowReservation`).
 */
export function checkWindowLimit(key: string, max: number, windowMs: number): WindowReservation {
  const t = now();
  const entry = windows.get(key);
  if (!entry || t - entry.windowStart > windowMs) {
    const fresh: WindowEntry = { count: 1, windowStart: t };
    windows.set(key, fresh);
    return { limited: false, retryAfterMs: 0, release: releaseFrom(key, fresh) };
  }
  if (entry.count >= max) {
    return { limited: true, retryAfterMs: entry.windowStart + windowMs - t, release: NO_RELEASE };
  }
  entry.count += 1;
  return { limited: false, retryAfterMs: 0, release: releaseFrom(key, entry) };
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
  PROVIDER_RESERVATION_MS,
};
