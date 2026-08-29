import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockOtpRequest = jest.fn();
const mockClearSignedOutNotice = jest.fn();
const mockGetItem = jest.fn((_key: string) => Promise.resolve('true'));
const mockSetItem = jest.fn((_key: string, _value: string) => Promise.resolve(undefined));

jest.mock('@workspace/api-client-react', () => ({
  authOtpRequest: (...args: unknown[]) => mockOtpRequest(...args),
}));

jest.mock('expo-router', () => {
  return {
    useRouter: () => ({
      push: mockPush,
      replace: mockReplace,
      back: mockBack,
    }),
    useLocalSearchParams: () => ({}),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => mockGetItem(key),
    setItem: (key: string, value: string) => mockSetItem(key, value),
  },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    signedOutNotice: null,
    clearSignedOutNotice: mockClearSignedOutNotice,
  }),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Error: 'error' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import AuthIndex from '../app/(auth)/index';
import TermsScreen from '../app/(auth)/terms';
import PhoneScreen from '../app/(auth)/phone';

describe('mobile OTP-only auth entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue('true');
    mockOtpRequest.mockResolvedValue({ message: 'Code sent' });
  });

  it('starts at the reference welcome screen and keeps OTP as the only login path', async () => {
    render(<AuthIndex />);

    expect(screen.queryByText('Create Account')).toBeNull();
    expect(screen.getByText('Welcome to')).toBeTruthy();
    expect(screen.getByText('Avarpus')).toBeTruthy();
    expect(screen.getByText('Agree and Continue')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('Agree and Continue'));
    });
    expect(mockPush).toHaveBeenCalledWith('/(auth)/phone');
    expect(screen.queryByText(/SIM|device key|SMS bridge|verify with SIM/i)).toBeNull();
  });

  it('continues from terms directly to the mobile OTP form', async () => {
    render(<TermsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByText('Agree & Continue'));
    });

    expect(mockSetItem).toHaveBeenCalledWith('avarpus_terms_accepted', 'true');
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/phone');
  });

  it('renders mobile OTP as the only sign-in action and requests a code', async () => {
    render(<PhoneScreen />);

    await waitFor(() => expect(screen.getByText('Enter your mobile number')).toBeTruthy());
    expect(screen.getByPlaceholderText('10-digit mobile number')).toBeTruthy();
    expect(screen.getByText('Continue')).toBeTruthy();
    expect(screen.queryByText(/SIM|device key|SMS bridge|verify with SIM|sign in with/i)).toBeNull();

    fireEvent.changeText(screen.getByPlaceholderText('10-digit mobile number'), '9876543210');
    await act(async () => {
      fireEvent.press(screen.getByText('Continue'));
    });

    expect(mockOtpRequest).toHaveBeenCalledWith({ mobile: '9876543210' });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(auth)/otp',
      params: { mobile: '9876543210', rememberMe: '0' },
    });
  });
});