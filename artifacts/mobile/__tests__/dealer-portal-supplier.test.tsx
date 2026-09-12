/**
 * A dealer-portal login sees the repair shop as its supplier at the top of
 * My Repairs: business name, the shop owner's name and mobile, and a call
 * action that dials that number. Mock boundary is the API client plus
 * storage/native modules; the real AuthContext and repairs screen render.
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

let mockDealerMe: Record<string, unknown> | undefined;

jest.mock('@workspace/api-client-react', () => {
  const { useQuery } = require('@tanstack/react-query');
  const controlled: Record<string, unknown> = {
    __esModule: true,
    authMe: jest.fn(async () => ({
      user: {
        id: 'portal-1', name: 'Ravi Traders', email: 'ravi@example.test', mobile: '9811111111',
        role: 'dealer_owner', shopId: 'shop-1', dealerId: 'dealer-1', isActive: true,
      },
    })),
    authLogout: jest.fn(),
    setUnauthorizedHandler: jest.fn(),
    getRepairsListQueryKey: (params: unknown) => ['repairs', params],
    useRepairsList: (params: unknown, options?: { query?: { enabled?: boolean } }) =>
      useQuery({
        queryKey: ['repairs', params],
        queryFn: async () => ({ repairs: [], total: 0 }),
        enabled: options?.query?.enabled !== false,
      }),
    useDealersMe: jest.fn(() => ({ data: mockDealerMe })),
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
    set: jest.fn(async (key: string, value: unknown) => {
      mockMemoryStore.set(key, JSON.parse(JSON.stringify(value)));
    }),
    remove: jest.fn(async (key: string) => {
      mockMemoryStore.delete(key);
    }),
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));

import { AuthProvider } from '@/context/AuthContext';
import RepairsScreen from '@/app/(tabs)/repairs/index';

async function renderRepairs() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RepairsScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await act(async () => {});
  await act(async () => {});
  return utils;
}

const stats = {
  totalRepairs: 3, received: 1, repairing: 1, ready: 0, delivered: 1, cancelled: 0,
  afterSaleReturns: 0, refunded: 0, refundedAmount: 0, totalRepairValue: 4500, pendingAmount: 1200,
};
const dealer = { id: 'dealer-1', dealerCode: 'DLR-007', name: 'Ravi Traders', mobile: '9811111111', isActive: true, createdAt: '2026-09-01T00:00:00.000Z' };

beforeEach(() => {
  jest.clearAllMocks();
  mockMemoryStore.clear();
  mockMemoryStore.set('vmc_auth_token', 'tok');
  mockDealerMe = undefined;
});

describe('dealer portal supplier card', () => {
  it('names the repair shop as the supplier with the owner contact and dials it', async () => {
    mockDealerMe = {
      dealer,
      stats,
      supplier: { businessName: 'Avarpus Mobile Care', ownerName: 'Vikas', ownerMobile: '9876543210' },
    };
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderRepairs();

    expect(screen.getByText('SUPPLIER')).toBeTruthy();
    expect(screen.getByText('Avarpus Mobile Care')).toBeTruthy();
    expect(screen.getByText('Vikas · 9876543210')).toBeTruthy();
    // The header still identifies the dealer's own party.
    expect(screen.getByText('DLR-007 · Ravi Traders')).toBeTruthy();

    fireEvent.press(screen.getByTestId('portal-supplier-call'));
    expect(openURL).toHaveBeenCalledWith('tel:9876543210');
  });

  it('renders no supplier card when the server has none', async () => {
    mockDealerMe = { dealer, stats, supplier: null };
    await renderRepairs();
    expect(screen.queryByTestId('portal-supplier-card')).toBeNull();
    expect(screen.getByText('DLR-007 · Ravi Traders')).toBeTruthy();
  });
});
