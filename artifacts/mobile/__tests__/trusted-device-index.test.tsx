import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockUseOtpInstead = jest.fn();
let mockSplashAutoFinish = true;
let mockAuth = {
  isAuthenticated: false,
  isLoading: true,
  trustedDeviceStatus: 'checking',
  useOtpInstead: mockUseOtpInstead,
};

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('@/components/ui/SplashIntro', () => {
  const React = require('react');
  const { Text } = require('react-native');

  return {
    SplashIntro: ({
      onFinish,
      loadingReady,
    }: {
      onFinish: () => void;
      loadingReady: boolean;
    }) => {
      React.useEffect(() => {
        if (mockSplashAutoFinish || loadingReady) onFinish();
      }, [loadingReady, onFinish]);
      return <Text>{loadingReady ? 'Splash ready' : 'Splash loading'}</Text>;
    },
  };
});

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
    mockSplashAutoFinish = true;
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

  it('hands off to the OTP recovery escape route when trusted-device checking stalls', async () => {
    mockSplashAutoFinish = false;
    mockAuth = {
      isAuthenticated: false,
      isLoading: true,
      trustedDeviceStatus: 'checking',
      useOtpInstead: mockUseOtpInstead,
    };
    const view = render(<Index />);

    expect(screen.getByText('Splash loading')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(3599);
    });
    expect(screen.queryByText('Checking trusted device')).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByText('Checking trusted device')).toBeTruthy();
    expect(screen.getByText('Use OTP instead')).toBeTruthy();
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

    await waitFor(() => expect(screen.getByText('Trusted device verified')).toBeTruthy());
    expect(screen.getByText('Signing you in without another OTP.')).toBeTruthy();
    view.unmount();
  });
});