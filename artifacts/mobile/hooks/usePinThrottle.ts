import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPinThrottleState,
  recordFailedPinAttempt,
  remainingCooldownMs,
  resetPinAttempts,
} from '@/utils/appLock';

/** Formats a remaining-ms value as "M:SS" or "Ns". */
export function formatCooldown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * PIN attempt throttling with a live countdown.
 *
 * - `cooldownMs > 0` means input must be blocked; show the countdown.
 * - Call `recordFailure()` after each wrong PIN.
 * - Call `recordSuccess()` after a successful verification.
 *
 * Fails closed: if the persisted state can't be read, the pad stays usable
 * only after the read resolves (`ready`), and read errors leave `ready`
 * false so callers can decide to block.
 */
export function usePinThrottle() {
  const [ready, setReady] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const lockedUntilRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startCountdown = useCallback((lockedUntilMs: number | null) => {
    lockedUntilRef.current = lockedUntilMs;
    stopTimer();
    const tick = () => {
      const until = lockedUntilRef.current;
      const remaining = until == null ? 0 : Math.max(0, until - Date.now());
      setCooldownMs(remaining);
      if (remaining <= 0) stopTimer();
    };
    tick();
    if (lockedUntilMs != null && lockedUntilMs > Date.now()) {
      timerRef.current = setInterval(tick, 250);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await getPinThrottleState();
        if (cancelled) return;
        setFailedAttempts(state.failedAttempts);
        if (remainingCooldownMs(state) > 0) startCountdown(state.lockedUntilMs);
        setReady(true);
      } catch {
        // Leave ready=false; callers treat the pad as unavailable.
      }
    })();
    return () => {
      cancelled = true;
      stopTimer();
    };
  }, [startCountdown]);

  const recordFailure = useCallback(async () => {
    const state = await recordFailedPinAttempt();
    setFailedAttempts(state.failedAttempts);
    if (state.lockedUntilMs != null) startCountdown(state.lockedUntilMs);
    return state;
  }, [startCountdown]);

  const recordSuccess = useCallback(async () => {
    await resetPinAttempts();
    setFailedAttempts(0);
    startCountdown(null);
  }, [startCountdown]);

  return { ready, cooldownMs, failedAttempts, recordFailure, recordSuccess };
}
