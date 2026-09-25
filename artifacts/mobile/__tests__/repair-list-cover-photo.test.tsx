/**
 * Repairs list thumbnails.
 *
 *  - A row with a `coverPhoto` renders it as an image button that opens the
 *    fullscreen viewer (bearer-authenticated storage URL, kind as caption);
 *    closing the viewer returns to the list.
 *  - A row without photos keeps the device placeholder, and tapping the
 *    placeholder opens the repair like the rest of the card.
 *
 * Mock boundary is the API client plus storage/native modules; the real
 * RepairsScreen, RepairCard and PhotoViewerModal render.
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

let mockRepairs: any[] = [];
const mockPush = jest.fn();
const mockImageProps: any[] = [];

jest.mock('@workspace/api-client-react', () => {
  const { useQuery } = require('@tanstack/react-query');
  const controlled: Record<string, unknown> = {
    __esModule: true,
    authMe: jest.fn(async () => ({
      user: { id: 'user-1', name: 'Vikas', mobile: '9876543210', role: 'dealer', shopId: 'shop-a', isActive: true },
    })),
    authLogout: jest.fn(),
    setUnauthorizedHandler: jest.fn(),
    roleFeaturesGet: jest.fn(async () => ({ features: { repairs: true, repairs_update: true, repairs_create: true, payments: true, customers: true } })),
    getRepairsListQueryKey: (params: unknown) => ['repairs', params],
    useRepairsList: (params: unknown, options?: { query?: { enabled?: boolean } }) =>
      useQuery({
        queryKey: ['repairs', params],
        queryFn: async () => ({ repairs: mockRepairs, total: mockRepairs.length }),
        enabled: options?.query?.enabled !== false,
      }),
  };
  const idleQuery = Object.freeze({
    data: undefined, isLoading: false, isFetching: false, isPending: false,
    isError: false, error: null, refetch: jest.fn(async () => ({ data: undefined })),
  });
  return new Proxy(controlled, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      if (typeof prop !== 'string' || prop === 'default' || prop === 'then') return undefined;
      return prop.startsWith('use') ? () => idleQuery : jest.fn();
    },
  });
});

const mockMemoryStore = new Map<string, unknown>();
jest.mock('@/utils/storage', () => ({
  KEYS: { AUTH_TOKEN: 'vmc_auth_token', CURRENT_USER: 'vmc_current_user' },
  storage: {
    get: jest.fn(async (key: string) => (mockMemoryStore.has(key) ? mockMemoryStore.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown) => { mockMemoryStore.set(key, JSON.parse(JSON.stringify(value))); }),
    remove: jest.fn(async (key: string) => { mockMemoryStore.delete(key); }),
  },
}));
jest.mock('@/utils/seedData', () => ({ seedIfNeeded: jest.fn(async () => {}) }));
jest.mock('@/utils/pushNotifications', () => ({
  syncPushRegistration: jest.fn(async () => {}),
  forgetPushRegistration: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));
jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Image: (props: any) => {
      mockImageProps.push(props);
      return React.createElement(View, { testID: 'expo-image', accessibilityLabel: props.accessibilityLabel });
    },
  };
});

import { AuthProvider } from '@/context/AuthContext';
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog';
import RepairsScreen from '@/app/(tabs)/repairs/index';

async function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider queryClient={queryClient}>
        <ConfirmDialogProvider>
          <RepairsScreen />
        </ConfirmDialogProvider>
      </AuthProvider>
    </QueryClientProvider>,
  ) };
  await act(async () => {});
  await act(async () => {});
  await act(async () => {});
  return utils;
}

const baseRepair = {
  id: 'rep-1', repairId: 'VMC-004', shopId: 'shop-a', customerId: 'c-1', customerName: 'Anil', mobile: '9000000000',
  deviceType: 'Smartphone', brand: 'Samsung', model: 'A52', problem: 'Screen broken', status: 'received', priority: 'normal',
  repairCharge: 0, partsCharge: 0, advance: 0, receiveDate: '2026-09-18', expectedDate: '2026-09-25',
  createdAt: '2026-09-18T10:00:00.000Z', updatedAt: '2026-09-18T10:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMemoryStore.clear();
  mockMemoryStore.set('vmc_auth_token', 'tok');
  mockImageProps.length = 0;
  mockRepairs = [];
  process.env.EXPO_PUBLIC_DOMAIN = 'api.example.test';
});

test('a row with a cover photo shows it and opens the viewer on tap', async () => {
  mockRepairs = [{ ...baseRepair, coverPhoto: { objectPath: '/objects/uploads/shop-a/photo-1', kind: 'front' } }];
  await renderList();

  const thumb = screen.getByTestId('repair-cover-rep-1');
  expect(thumb.props.accessibilityLabel).toBe('View photo of VMC-004');
  const rendered = mockImageProps.find((p) => p.source?.uri === 'https://api.example.test/api/storage/objects/uploads/shop-a/photo-1');
  expect(rendered).toBeTruthy();
  expect(rendered.source.headers).toEqual({ Authorization: 'Bearer tok' });
  expect(screen.queryByLabelText('Close photo')).toBeNull();

  fireEvent.press(thumb);
  await act(async () => {});
  expect(mockPush).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Close photo')).toBeTruthy();
  expect(screen.getByText('front')).toBeTruthy();
  const viewerImage = mockImageProps.filter((p) => p.contentFit === 'contain').at(-1);
  expect(viewerImage.source).toEqual({
    uri: 'https://api.example.test/api/storage/objects/uploads/shop-a/photo-1',
    headers: { Authorization: 'Bearer tok' },
  });

  fireEvent.press(screen.getByLabelText('Close photo'));
  await act(async () => {});
  expect(screen.queryByLabelText('Close photo')).toBeNull();
});

test('a row without photos shows the stand-in device picture and opens the repair on tap', async () => {
  mockRepairs = [{ ...baseRepair, coverPhoto: null }];
  await renderList();

  expect(screen.queryByTestId('repair-cover-rep-1')).toBeNull();
  expect(screen.getByTestId('repair-cover-placeholder-rep-1')).toBeTruthy();
  expect(screen.getByLabelText('No photo yet')).toBeTruthy();
  expect(mockImageProps.some((p) => typeof p.source?.uri === 'string' && p.source.uri.includes('/api/storage/'))).toBe(false);

  fireEvent.press(screen.getByTestId('repair-card-rep-1'));
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/repairs/rep-1');
});

test('a row from an API without the cover field (older server) still shows the stand-in picture', async () => {
  const { coverPhoto: _omitted, ...legacyRow } = { ...baseRepair, coverPhoto: undefined } as any;
  mockRepairs = [legacyRow];
  await renderList();

  expect(screen.queryByTestId('repair-cover-rep-1')).toBeNull();
  expect(screen.getByTestId('repair-cover-placeholder-rep-1')).toBeTruthy();
});

test('a cover photo that fails to load falls back to the stand-in picture and is retried on the next refetch', async () => {
  mockRepairs = [{ ...baseRepair, coverPhoto: { objectPath: '/objects/uploads/shop-a/gone', kind: 'front' } }];
  const { queryClient } = await renderList();

  const uri = 'https://api.example.test/api/storage/objects/uploads/shop-a/gone';
  const rendered = mockImageProps.find((p) => p.source?.uri === uri);
  expect(rendered).toBeTruthy();
  await act(async () => { rendered.onError?.({ error: 'HTTP 404' }); });

  expect(screen.queryByTestId('repair-cover-rep-1')).toBeNull();
  expect(screen.getByTestId('repair-cover-placeholder-rep-1')).toBeTruthy();
  fireEvent.press(screen.getByTestId('repair-card-rep-1'));
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/repairs/rep-1');

  // The same path is tried again once the list refetches (pull-to-refresh,
  // invalidation after a mutation, reconnect) — a transient failure must not
  // pin the placeholder for the rest of the screen's life.
  mockImageProps.length = 0;
  // Jest runs with fake timers; a refetch a second later gets a new dataUpdatedAt like a real one would.
  await act(async () => { jest.advanceTimersByTime(1000); });
  await act(async () => { await queryClient.refetchQueries({ queryKey: ['repairs'] }); });
  // React Query batches observer notifications behind a zero timer, which fake timers hold.
  await act(async () => { jest.advanceTimersByTime(10); });
  expect(screen.getByTestId('repair-cover-rep-1')).toBeTruthy();
  expect(mockImageProps.some((p) => p.source?.uri === uri)).toBe(true);
  expect(screen.queryByTestId('repair-cover-placeholder-rep-1')).toBeNull();
});
