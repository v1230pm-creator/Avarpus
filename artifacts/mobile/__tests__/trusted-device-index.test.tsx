import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockUseOtpInstead = jest.fn();
let mockAuth = {
  isAuthenticated: false,
  isLoading: true,
  trustedDeviceStatus: 'checking',
  useOtpInstead: mockUseOtpInstead,
};

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff',
    foreground: '#111',
    textMuted: '#777',
    primary: '#00f',
    success: '#0a0',
  }),
}));

jest.mock('@/utils/appLock', () => ({
  isLockEnabled: jest.fn(async () => false),
  isUnlocked: jest.fn(() => true),
}));

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return { Redirect: ({ href }: { href: string }) => <Text>{href}</Text> };
});

import Index from '../app/index';

describe('trusted-device entry status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows checking copy and lets the user choose OTP instead', async () => {
    mockAuth = {
      isAuthenticated: false,
      isLoading: true,
      trustedDeviceStatus: 'checking',
      useOtpInstead: mockUseOtpInstead,
    };
    const view = render(<Index />);

    expect(screen.getByText('Checking trusted device')).toBeTruthy();
    act(() => fireEvent.press(screen.getByText('Use OTP instead')));
    expect(mockUseOtpInstead).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('Checking trusted device')).toBeTruthy());
    view.unmount();
  });

  it('shows the trusted-device verified confirmation before routing onward', async () => {
    mockAuth = {
      isAuthenticated: true,
      isLoading: false,
      trustedDeviceStatus: 'verified',
      useOtpInstead: mockUseOtpInstead,
    };
    const view = render(<Index />);

    expect(screen.getByText('Trusted device verified')).toBeTruthy();
    expect(screen.getByText('Signing you in without another OTP.')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Trusted device verified')).toBeTruthy());
    view.unmount();
  });
});