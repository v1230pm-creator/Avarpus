/**
 * Dealer-to-dealer RECEIVE TRANSFER, mobile side.
 *
 *  - Sender: the card's ⋮ button → "Send to Dealer" dialog → picker route with
 *    the repair id; rows already waiting on a dealer show "Waiting for … to
 *    accept" and offer no button for a second request; portal users and staff
 *    without repairs_update get no button at all. (The card has no long press
 *    of its own: a held finger anywhere on a list takes the page for one-hand
 *    reach.)
 *  - Receiver: an incoming request shows the sender's saved device facts and
 *    ACCEPT / DECLINE; accept calls the API once and opens the new repair.
 *  - Sender: a pending request offers CANCEL through the shared dialog.
 *
 * Mock boundary is the API client plus storage/native modules; the real
 * AuthContext and screens render.
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

type Role = 'dealer' | 'technician' | 'dealer_owner';
let mockRole: Role = 'dealer';
let mockFeatures: Record<string, boolean> = { repairs: true, repairs_update: true, repairs_create: true, payments: true, customers: true };
let mockRepairs: any[] = [];
let mockRequest: any = null;
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockAccept = jest.fn(async (_id: string) => ({ request: { ...mockRequest, status: 'accepted' }, repair: { id: 'new-repair-1' } }));
const mockDecline = jest.fn(async (_id: string, _data: unknown) => ({ request: { ...mockRequest, status: 'declined' } }));
const mockCancel = jest.fn(async (_id: string) => ({ request: { ...mockRequest, status: 'cancelled' } }));
const mockConfirm = jest.fn();

jest.mock('@workspace/api-client-react', () => {
  const { useQuery, useMutation } = require('@tanstack/react-query');
  const controlled: Record<string, unknown> = {
    __esModule: true,
    authMe: jest.fn(async () => ({
      user: {
        id: 'user-1', name: 'Vikas', mobile: '9876543210', role: mockRole, shopId: 'shop-a', isActive: true,
      },
    })),
    authLogout: jest.fn(),
    setUnauthorizedHandler: jest.fn(),
    roleFeaturesGet: jest.fn(async () => ({ features: mockFeatures })),
    getRepairsListQueryKey: (params: unknown) => ['repairs', params],
    getRepairsGetQueryKey: (id: string) => ['repair', id],
    getDealerTransfersListQueryKey: () => ['transfers'],
    getDealerTransfersGetQueryKey: (id: string) => ['transfer', id],
    getDealerTransactionsListQueryKey: () => ['dealer-transactions'],
    getDealerTransactionsLedgerQueryKey: () => ['dealer-ledger'],
    useRepairsList: (params: unknown, options?: { query?: { enabled?: boolean } }) =>
      useQuery({
        queryKey: ['repairs', params],
        queryFn: async () => ({ repairs: mockRepairs, total: mockRepairs.length }),
        enabled: options?.query?.enabled !== false,
      }),
    useDealerTransfersGet: (id: string) =>
      useQuery({ queryKey: ['transfer', id], queryFn: async () => ({ request: mockRequest }) }),
    useDealerTransfersAccept: () => useMutation({ mutationFn: ({ id }: { id: string }) => mockAccept(id) }),
    useDealerTransfersDecline: () => useMutation({ mutationFn: ({ id, data }: { id: string; data: unknown }) => mockDecline(id, data) }),
    useDealerTransfersCancel: () => useMutation({ mutationFn: ({ id }: { id: string }) => mockCancel(id) }),
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
  useRouter: () => ({ back: jest.fn(), replace: mockReplace, push: mockPush }),
  useLocalSearchParams: () => ({ id: 'req-1' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
jest.mock('@/components/ui/ConfirmDialog', () => ({
  ...jest.requireActual('@/components/ui/ConfirmDialog'),
  useConfirmDialog: () => ({ confirm: mockConfirm }),
}));

import { AuthProvider } from '@/context/AuthContext';
import RepairsScreen from '@/app/(tabs)/repairs/index';
import TransferRequestScreen from '@/app/(tabs)/repairs/dealer-transactions/request/[id]';

type ConfirmCall = { title: string; caption?: string | null; actions: Array<{ label: string; onPress: () => unknown }> };

async function renderWithAuth(node: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider queryClient={queryClient}>{node}</AuthProvider>
    </QueryClientProvider>,
  );
  await act(async () => {});
  await act(async () => {});
  await act(async () => {});
  return utils;
}

const baseRepair = {
  id: 'rep-1', repairId: 'RPR-001', shopId: 'shop-a', customerId: 'c-1', customerName: 'Anil', customerMobile: '9000000000',
  deviceType: 'Smartphone', brand: 'Samsung', model: 'A52', problem: 'Screen broken', status: 'received', priority: 'normal',
  repairCharge: 0, partsCharge: 0, advance: 0, receiveDate: '2026-09-18', expectedDate: '2026-09-25',
  createdAt: '2026-09-18T10:00:00.000Z', updatedAt: '2026-09-18T10:00:00.000Z',
};

const incomingRequest = {
  id: 'req-1', status: 'pending', side: 'receiver',
  sender: { shopId: 'shop-a', businessName: 'Vikas Mobiles', ownerName: 'Vikas' },
  receiver: { shopId: 'shop-b', businessName: 'Ravi Repairs', ownerName: 'Ravi' },
  sentByName: 'Vikas', message: 'Please check the display',
  device: { sourceTicket: 'RPR-001', deviceType: 'Smartphone', brand: 'Samsung', model: 'A52', imei: '123456789012345', problem: 'Screen broken', priority: 'normal', receiveDate: '2026-09-18', photoCount: 2 },
  createdAt: '2026-09-19T08:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMemoryStore.clear();
  mockMemoryStore.set('vmc_auth_token', 'tok');
  mockRole = 'dealer';
  mockFeatures = { repairs: true, repairs_update: true, repairs_create: true, payments: true, customers: true };
  mockRepairs = [];
  mockRequest = null;
});

describe('sender: ⋮ → Send to Dealer', () => {
  it('opens the shared dialog and routes to the dealer picker with the repair id', async () => {
    mockRepairs = [baseRepair];
    await renderWithAuth(<RepairsScreen />);
    await waitFor(() => expect(screen.getByTestId('repair-card-rep-1')).toBeTruthy());

    fireEvent.press(screen.getByTestId('repair-menu-rep-1'));
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const call = mockConfirm.mock.calls[0][0] as ConfirmCall;
    expect(call.title).toBe('Send to Dealer');
    expect(call.caption).toMatch(/must accept/i);
    expect(call.actions.map((a) => a.label)).toEqual(['Choose dealer']);

    call.actions[0].onPress();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(tabs)/repairs/dealer-transactions/send',
      params: { repairId: 'rep-1' },
    });
  });

  it('shows the waiting badge and blocks a second request while one is pending', async () => {
    mockRepairs = [{
      ...baseRepair,
      transfer: { requestId: 'req-1', status: 'pending', receiverShopId: 'shop-b', receiverBusinessName: 'Ravi Repairs', createdAt: '2026-09-19T08:00:00.000Z' },
    }];
    await renderWithAuth(<RepairsScreen />);
    await waitFor(() => expect(screen.getByTestId('repair-transfer-badge-rep-1')).toBeTruthy());
    expect(screen.getByText('Waiting for Ravi Repairs to accept')).toBeTruthy();
    // Never the word "Received" for the sender while the other side has not accepted.
    expect(screen.queryByText(/Received from/)).toBeNull();

    expect(screen.queryByTestId('repair-menu-rep-1')).toBeNull();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('lets the sender resend after a decline and tells them so', async () => {
    mockRepairs = [{
      ...baseRepair,
      transfer: { requestId: 'req-1', status: 'declined', receiverShopId: 'shop-b', receiverBusinessName: 'Ravi Repairs', createdAt: '2026-09-19T08:00:00.000Z' },
    }];
    await renderWithAuth(<RepairsScreen />);
    await waitFor(() => expect(screen.getByText('Declined by Ravi Repairs · you can send again')).toBeTruthy());
    fireEvent.press(screen.getByTestId('repair-menu-rep-1'));
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  it('offers no send button to staff without the update-repairs toggle', async () => {
    mockRole = 'technician';
    mockFeatures = { repairs: true, repairs_update: false, customers: true };
    mockRepairs = [baseRepair];
    await renderWithAuth(<RepairsScreen />);
    await waitFor(() => expect(screen.getByTestId('repair-card-rep-1')).toBeTruthy());
    expect(screen.queryByTestId('repair-menu-rep-1')).toBeNull();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('labels the receiving shop\'s row with where it came from', async () => {
    mockRepairs = [{
      ...baseRepair, id: 'rep-2', repairId: 'RPR-B-001', customerName: 'Vikas Mobiles (Dealer)',
      sourceDealerShopId: 'shop-a', sourceDealerBusinessName: 'Vikas Mobiles', sourceRepairId: 'rep-1', sourceRepairTicket: 'RPR-001',
      sourceDealerReceivedAt: '2026-09-19T09:00:00.000Z',
    }];
    await renderWithAuth(<RepairsScreen />);
    await waitFor(() => expect(screen.getByText('Received from Vikas Mobiles · RPR-001')).toBeTruthy());
  });
});

describe('receiver: incoming request', () => {
  it('previews the saved device facts and accepts once, then opens the new repair', async () => {
    mockRequest = incomingRequest;
    await renderWithAuth(<TransferRequestScreen />);
    await waitFor(() => expect(screen.getByTestId('transfer-accept')).toBeTruthy());

    expect(screen.getByText('Vikas Mobiles wants to send you this device')).toBeTruthy();
    expect(screen.getByText('Smartphone · Samsung A52')).toBeTruthy();
    expect(screen.getByText('123456789012345')).toBeTruthy();
    expect(screen.getByText('Please check the display')).toBeTruthy();
    expect(screen.getByText('2 device photos will be copied')).toBeTruthy();
    // The sender's end customer is never shown to the receiver.
    expect(screen.queryByText(/Anil/)).toBeNull();

    fireEvent.press(screen.getByTestId('transfer-accept'));
    fireEvent.press(screen.getByTestId('transfer-accept'));
    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept).toHaveBeenCalledWith('req-1');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/repairs/new-repair-1'));
  });

  it('declines with an optional reason', async () => {
    mockRequest = incomingRequest;
    await renderWithAuth(<TransferRequestScreen />);
    await waitFor(() => expect(screen.getByTestId('transfer-decline')).toBeTruthy());
    fireEvent.press(screen.getByTestId('transfer-decline'));
    fireEvent.changeText(screen.getByPlaceholderText('e.g. No parts for this model right now'), 'No parts');
    fireEvent.press(screen.getByTestId('transfer-decline-confirm'));
    await waitFor(() => expect(mockDecline).toHaveBeenCalledWith('req-1', { reason: 'No parts' }));
  });

  it('hides accept/decline from staff without the update-repairs toggle', async () => {
    mockRole = 'technician';
    mockFeatures = { repairs: true, repairs_update: false, customers: true };
    mockRequest = incomingRequest;
    await renderWithAuth(<TransferRequestScreen />);
    await waitFor(() => expect(screen.getByText(/Only staff with the “update repairs” permission/)).toBeTruthy());
    expect(screen.queryByTestId('transfer-accept')).toBeNull();
  });
});

describe('sender: pending request', () => {
  it('shows waiting state and cancels through the shared dialog', async () => {
    mockRequest = { ...incomingRequest, side: 'sender', sourceRepairId: 'rep-1' };
    await renderWithAuth(<TransferRequestScreen />);
    await waitFor(() => expect(screen.getByTestId('transfer-cancel')).toBeTruthy());
    expect(screen.getByText('Waiting for Ravi Repairs to accept')).toBeTruthy();
    expect(screen.queryByTestId('transfer-accept')).toBeNull();

    fireEvent.press(screen.getByTestId('transfer-cancel'));
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const call = mockConfirm.mock.calls[0][0] as ConfirmCall;
    expect(call.title).toBe('Cancel this request?');
    await act(async () => { await call.actions[0].onPress(); });
    expect(mockCancel).toHaveBeenCalledWith('req-1');
  });

  it('after a decline, shows the reason and a resend path', async () => {
    mockRequest = {
      ...incomingRequest, side: 'sender', sourceRepairId: 'rep-1', status: 'declined',
      respondedByName: 'Ravi', respondedAt: '2026-09-19T09:00:00.000Z', declineReason: 'No parts',
    };
    await renderWithAuth(<TransferRequestScreen />);
    await waitFor(() => expect(screen.getByTestId('transfer-resend')).toBeTruthy());
    expect(screen.getByText('Declined by Ravi Repairs')).toBeTruthy();
    expect(screen.getByText('Reason: No parts')).toBeTruthy();
    fireEvent.press(screen.getByTestId('transfer-resend'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(tabs)/repairs/dealer-transactions/send', params: { repairId: 'rep-1' } });
  });
});
