jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  completeUnlockSuccess,
  isUnlocked,
  setUnlocked,
  getCooldownMs,
  getPinThrottleState,
  MAX_FREE_ATTEMPTS,
  recordFailedPinAttempt,
  remainingCooldownMs,
  resetPinAttempts,
} from '@/utils/appLock';

describe('PIN attempt throttling', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('allows the first attempts without cooldown', () => {
    for (let i = 0; i < MAX_FREE_ATTEMPTS; i++) {
      expect(getCooldownMs(i)).toBe(0);
    }
  });

  it('escalates the cooldown after the threshold', () => {
    expect(getCooldownMs(5)).toBe(30_000);
    expect(getCooldownMs(6)).toBe(60_000);
    expect(getCooldownMs(7)).toBe(5 * 60_000);
    expect(getCooldownMs(8)).toBe(15 * 60_000);
    expect(getCooldownMs(9)).toBe(30 * 60_000);
    expect(getCooldownMs(20)).toBe(30 * 60_000);
  });

  it('persists failed attempts and starts a cooldown on the 5th failure', async () => {
    const now = 1_000_000;
    for (let i = 0; i < 4; i++) {
      const state = await recordFailedPinAttempt(now);
      expect(state.lockedUntilMs).toBeNull();
    }
    const fifth = await recordFailedPinAttempt(now);
    expect(fifth.failedAttempts).toBe(5);
    expect(fifth.lockedUntilMs).toBe(now + 30_000);

    // State survives a "restart" (fresh read from storage).
    const persisted = await getPinThrottleState();
    expect(persisted.failedAttempts).toBe(5);
    expect(persisted.lockedUntilMs).toBe(now + 30_000);
  });

  it('computes remaining cooldown and expires it', async () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) await recordFailedPinAttempt(now);
    const state = await getPinThrottleState();
    expect(remainingCooldownMs(state, now + 10_000)).toBe(20_000);
    expect(remainingCooldownMs(state, now + 30_000)).toBe(0);
    expect(remainingCooldownMs(state, now + 60_000)).toBe(0);
  });

  it('keeps escalating after an expired cooldown until a successful unlock', async () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) await recordFailedPinAttempt(now);
    // Cooldown expired, but next failure escalates to the 1-minute step.
    const sixth = await recordFailedPinAttempt(now + 40_000);
    expect(sixth.lockedUntilMs).toBe(now + 40_000 + 60_000);
  });

  it('resets counter and cooldown on success', async () => {
    for (let i = 0; i < 6; i++) await recordFailedPinAttempt(1_000_000);
    await resetPinAttempts();
    const state = await getPinThrottleState();
    expect(state.failedAttempts).toBe(0);
    expect(state.lockedUntilMs).toBeNull();
    expect(remainingCooldownMs(state, 1_000_001)).toBe(0);
  });

  it('does not lose increments under concurrent failure reports', async () => {
    // Simulates rapid UI submissions racing each other: every failure must
    // count, so the cooldown threshold cannot be skipped.
    const now = 1_000_000;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => recordFailedPinAttempt(now)),
    );
    const counts = results.map((r) => r.failedAttempts).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6]);

    const state = await getPinThrottleState();
    expect(state.failedAttempts).toBe(6);
    // 6th failure escalates to the 1-minute step.
    expect(state.lockedUntilMs).toBe(now + 60_000);
  });

  it('shared success path (used by biometric unlock) clears attempts and cooldown', async () => {
    // Regression: failed PIN attempts followed by a successful biometric
    // unlock must not leave a persisted counter/cooldown behind.
    setUnlocked(false);
    for (let i = 0; i < 6; i++) await recordFailedPinAttempt(1_000_000);

    await completeUnlockSuccess();

    expect(isUnlocked()).toBe(true);
    const state = await getPinThrottleState();
    expect(state.failedAttempts).toBe(0);
    expect(state.lockedUntilMs).toBeNull();
    setUnlocked(false);
  });
});
