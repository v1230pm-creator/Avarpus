/**
 * Verifies the OTP screen surfaces auth errors instead of failing silently.
 *
 * The mock boundary is the API client (network layer) — the real
 * AuthContext error mapping and the real OTP screen render run in the test:
 *  - server error responses (ApiError with data.message) show verbatim
 *  - network failures (fetch TypeError) show a human-readable fallback
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// ── Mocks (network + native boundaries only) ─────────────────────────────
const mockOtpVerify = jest.fn();
jest.mock('@workspace/api-client-react', () => ({
  authOtpRequest: jest.fn(),
  authOtpVerify: (...args: unknown[]) => mockOtpVerify(...args),
  authLogin: jest.fn(),
  authLogout: jest.fn(),
  authMe: jest.fn(),
  setUnauthorizedHandler: jest.fn(),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({ mobile: '9876543210', rememberMe: '0' }),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Error: 'error', Success: 'success' },
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/utils/seedData', () => ({ seedIfNeeded: jest.fn(async () => {}) }));
jest.mock('@/utils/storage', () => ({
  KEYS: { AUTH_TOKEN: 'auth_token', CURRENT_USER: 'current_user' },
  storage: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
  },
}));

import { AuthProvider } from '@/context/AuthContext';
import OTPScreen from '../app/(auth)/otp';

/** Mimics the shape thrown by the API client on an HTTP error response. */
class FakeApiError extends Error {
  data: { message: string };
  status: number;
  constructor(status: number, message: string) {
    super(`HTTP ${status}`);
    this.status = status;
    this.data = { message };
  }
}

async function renderScreen() {
  const utils = render(
    <AuthProvider>
      <OTPScreen />
    </AuthProvider>,
  );
  // Let AuthProvider's mount effect (storage read) settle inside act
  await act(async () => {});
  return utils;
}

async function fillOtpAndVerify() {
  const inputs = screen.UNSAFE_getAllByType(require('react-native').TextInput);
  await act(async () => {
    fireEvent.changeText(inputs[0], '123456');
  });
  await act(async () => {
    fireEvent.press(screen.getByText('Verify & Continue'));
  });
}

describe('OTP screen error display', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the exact error message returned by the API', async () => {
    mockOtpVerify.mockRejectedValue(new FakeApiError(401, 'Incorrect code. Please try again.'));
    const { unmount } = await renderScreen();
    await fillOtpAndVerify();
    await waitFor(() =>
      expect(screen.getByText('Incorrect code. Please try again.')).toBeTruthy(),
    );
    expect(mockReplace).not.toHaveBeenCalled();
    unmount();
  });

  it('shows the rate-limit message from the API verbatim', async () => {
    const msg = 'Too many failed attempts. Try again in 15 minutes.';
    mockOtpVerify.mockRejectedValue(new FakeApiError(429, msg));
    const { unmount } = await renderScreen();
    await fillOtpAndVerify();
    await waitFor(() => expect(screen.getByText(msg)).toBeTruthy());
    unmount();
  });

  it('shows a readable fallback when the server is unreachable (fetch network error)', async () => {
    // What fetch throws when the server is down — no .data, message contains "fetch"
    mockOtpVerify.mockRejectedValue(new TypeError('Network request failed: fetch failed'));
    const { unmount } = await renderScreen();
    await fillOtpAndVerify();
    await waitFor(() =>
      expect(screen.getByText('Verification failed. Please try again.')).toBeTruthy(),
    );
    expect(mockReplace).not.toHaveBeenCalled();
    unmount();
  });

  it('navigates onward on success and shows no error', async () => {
    mockOtpVerify.mockResolvedValue({
      token: 'tok',
      user: { id: 'u1', name: 'T', email: 't@x.y', mobile: '9876543210', role: 'dealer', isActive: true },
    });
    const { unmount } = await renderScreen();
    await fillOtpAndVerify();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/biometric'));
    expect(screen.queryByText(/failed|incorrect/i)).toBeNull();
    unmount();
  });
});
