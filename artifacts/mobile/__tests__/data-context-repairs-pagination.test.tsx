/**
 * The repairs endpoint is paginated (server default 50 rows, max 200). The
 * shared shop list feeds the repair detail screen, intake and reports, so the
 * provider must walk every page — a shop with more than one page of repairs
 * used to see "Repair not found" for every newer ticket.
 *
 * Real AuthProvider and DataProvider; only the API client and device
 * boundaries are mocked.
 */
import React from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';

const mockAuthMe = jest.fn();
const mockCustomersList = jest.fn();
const mockRepairsCreate = jest.fn();
const mockRepairsList = jest.fn();
const mockShopSwitch = jest.fn();
const mockRoleFeaturesGet = jest.fn();

jest.mock('@workspace/api-client-react', () => ({
  authMe: (...args: unknown[]) => mockAuthMe(...args),
  authLogout: jest.fn(async () => {}),
  authOtpVerify: jest.fn(),
  authTrustedDeviceRecover: jest.fn(),
  roleFeaturesGet: (...args: unknown[]) => mockRoleFeaturesGet(...args),
  setUnauthorizedHandler: jest.fn(),
  shopSwitch: (...args: unknown[]) => mockShopSwitch(...args),
  customersList: (...args: unknown[]) => mockCustomersList(...args),
  customersCreate: jest.fn(),
  customersUpdate: jest.fn(),
  repairsList: (...args: unknown[]) => mockRepairsList(...args),
  repairsCreate: (...args: unknown[]) => mockRepairsCreate(...args),
  repairsUpdate: jest.fn(),
  repairsDelete: jest.fn(),
  inventoryList: jest.fn(async () => ({ items: [] })),
  inventoryCreate: jest.fn(),
  inventoryUpdate: jest.fn(),
  purchasesList: jest.fn(async () => ({ purchases: [] })),
  purchasesCreate: jest.fn(),
  purchasesUpdate: jest.fn(),
  financeList: jest.fn(async () => ({ entries: [] })),
  financeCreate: jest.fn(),
  financeUpdate: jest.fn(),
  sampleDataLoad: jest.fn(),
  sampleDataClear: jest.fn(),
}));

jest.mock('@/utils/storage', () => ({
  KEYS: {
    AUTH_TOKEN: 'vmc_auth_token',
    CURRENT_USER: 'vmc_current_user',
  },
  storage: {
    get: jest.fn(async (key: string) => (key === 'vmc_auth_token' ? 'shop-session' : null)),
    set: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
  },
}));

jest.mock('@/utils/seedData', () => ({
  seedIfNeeded: jest.fn(async () => {}),
}));

jest.mock('@/utils/trustedDevice', () => ({
  canAttemptTrustedDeviceRecovery: jest.fn(() => false),
  getTrustedAndroidDeviceId: jest.fn(async () => null),
}));

jest.mock('@/utils/offlineQueue', () => ({
  offlineQueue: {
    getQueue: jest.fn(async () => []),
    flush: jest.fn(async () => ({ success: 0 })),
  },
}));

jest.mock('@/utils/legacyMigration', () => ({
  hasLegacyLocalData: jest.fn(async () => false),
  migrateLegacyLocalData: jest.fn(async () => ({ migrated: 0 })),
}));

import { AuthProvider } from '@/context/AuthContext';
import { DataProvider, useData } from '@/context/DataContext';

const owner = {
  id: 'owner-1',
  name: 'Owner',
  email: 'owner@example.test',
  mobile: '9876543210',
  role: 'dealer',
  shopId: 'shop-a',
  isActive: true,
};

const makeRepair = (n: number) => ({
  id: `repair-${n}`,
  repairId: `VMC-${1000 + n}`,
  customerId: 'customer-a',
  customerName: 'Customer',
  mobile: '9000000001',
  deviceType: 'Smartphone',
  brand: 'Samsung',
  model: 'Galaxy S23',
  problem: 'Screen cracked',
  status: 'received',
  priority: 'normal',
  repairCharge: 1000,
  partsCharge: 0,
  advance: 0,
  receiveDate: '2026-08-31',
  expectedDate: '2026-09-01',
  warrantyDays: 0,
  checklist: {},
  createdAt: `2026-08-31T10:${String(n % 60).padStart(2, '0')}:00.000Z`,
});

function ContextProbe() {
  const { repairs } = useData();
  return (
    <>
      <Text testID="count">{String(repairs.length)}</Text>
      <Text testID="has-newest">{repairs.some((r) => r.id === 'repair-250') ? 'yes' : 'no'}</Text>
    </>
  );
}

function renderContext() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DataProvider>
          <ContextProbe />
        </DataProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('DataContext repairs pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthMe.mockResolvedValue({ user: owner });
    mockCustomersList.mockResolvedValue({ customers: [] });
    mockRoleFeaturesGet.mockResolvedValue({ features: {} });
  });

  it('walks every page so repairs beyond the first page are present', async () => {
    const all = Array.from({ length: 250 }, (_, i) => makeRepair(i + 1));
    mockRepairsList.mockImplementation(async (params?: { page?: number; limit?: number }) => {
      const page = params?.page ?? 1;
      const limit = params?.limit ?? 50;
      const start = (page - 1) * limit;
      return { repairs: all.slice(start, start + limit), total: all.length, page, limit };
    });

    renderContext();
    // Let auth restore (storage + authMe) and the initial load settle.
    await act(async () => {});
    await act(async () => {});
    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('250'));
    expect(screen.getByTestId('has-newest').props.children).toBe('yes');

    const calls = mockRepairsList.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: 1, limit: 200 }),
      expect.objectContaining({ page: 2, limit: 200 }),
    ]));
    expect(calls.some((c) => c?.page === 3)).toBe(false);
  });

  it('stops after a short page even when the server omits total', async () => {
    const all = Array.from({ length: 77 }, (_, i) => makeRepair(i + 1));
    mockRepairsList.mockImplementation(async (params?: { page?: number; limit?: number }) => {
      const page = params?.page ?? 1;
      const limit = params?.limit ?? 50;
      const start = (page - 1) * limit;
      return { repairs: all.slice(start, start + limit) };
    });

    renderContext();
    // Let auth restore (storage + authMe) and the initial load settle.
    await act(async () => {});
    await act(async () => {});
    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('77'));
    expect(mockRepairsList.mock.calls.filter((c) => c[0]?.page === 1).length).toBeGreaterThan(0);
    expect(mockRepairsList.mock.calls.some((c) => c[0]?.page === 2)).toBe(false);
  });
});
