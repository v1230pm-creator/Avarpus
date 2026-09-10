import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockPush = jest.fn();
const mockLogout = jest.fn();
const mockRefreshFeatures = jest.fn();
const mockCanAccess = jest.fn((feature: string) => feature === 'repairs_portal');

let mockSegments: string[] = ['(tabs)', 'repairs'];
let mockAuthState: {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { id: string; role: string } | null;
  dealerPortalInactive: boolean;
} = {
  isAuthenticated: true,
  isLoading: false,
  user: { id: 'dealer-user', role: 'dealer_owner' },
  dealerPortalInactive: true,
};

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    ...mockAuthState,
    canAccess: mockCanAccess,
    logout: mockLogout,
    refreshFeatures: mockRefreshFeatures,
  }),
}));

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Tabs = ({ children }: { children: React.ReactNode }) => (
    <>
      <Text>Portal repair data</Text>
      {children}
    </>
  );
  Tabs.Screen = () => null;
  return {
    Tabs,
    Redirect: ({ href }: { href: string }) => <Text>{`Redirect:${href}`}</Text>,
    useRouter: () => ({ push: mockPush }),
    useSegments: () => mockSegments,
  };
});

jest.mock('@/utils/appLock', () => ({
  isLockEnabled: jest.fn(async () => false),
  isUnlocked: jest.fn(() => true),
  subscribeLockState: jest.fn(() => () => {}),
}));

jest.mock('@/components/InactivityGuard', () => ({
  InactivityGuard: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    accent: '#eee',
    background: '#fff',
    border: '#ccc',
    card: '#fff',
    foreground: '#111',
    gold: '#aa0',
    goldActive: '#880',
    mutedForeground: '#666',
    primary: '#00f',
    primaryForeground: '#fff',
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import TabLayout from '../app/(tabs)/_layout';

describe.each(['dealer_owner', 'dealer_staff'])('%s portal recovery', (role) => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSegments = ['(tabs)', 'repairs'];
    mockAuthState = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: `${role}-user`, role },
      dealerPortalInactive: true,
    };
    mockRefreshFeatures.mockImplementation(async () => {
      mockAuthState = { ...mockAuthState, dealerPortalInactive: false };
    });
  });

  it('hides portal data while inactive and resumes the same session after Retry', async () => {
    const view = render(<TabLayout />);

    expect(screen.getByText('Dealer portal is inactive')).toBeTruthy();
    expect(screen.queryByText('Portal repair data')).toBeNull();
    expect(screen.getByText('Manage account')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();

    fireEvent.press(screen.getByText('Manage account'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/more/profile');

    await act(async () => {
      fireEvent.press(screen.getByText('Retry access'));
    });
    view.rerender(<TabLayout />);

    expect(mockRefreshFeatures).toHaveBeenCalledTimes(1);
    expect(mockLogout).not.toHaveBeenCalled();
    expect(screen.queryByText('Dealer portal is inactive')).toBeNull();
    expect(screen.getByText('Portal repair data')).toBeTruthy();
  });
});

it('does not apply the dealer inactive gate to customer portal sessions', () => {
  mockAuthState = {
    isAuthenticated: true,
    isLoading: false,
    user: { id: 'customer-user', role: 'customer' },
    dealerPortalInactive: false,
  };
  mockSegments = ['(tabs)', 'index'];

  render(<TabLayout />);

  expect(screen.queryByText('Dealer portal is inactive')).toBeNull();
  expect(screen.getByText('Portal repair data')).toBeTruthy();
});