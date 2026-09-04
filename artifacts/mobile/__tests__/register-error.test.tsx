/**
 * Verifies the register screen surfaces API error strings instead of failing
 * silently. The mock boundary is the API client (network layer) — the real
 * register screen and AuthContext run in the test:
 *  - /register/start errors (duplicate account, cooldown) show verbatim
 *  - /register/verify errors (wrong code) show verbatim
 *  - network failures show a human-readable fallback
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// ── Mocks (network + native boundaries only) ─────────────────────────────
const mockRegisterStart = jest.fn();
const mockRegisterVerify = jest.fn();
jest.mock('@workspace/api-client-react', () => ({
  authRegisterStart: (...args: unknown[]) => mockRegisterStart(...args),
  authRegisterVerify: (...args: unknown[]) => mockRegisterVerify(...args),
  authLogin: jest.fn(),
  authLogout: jest.fn(),
  authMe: jest.fn(),
  authOtpRequest: jest.fn(),
  authOtpVerify: jest.fn(),
  setUnauthorizedHandler: jest.fn(),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Error: 'error', Success: 'success' },
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
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
import RegisterScreen from '../app/(auth)/register';

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
      <RegisterScreen />
    </AuthProvider>,
  );
  // Let AuthProvider's mount effect (storage read) settle inside act
  await act(async () => {});
  return utils;
}

/** Fills the current dealer form and presses "Send OTP & Continue". */
async function fillDealerFormAndSubmit() {
  const type = (placeholder: string, value: string) =>
    fireEvent.changeText(screen.getByPlaceholderText(placeholder), value);
  await act(async () => {
    type('Your shop / business name', 'Test Business');
    type('Owner full name', 'Test Owner');
    type('name@company.com', 'owner@example.test');
    type('10-digit mobile', '9876543210');
    type('Full shop address', '12 Market Road');
  });
  await act(async () => {
    fireEvent.press(screen.getByText('Send OTP & Continue'));
  });
}

async function fillOtpAndVerify() {
  const inputs = screen.UNSAFE_getAllByType(require('react-native').TextInput);
  // The six OTP cells are the only single-char number-pad inputs on this step;
  // pasting the whole code into the first cell distributes across the cells.
  await act(async () => {
    fireEvent.changeText(inputs[0], '123456');
  });
  await act(async () => {
    fireEvent.press(screen.getByText('Verify & Create Dealer Account'));
  });
}

describe('Register screen error display', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the exact /register/start error message from the API', async () => {
    const msg = 'Account with this email or mobile already exists';
    mockRegisterStart.mockRejectedValue(new FakeApiError(409, msg));
    const { unmount } = await renderScreen();
    await fillDealerFormAndSubmit();
    await waitFor(() => expect(screen.getByText(msg)).toBeTruthy());
    // Still on the form step — never advanced to OTP entry
    expect(screen.queryByText('Verify Email')).toBeNull();
    unmount();
  });

  it('shows the resend-cooldown message from the API verbatim', async () => {
    const msg = 'Please wait 45 seconds before requesting another code.';
    mockRegisterStart.mockRejectedValue(new FakeApiError(429, msg));
    const { unmount } = await renderScreen();
    await fillDealerFormAndSubmit();
    await waitFor(() => expect(screen.getByText(msg)).toBeTruthy());
    unmount();
  });

  it('shows a readable fallback when the server is unreachable on start', async () => {
    mockRegisterStart.mockRejectedValue(new TypeError('Network request failed: fetch failed'));
    const { unmount } = await renderScreen();
    await fillDealerFormAndSubmit();
    await waitFor(() =>
      expect(screen.getByText('Could not send OTP. Please try again.')).toBeTruthy(),
    );
    unmount();
  });

  it('shows the exact /register/verify error message from the API', async () => {
    mockRegisterStart.mockResolvedValue({ message: 'Verification code sent' });
    const msg = 'Incorrect code. Please try again.';
    mockRegisterVerify.mockRejectedValue(new FakeApiError(401, msg));
    const { unmount } = await renderScreen();
    await fillDealerFormAndSubmit();
    await waitFor(() => expect(screen.getByText('Verify Email')).toBeTruthy());
    await fillOtpAndVerify();
    await waitFor(() => expect(screen.getByText(msg)).toBeTruthy());
    // No success screen, no navigation
    expect(mockReplace).not.toHaveBeenCalled();
    unmount();
  });

  it('completes registration on successful verify and shows no error', async () => {
    mockRegisterStart.mockResolvedValue({ message: 'Verification code sent' });
    mockRegisterVerify.mockResolvedValue({
      token: 'tok',
      user: {
        id: 'u1', name: 'Test Owner', email: 'owner@example.test',
        mobile: '9876543210', role: 'dealer', isActive: true,
      },
    });
    const { unmount } = await renderScreen();
    await fillDealerFormAndSubmit();
    await waitFor(() => expect(screen.getByText('Verify Email')).toBeTruthy());
    await fillOtpAndVerify();
    await waitFor(() => expect(mockRegisterVerify).toHaveBeenCalledWith({
      email: 'owner@example.test',
      code: '123456',
    }));
    expect(screen.queryByText(/failed|incorrect|already exists/i)).toBeNull();
    unmount();
  });
});
