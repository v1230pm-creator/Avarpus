import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import ChatScreen from '../app/(tabs)/customers/chat/[id]';
import KhataLayout from '../app/(tabs)/khata/_layout';
import { FeatureRouteGuard } from '../components/navigation/FeatureRouteGuard';
import {
  activeKhataRepairs,
  getRepairKhataAmounts,
  groupKhataParties,
  summarizeKhataRepairs,
} from '../utils/khata';
import type { Repair } from '../types';

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  const Stack = ({ children }: { children: React.ReactNode }) =>
    React.createElement(View, null, children);
  Stack.Screen = ({ name }: { name: string }) =>
    React.createElement(Text, null, `Stack:${name}`);
  return {
    useRouter: () => ({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
    }),
    useLocalSearchParams: jest.fn(),
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, null, `Redirect:${href}`),
    Stack,
  };
});

jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({ background: '#F8FAFC' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Feather: ({ name }: { name: string }) => React.createElement(Text, null, name),
  };
});

const repair = (overrides: Partial<Repair>): Repair => ({
  id: 'repair-1',
  repairId: 'VMC-001',
  customerId: 'customer-1',
  customerName: 'Customer One',
  mobile: '0000000000',
  deviceType: 'Phone',
  brand: 'Brand',
  model: 'Model',
  problem: 'Issue',
  status: 'received',
  priority: 'normal',
  repairCharge: 1000,
  partsCharge: 0,
  advance: 0,
  receiveDate: '2026-08-22',
  expectedDate: '2026-08-23',
  createdAt: '2026-08-22T08:00:00.000Z',
  ...overrides,
});

describe('Khata display calculations', () => {
  it('uses canonical API totals and aggregates without mutating repairs', () => {
    const repairs = [
      repair({ id: 'r1', totalAmount: 1500, paidAmount: 1000, balance: 500 }),
      repair({ id: 'r2', totalAmount: 2200, paidAmount: 2200, balance: 0 }),
    ];
    const original = JSON.stringify(repairs);

    expect(summarizeKhataRepairs(repairs)).toEqual({
      billed: 3700,
      paid: 3200,
      due: 500,
    });
    expect(JSON.stringify(repairs)).toBe(original);
  });

  it('calculates fallback bill values with charges, discount and tax', () => {
    expect(
      getRepairKhataAmounts(
        repair({
          repairCharge: 1000,
          partsCharge: 200,
          serviceCharge: 100,
          otherCharge: 50,
          discount: 150,
          taxPercent: 10,
          advance: 500,
        }),
      ),
    ).toEqual({ billed: 1320, paid: 500, due: 820 });
  });

  it('groups real repairs by customer and dealer relationship', () => {
    const groups = groupKhataParties([
      repair({ totalAmount: 1000, paidAmount: 250, balance: 750 }),
      repair({
        id: 'r2',
        customerId: 'customer-2',
        customerName: 'Customer Two',
        dealerId: 'dealer-1',
        dealerName: 'Dealer One',
        totalAmount: 600,
        paidAmount: 600,
        balance: 0,
      }),
    ]);

    expect(groups.customers).toHaveLength(2);
    expect(groups.dealers).toEqual([
      expect.objectContaining({
        id: 'dealer-1',
        name: 'Dealer One',
        billed: 600,
        paid: 600,
        due: 0,
        repairCount: 1,
      }),
    ]);
  });

  it('excludes cancelled repairs from every Khata total and account group', () => {
    const activeRepair = repair({
      id: 'active-repair',
      totalAmount: 1200,
      paidAmount: 200,
      balance: 1000,
    });
    const cancelledRepair = repair({
      id: 'cancelled-repair',
      customerId: 'cancelled-customer',
      customerName: 'Cancelled Customer',
      dealerId: 'cancelled-dealer',
      dealerName: 'Cancelled Dealer',
      status: 'cancelled',
      totalAmount: 9000,
      paidAmount: 9000,
      balance: 0,
    });
    const repairs = [activeRepair, cancelledRepair];

    expect(activeKhataRepairs(repairs)).toEqual([activeRepair]);
    expect(summarizeKhataRepairs(repairs)).toEqual({
      billed: 1200,
      paid: 200,
      due: 1000,
    });
    const groups = groupKhataParties(repairs);
    expect(groups.customers).toEqual([
      expect.objectContaining({ id: 'customer-1', billed: 1200, paid: 200, due: 1000 }),
    ]);
    expect(groups.dealers).toEqual([]);
  });
});

describe('Chat provider-pending screen', () => {
  it('does not accept or send messages while communication services are unavailable', () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'customer-1',
      type: 'customer',
      name: 'Customer One',
    });

    render(<ChatScreen />);

    expect(screen.getByText('Customer One')).toBeTruthy();
    expect(screen.getByText('Chat setup pending')).toBeTruthy();
    expect(screen.getByText('Nothing is sent or stored from this screen.')).toBeTruthy();
    const input = screen.getByPlaceholderText('Messaging is not available yet');
    expect(input.props.editable).toBe(false);
    expect(input.props.pointerEvents).toBe('none');
  });
});

describe('Chat and Khata direct-route guards', () => {
  it('blocks dealer-portal accounts even if a feature is enabled', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'dealer_owner' },
      canAccess: () => true,
    });

    render(
      <FeatureRouteGuard feature="payments" excludeDealerPortal>
        <Text>Protected Khata</Text>
      </FeatureRouteGuard>,
    );

    expect(screen.getByText('Redirect:/(tabs)/more')).toBeTruthy();
    expect(screen.queryByText('Protected Khata')).toBeNull();
  });

  it('blocks staff when the required feature is disabled', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'reception' },
      canAccess: () => false,
    });

    render(
      <FeatureRouteGuard feature="payments" excludeDealerPortal>
        <Text>Protected Khata</Text>
      </FeatureRouteGuard>,
    );

    expect(screen.getByText('Redirect:/(tabs)/more')).toBeTruthy();
  });

  it('renders the route only for an allowed non-portal user', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'dealer' },
      canAccess: (feature: string) => feature === 'payments',
    });

    render(
      <FeatureRouteGuard feature="payments" excludeDealerPortal>
        <Text>Protected Khata</Text>
      </FeatureRouteGuard>,
    );

    expect(screen.getByText('Protected Khata')).toBeTruthy();
    expect(screen.queryByText('Redirect:/(tabs)/more')).toBeNull();
  });

  it('wires the payments and portal guard into the actual Khata layout', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'dealer_owner' },
      canAccess: () => true,
    });

    const blocked = render(<KhataLayout />);
    expect(screen.getByText('Redirect:/(tabs)/more')).toBeTruthy();
    expect(screen.queryByText('Stack:index')).toBeNull();
    blocked.unmount();

    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'dealer' },
      canAccess: (feature: string) => feature === 'payments',
    });

    render(<KhataLayout />);
    expect(screen.getByText('Stack:index')).toBeTruthy();
    expect(screen.getByText('Stack:party/[type]/[id]')).toBeTruthy();
  });
});