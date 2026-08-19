import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Switch, View } from 'react-native';

const mockGet = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@workspace/api-client-react', () => ({
  staffPermissionsGet: (...args: unknown[]) => mockGet(...args),
  staffPermissionsUpdate: (...args: unknown[]) => mockUpdate(...args),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'staff-1', name: 'Ravi' }),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Error: 'error' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'owner-1', role: 'dealer' },
  }),
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#000000',
    foreground: '#FFFFFF',
    mutedForeground: '#A0A0A0',
    primary: '#4488FF',
    card: '#111111',
    border: '#333333',
    muted: '#444444',
    destructive: '#FF4444',
  }),
}));

jest.mock('@/components/ui/Glass', () => ({
  GlassCard: ({ children, style }: { children: React.ReactNode; style?: object }) =>
    require('react').createElement(require('react-native').View, { style }, children),
  ScreenGlow: () => null,
}));

import StaffPermissionsScreen from '../app/(tabs)/more/staff-permissions';

const inheritedSettings = {
  user: {
    id: 'staff-1',
    name: 'Ravi',
    email: 'ravi@example.test',
    mobile: '9999999999',
    role: 'technician',
    isActive: true,
  },
  availableFeatures: ['dashboard'],
  roleFeatures: { dashboard: true },
  overrides: {},
  features: { dashboard: true },
};

describe('individual permission settings screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(inheritedSettings);
    mockUpdate.mockResolvedValue({
      ...inheritedSettings,
      overrides: { dashboard: false },
      features: { dashboard: false },
    });
  });

  it('shows inherited state and saves a person-specific override', async () => {
    render(<StaffPermissionsScreen />);
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeTruthy());
    expect(screen.getByText('Role default')).toBeTruthy();

    const toggle = screen.UNSAFE_getAllByType(Switch)[0];
    await act(async () => {
      fireEvent(toggle, 'valueChange', false);
    });

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('staff-1', {
        features: { dashboard: false },
      }),
    );
    expect(screen.getByText('Custom')).toBeTruthy();
  });

  it('clears the override when the switch returns to the role default', async () => {
    mockGet.mockResolvedValue({
      ...inheritedSettings,
      overrides: { dashboard: false },
      features: { dashboard: false },
    });
    mockUpdate.mockResolvedValue(inheritedSettings);

    render(<StaffPermissionsScreen />);
    await waitFor(() => expect(screen.getByText('Custom')).toBeTruthy());
    const toggle = screen.UNSAFE_getAllByType(Switch)[0];
    await act(async () => {
      fireEvent(toggle, 'valueChange', true);
    });

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('staff-1', {
        features: { dashboard: null },
      }),
    );
    expect(screen.getByText('Role default')).toBeTruthy();
  });
});