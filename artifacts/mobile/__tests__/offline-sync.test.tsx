/**
 * Guards the flush trigger in the app: the repairs list screen shows a
 * "saved offline" banner and its Sync Now button runs offlineQueue.flush().
 * After a successful sync the queued repair must actually appear in the
 * repairs list (the query cache is invalidated and refetched), the banner
 * must disappear, and a failed sync must keep the item queued for retry
 * with the SAME clientRequestId.
 *
 * Mock boundary is the API client (network) plus storage and native-only
 * modules — the REAL offlineQueue module, real AuthContext, and the real
 * repairs list screen render. Pattern follows __tests__/repair-intake.test.tsx.
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// ── Mocks (network + native boundaries only) ─────────────────────────────
const mockRepairsCreate = jest.fn();

// Simulated server-side repairs table. repairsCreate appends here; the
// mocked useRepairsList hook reads from it via a real react-query useQuery,
// so invalidateQueries() after a sync genuinely refetches the new record.
const mockServerRepairs: Record<string, unknown>[] = [];

jest.mock('@workspace/api-client-react', () => {
  const { useQuery } = require('@tanstack/react-query');
  return {
    authMe: jest.fn(async () => ({
      user: { id: 'u1', name: 'Owner', email: 'o@x.y', mobile: '9876543210', role: 'dealer', isActive: true },
    })),
    authLogin: jest.fn(),
    authLogout: jest.fn(),
    authOtpRequest: jest.fn(),
    authOtpVerify: jest.fn(),
    setUnauthorizedHandler: jest.fn(),
    repairsCreate: (...a: unknown[]) => mockRepairsCreate(...a),
    getRepairsListQueryKey: (params: unknown) => ['repairs', params],
    useRepairsList: (params: unknown, options?: { query?: { enabled?: boolean; queryKey?: unknown[] } }) =>
      useQuery({
        queryKey: options?.query?.queryKey ?? ['repairs', params],
        queryFn: async () => ({ repairs: [...mockServerRepairs], total: mockServerRepairs.length }),
        enabled: options?.query?.enabled !== false,
      }),
    useReturnsList: () =>
      useQuery({ queryKey: ['returns'], queryFn: async () => ({ returns: [] }) }),
    useDealersList: jest.fn(() => ({ data: { dealers: [] }, isLoading: false, refetch: jest.fn() })),
    useDealersMe: jest.fn(() => ({ data: undefined })),
    useDealersOverview: jest.fn(() => ({ data: undefined })),
  };
});

// In-memory storage backing BOTH the real offlineQueue and the auth token.
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
// Connectivity is restored in these tests — Sync Now is enabled.
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));

// The real offlineQueue module runs against the mocked storage.
import { offlineQueue } from '@/utils/offlineQueue';
import { AuthProvider } from '@/context/AuthContext';
import RepairsScreen from '@/app/(tabs)/repairs/index';

const QUEUE_KEY = 'vmc_offline_repairs_queue';

const queuedItem = (clientRequestId: string) => ({
  clientRequestId,
  payload: {
    customerName: 'Asha Kumar',
    mobile: '9876543210',
    deviceType: 'Smartphone',
    brand: 'Samsung',
    model: 'Galaxy S23',
    problem: 'Screen cracked, no display',
    priority: 'normal',
    repairCharge: 2500,
    expectedDate: '2026-08-15',
  },
  createdAt: '2026-08-08T09:00:00.000Z',
  status: 'pending' as const,
});

const serverRepair = (id: string) => ({
  id,
  repairId: 'VMC-1001',
  customerId: 'c1',
  customerName: 'Asha Kumar',
  mobile: '9876543210',
  deviceType: 'Smartphone',
  brand: 'Samsung',
  model: 'Galaxy S23',
  problem: 'Screen cracked, no display',
  status: 'received',
  priority: 'normal',
  repairCharge: 2500,
  partsCharge: 0,
  advance: 0,
  receiveDate: '2026-08-08',
  expectedDate: '2026-08-15',
  warrantyDays: 0,
  checklist: {},
  createdAt: '2026-08-08T09:00:00.000Z',
});

async function renderRepairs() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RepairsScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
  // Let auth restore (storage + authMe) and the initial queries settle.
  await act(async () => {});
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMemoryStore.clear();
  mockMemoryStore.set('vmc_auth_token', 'tok');
  mockServerRepairs.length = 0;
});

describe('Sync Now delivers offline repairs to the list', () => {
  it('queued repair is sent on sync, banner clears, and the repair appears in the list', async () => {
    mockMemoryStore.set(QUEUE_KEY, [queuedItem('cr-1')]);
    mockRepairsCreate.mockImplementation(async (payload: { clientRequestId: string }) => {
      const repair = serverRepair('r1');
      mockServerRepairs.push(repair);
      return { repair };
    });

    const { unmount } = await renderRepairs();

    // Banner shows the pending offline repair; list doesn't have it yet.
    expect(screen.getByText('1 repair saved offline')).toBeTruthy();
    expect(screen.queryByText('Asha Kumar')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('Sync Now'));
    });

    // Delivered exactly once, with the queued idempotency key intact.
    await waitFor(() => expect(mockRepairsCreate).toHaveBeenCalledTimes(1));
    expect(mockRepairsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId: 'cr-1',
        customerName: 'Asha Kumar',
        mobile: '9876543210',
        brand: 'Samsung',
        model: 'Galaxy S23',
        problem: 'Screen cracked, no display',
      }),
    );

    // Queue emptied, banner gone, repair now in the shop's list.
    await waitFor(() => expect(screen.queryByText('1 repair saved offline')).toBeNull());
    await waitFor(() => expect(screen.getByText('Asha Kumar')).toBeTruthy());
    expect(screen.getByText(/VMC-1001/)).toBeTruthy();
    expect(await offlineQueue.getQueue()).toEqual([]);
    unmount();
  });

  it('failed sync keeps the repair queued and a retry reuses the same clientRequestId', async () => {
    mockMemoryStore.set(QUEUE_KEY, [queuedItem('cr-1')]);
    mockRepairsCreate.mockRejectedValueOnce(new TypeError('Network request failed'));

    const { unmount } = await renderRepairs();
    expect(screen.getByText('1 repair saved offline')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('Sync Now'));
    });
    await waitFor(() => expect(mockRepairsCreate).toHaveBeenCalledTimes(1));

    // Still queued for retry — the banner stays and the item survives.
    expect(screen.getByText('1 repair saved offline')).toBeTruthy();
    const queued = await offlineQueue.getQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0].clientRequestId).toBe('cr-1');
    expect(screen.queryByText('Asha Kumar')).toBeNull();

    // Network back for real — retry sends the SAME clientRequestId.
    mockRepairsCreate.mockImplementationOnce(async () => {
      const repair = serverRepair('r1');
      mockServerRepairs.push(repair);
      return { repair };
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Sync Now'));
    });
    await waitFor(() => expect(mockRepairsCreate).toHaveBeenCalledTimes(2));
    expect(mockRepairsCreate.mock.calls[1][0].clientRequestId).toBe('cr-1');

    await waitFor(() => expect(screen.queryByText('1 repair saved offline')).toBeNull());
    await waitFor(() => expect(screen.getByText('Asha Kumar')).toBeTruthy());
    expect(await offlineQueue.getQueue()).toEqual([]);
    unmount();
  });
});
