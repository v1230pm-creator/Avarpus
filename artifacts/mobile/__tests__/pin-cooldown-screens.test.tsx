/**
 * The persisted PIN cooldown must actually block the PIN pads at the screen
 * level — reopening the lock screen (app restart) or re-entering a verify
 * flow on the Security screen must NOT grant fresh attempts:
 *  - lock screen mounted with an active persisted cooldown: pad keys are
 *    disabled, the countdown is shown, and even the CORRECT PIN cannot unlock
 *  - once the cooldown expires, the pad accepts input and unlocks again
 *  - same for the verify-PIN flows on Security (change PIN, turn off lock,
 *    turn off biometric), including cancelling and reopening the pad
 *
 * Real appLock utils + real usePinThrottle run against persisted (mock)
 * storage; only native boundaries are mocked.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/utils/secureStorage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    secureGetItem: jest.fn(async (key: string) => store[key] ?? null),
    secureSetItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    secureDeleteItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
    __store: store,
  };
});

// Back expo-crypto with node's crypto so PIN hashing works in tests.
jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto');
  return {
    __esModule: true,
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: jest.fn(async (_alg: string, data: string) =>
      nodeCrypto.createHash('sha256').update(data, 'utf8').digest('hex'),
    ),
    getRandomBytesAsync: jest.fn(async (n: number) => nodeCrypto.randomBytes(n)),
  };
});

jest.mock('expo-local-authentication', () => ({
  __esModule: true,
  hasHardwareAsync: jest.fn(async () => false),
  isEnrolledAsync: jest.fn(async () => false),
  supportedAuthenticationTypesAsync: jest.fn(async () => []),
  authenticateAsync: jest.fn(async () => ({ success: false })),
  AuthenticationType: { FACIAL_RECOGNITION: 2, FINGERPRINT: 1 },
}));

jest.mock('expo-haptics', () => ({
  __esModule: true,
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

const mockRouter = { replace: jest.fn(), back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => mockRouter,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { __esModule: true, LinearGradient: View };
});
jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return { __esModule: true, BlurView: View };
});
jest.mock('@expo/vector-icons', () => ({
  __esModule: true,
  Feather: () => null,
}));

// The lock screen only uses `logout` (Forgot PIN, not under test here).
jest.mock('@/context/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ logout: jest.fn() }),
}));

import React from 'react';
import { Switch } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  PIN_FAILED_ATTEMPTS_KEY,
  PIN_LOCKOUT_UNTIL_KEY,
  BIOMETRIC_ENABLED_KEY,
  getPinThrottleState,
  setUnlocked,
  storeMpin,
} from '@/utils/appLock';
import BiometricScreen from '@/app/(auth)/biometric';
import SecurityScreen from '@/app/(tabs)/more/security';

const CORRECT_PIN = '123456';
const COOLDOWN_MS = 30_000;

/** Persists a 5-failure state whose cooldown is still active "now". */
async function persistActiveCooldown() {
  await AsyncStorage.setItem(PIN_FAILED_ATTEMPTS_KEY, '5');
  await AsyncStorage.setItem(PIN_LOCKOUT_UNTIL_KEY, String(Date.now() + COOLDOWN_MS));
}

const flush = async (times = 3) => {
  for (let i = 0; i < times; i++) await act(async () => {});
};

const pressKey = (key: string) => fireEvent.press(screen.getByText(key));

const enterPin = (pin: string) => {
  for (const digit of pin) pressKey(digit);
};

const expireCooldown = async () => {
  await act(async () => {
    jest.advanceTimersByTime(COOLDOWN_MS + 1_000);
  });
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  const store = (require('@/utils/secureStorage') as any).__store as Record<string, string>;
  Object.keys(store).forEach((k) => delete store[k]);
  setUnlocked(false);
  await storeMpin(CORRECT_PIN);
});

afterEach(() => {
  setUnlocked(false);
});

// ── Lock screen (app restart with a persisted cooldown) ──────────────────
describe('lock screen with a persisted active cooldown', () => {
  async function mountLockScreen() {
    render(<BiometricScreen />);
    // Let checkCapabilities + the throttle state read settle.
    await flush();
    // Sanity: we're on the enter-PIN pad.
    expect(screen.getByText('Enter Your PIN')).toBeTruthy();
  }

  it('shows the countdown and refuses all pad input — even the correct PIN', async () => {
    await persistActiveCooldown();
    await mountLockScreen();

    // Countdown banner is visible.
    expect(screen.getByText(/Try again in/)).toBeTruthy();

    // Keys are disabled: pressing fires nothing (handlePad starts with a
    // haptic, so no haptic call proves the press never reached the handler).
    enterPin(CORRECT_PIN);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();

    await flush();
    // No unlock happened and the persisted counter is untouched.
    expect(mockRouter.replace).not.toHaveBeenCalled();
    const state = await getPinThrottleState();
    expect(state.failedAttempts).toBe(5);
    expect(state.lockedUntilMs).not.toBeNull();
  });

  it('remounting the lock screen does not grant fresh attempts', async () => {
    await persistActiveCooldown();
    const first = render(<BiometricScreen />);
    await flush();
    first.unmount();

    // "Restart": a brand-new mount must still be locked.
    await mountLockScreen();
    expect(screen.getByText(/Try again in/)).toBeTruthy();
    enterPin(CORRECT_PIN);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('unlocks again once the cooldown expires', async () => {
    await persistActiveCooldown();
    await mountLockScreen();
    expect(screen.getByText(/Try again in/)).toBeTruthy();

    await expireCooldown();
    expect(screen.queryByText(/Try again in/)).toBeNull();

    enterPin(CORRECT_PIN);
    expect(Haptics.impactAsync).toHaveBeenCalled();
    // 6th digit defers submission by 300ms, then verifies the PIN.
    await act(async () => {
      jest.advanceTimersByTime(301);
    });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)'));

    // Successful unlock cleared the persisted counter.
    const state = await getPinThrottleState();
    expect(state.failedAttempts).toBe(0);
    expect(state.lockedUntilMs).toBeNull();
  });
});

// ── Security screen verify-PIN flows ──────────────────────────────────────
describe('Security screen verify flows with a persisted active cooldown', () => {
  async function mountSecurity() {
    render(<SecurityScreen />);
    await flush();
  }

  async function assertPadBlocked() {
    expect(screen.getByText(/Try again in/)).toBeTruthy();
    const hapticCalls = (Haptics.impactAsync as jest.Mock).mock.calls.length;
    enterPin(CORRECT_PIN);
    // Keys are disabled, so no press reached the handler.
    expect((Haptics.impactAsync as jest.Mock).mock.calls.length).toBe(hapticCalls);
    await flush();
    const state = await getPinThrottleState();
    expect(state.failedAttempts).toBe(5);
  }

  it('Change PIN: pad is blocked while the cooldown is active, even after cancel + reopen', async () => {
    await persistActiveCooldown();
    await mountSecurity();

    fireEvent.press(screen.getByText('Change PIN'));
    await flush();
    await assertPadBlocked();

    // Navigate away (cancel) and back in — still blocked.
    fireEvent.press(screen.getByText('Cancel'));
    fireEvent.press(screen.getByText('Change PIN'));
    await flush();
    await assertPadBlocked();
  });

  it('Change PIN: works again once the cooldown expires', async () => {
    await persistActiveCooldown();
    await mountSecurity();
    fireEvent.press(screen.getByText('Change PIN'));
    await flush();
    expect(screen.getByText(/Try again in/)).toBeTruthy();

    await expireCooldown();
    expect(screen.queryByText(/Try again in/)).toBeNull();

    enterPin(CORRECT_PIN);
    await act(async () => {
      jest.advanceTimersByTime(251);
    });
    // Correct PIN accepted → moved on to entering the new PIN.
    await waitFor(() => expect(screen.getByText('Enter new PIN')).toBeTruthy());

    // The successful verification reset the persisted counter.
    const state = await getPinThrottleState();
    expect(state.failedAttempts).toBe(0);
    expect(state.lockedUntilMs).toBeNull();
  });

  it('Turn off lock: pad is blocked while the cooldown is active', async () => {
    await persistActiveCooldown();
    await mountSecurity();

    fireEvent.press(screen.getByText('Turn off lock'));
    await flush();
    expect(screen.getByText('Enter PIN to turn off lock')).toBeTruthy();
    await assertPadBlocked();
    // Lock is still on.
    const store = (require('@/utils/secureStorage') as any).__store as Record<string, string>;
    expect(Object.keys(store).length).toBeGreaterThan(0);
  });

  it('Turn off biometric: pad is blocked while the cooldown is active', async () => {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
    await persistActiveCooldown();
    await mountSecurity();

    const toggle = screen.UNSAFE_getByType(Switch);
    await act(async () => {
      fireEvent(toggle, 'valueChange', false);
    });
    await flush();
    await assertPadBlocked();
    // Biometric flag untouched.
    expect(await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY)).toBe('true');
  });
});
