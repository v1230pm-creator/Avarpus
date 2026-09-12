/**
 * A customer refresh started before a workspace switch must not repopulate
 * the newly selected workspace with the previous shop's data.
 *
 * The real AuthProvider and DataProvider are used. Only the API client and
 * device/storage boundaries are mocked.
 */
import React from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';

const mockAuthMe = jest.fn();
const mockCustomersList = jest.fn();
const mockRepairsCreate = jest.fn();
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
  repairsList: jest.fn(async () => ({ repairs: [] })),
  repairsCreate: (...args: unknown[]) => mockRepairsCreate(...args),
  repairsUpdate: jest.fn(),
  getRepairsGetQueryKey: jest.fn((id: string) => ['/repairs/' + id]),
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

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { DataProvider, useData } from '@/context/DataContext';

const shopAUser = {
  id: 'owner-1',
  name: 'Owner',
  email: 'owner@example.test',
  mobile: '9876543210',
  role: 'dealer',
  shopId: 'shop-a',
  isActive: true,
};

const shopBUser = {
  ...shopAUser,
  shopId: 'shop-b',
};

const shopACustomer = {
  id: 'customer-a',
  name: 'Shop A customer',
  mobile: '9000000001',
  dueAmount: 0,
  totalRepairs: 1,
};

const shopARepair = {
  id: 'repair-a',
  repairId: 'VMC-1001',
  customerId: 'customer-a',
  customerName: 'Shop A customer',
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
  createdAt: '2026-08-31T10:00:00.000Z',
};

function ContextProbe() {
  const { refreshUser } = useAuth();
  const { customers, addRepair } = useData();

  return (
    <>
      <Text testID="customers">{customers.map((customer) => customer.name).join(',')}</Text>
      <Text
        testID="switch-shop"
        onPress={() => {
          void (async () => {
            await mockShopSwitch('shop-b');
            await refreshUser();
          })();
        }}
      >
        Switch shop
      </Text>
      <Text
        testID="save-repair"
        onPress={() => {
          void addRepair(shopARepair as never);
        }}
      >
        Save repair
      </Text>
    </>
  );
}

function renderContext() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

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

describe('DataContext workspace switching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthMe
      .mockResolvedValueOnce({ user: shopAUser })
      .mockResolvedValueOnce({ user: shopBUser });
    mockCustomersList.mockResolvedValue({ customers: [shopACustomer] });
    mockRepairsCreate.mockResolvedValue({ repair: shopARepair });
    mockShopSwitch.mockResolvedValue({});
    mockRoleFeaturesGet.mockResolvedValue({ features: {} });
  });

  it('discards an in-flight Shop A customer refresh after switching to Shop B', async () => {
    renderContext();

    await waitFor(() => {
      expect(screen.getByTestId('customers').props.children).toBe('Shop A customer');
    });

    let resolveOldRefresh!: (value: { customers: typeof shopACustomer[] }) => void;
    const oldRefresh = new Promise<{ customers: typeof shopACustomer[] }>((resolve) => {
      resolveOldRefresh = resolve;
    });
    mockCustomersList.mockImplementationOnce(() => oldRefresh);
    mockCustomersList.mockResolvedValue({ customers: [] });

    await act(async () => {
      screen.getByTestId('save-repair').props.onPress();
    });
    await waitFor(() => expect(mockCustomersList).toHaveBeenCalledTimes(2));

    await act(async () => {
      screen.getByTestId('switch-shop').props.onPress();
    });
    await waitFor(() => {
      expect(mockShopSwitch).toHaveBeenCalledWith('shop-b');
      expect(screen.getByTestId('customers').props.children).toBe('');
    });

    await act(async () => {
      resolveOldRefresh({ customers: [shopACustomer] });
    });

    await waitFor(() => {
      expect(screen.getByTestId('customers').props.children).toBe('');
    });
    expect(screen.queryByText('Shop A customer')).toBeNull();
  });
});