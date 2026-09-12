import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockRepairsUpdate = jest.fn();
const mockRepairPaymentsCreate = jest.fn();
const mockLists: Record<string, unknown[]> = {
  repairs: [],
  customers: [],
  items: [],
  purchases: [],
  entries: [],
};

jest.mock('@workspace/api-client-react', () => {
  class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, data: unknown) {
      super(`HTTP ${status}`);
      this.status = status;
      this.data = data;
    }
  }
  const emptyList = (key: string) => jest.fn(async () => ({ [key]: [...mockLists[key]] }));
  const idleHook = () => jest.fn(() => ({ data: undefined, refetch: jest.fn(async () => ({})) }));
  const key = (name: string) => jest.fn(() => [name]);
  return {
    ApiError,
    authMe: jest.fn(async () => ({
      user: { id: 'u1', name: 'Owner', email: 'o@x.y', mobile: '9876543210', role: 'dealer', isActive: true },
    })),
    authLogin: jest.fn(),
    authLogout: jest.fn(),
    authOtpRequest: jest.fn(),
    authOtpVerify: jest.fn(),
    setUnauthorizedHandler: jest.fn(),
    repairsList: emptyList('repairs'),
    customersList: emptyList('customers'),
    inventoryList: emptyList('items'),
    purchasesList: emptyList('purchases'),
    financeList: emptyList('entries'),
    repairsCreate: jest.fn(),
    repairsUpdate: (...args: unknown[]) => mockRepairsUpdate(...args),
    customersCreate: jest.fn(),
    customersUpdate: jest.fn(),
    inventoryCreate: jest.fn(),
    inventoryUpdate: jest.fn(),
    purchasesCreate: jest.fn(),
    purchasesUpdate: jest.fn(),
    financeCreate: jest.fn(),
    financeUpdate: jest.fn(),
    approvalsCreate: jest.fn(),
    sampleDataLoad: jest.fn(),
    sampleDataClear: jest.fn(),
    useRepairsGet: idleHook(),
    useRepairPhotosList: idleHook(),
    useRepairEventsList: idleHook(),
    useReturnsList: idleHook(),
    useRepairPartsList: idleHook(),
    useRepairPaymentsList: idleHook(),
    useStaffList: idleHook(),
    useEstimateApprovalsList: idleHook(),
    useRepairTesting: idleHook(),
    getRepairsGetQueryKey: key('repairGet'),
    getRepairPhotosListQueryKey: key('photos'),
    getRepairEventsListQueryKey: key('events'),
    getReturnsListQueryKey: key('returns'),
    getRepairPartsListQueryKey: key('parts'),
    getRepairPaymentsListQueryKey: key('payments'),
    getStaffListQueryKey: key('staff'),
    getEstimateApprovalsListQueryKey: key('estimateApprovals'),
    requestUploadUrl: jest.fn(),
    repairPhotosAdd: jest.fn(),
    repairPartsAdd: jest.fn(),
    repairPaymentsCreate: (...args: unknown[]) => mockRepairPaymentsCreate(...args),
    repairPaymentVoid: jest.fn(),
    repairAssignTechnician: jest.fn(),
    repairTesting: jest.fn(),
    estimateApprovalsCreate: jest.fn(),
    estimateApprovalsDecide: jest.fn(),
    estimateApprovalsSendOtp: jest.fn(),
    repairNotifyReady: jest.fn(),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'r1' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Error: 'error', Success: 'success' },
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light' },
}));
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: (props: object) => <View {...props} /> };
});
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 128 })),
}));
jest.mock('expo-file-system', () => ({ File: class {} }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-print', () => ({ printAsync: jest.fn(), printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => false), shareAsync: jest.fn() }));
jest.mock('react-native-qrcode-svg', () => {
  const { View } = require('react-native');
  return (props: object) => <View {...props} />;
});
// Destructive confirmations go through the shared dialog; mock its hook so the
// screen renders without the root provider.
const mockConfirm = jest.fn();
jest.mock('@/components/ui/ConfirmDialog', () => ({
  ...jest.requireActual('@/components/ui/ConfirmDialog'),
  useConfirmDialog: () => ({ confirm: mockConfirm }),
}));
jest.mock('@/utils/seedData', () => ({ seedIfNeeded: jest.fn(async () => {}) }));
jest.mock('@/utils/storage', () => ({
  KEYS: { AUTH_TOKEN: 'auth_token', CURRENT_USER: 'current_user' },
  storage: {
    get: jest.fn(async (key: string) => (key === 'auth_token' ? 'tok' : null)),
    set: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
  },
}));

import { AuthProvider } from '@/context/AuthContext';
import { DataProvider, useData } from '@/context/DataContext';
import RepairDetailScreen from '@/app/(tabs)/repairs/[id]';

const baseRepair = {
  id: 'r1',
  repairId: 'VMC-1001',
  customerId: 'c1',
  customerName: 'Asha Kumar',
  mobile: '9876543210',
  deviceType: 'Smartphone',
  brand: 'Samsung',
  model: 'Galaxy S23',
  problem: 'Screen cracked, no display',
  diagnosis: 'Panel damaged',
  workPerformed: 'Replaced panel',
  testingChecklist: { power_on: true },
  status: 'ready',
  priority: 'normal',
  repairCharge: 2500,
  partsCharge: 0,
  advance: 2500,
  paidAmount: 2500,
  totalAmount: 2500,
  balance: 0,
  receiveDate: '2026-08-08',
  expectedDate: '2026-08-15',
  warrantyDays: 0,
  checklist: {},
  createdAt: '',
};

function RepairsProbe() {
  const { repairs } = useData();
  return (
    <>
      {repairs.map((repair) => (
        <Text key={repair.id}>{`repair:${repair.id}:${repair.status}:${repair.warrantyDays ?? ''}:${repair.paymentMethod ?? ''}`}</Text>
      ))}
    </>
  );
}

async function renderDetail(repair = baseRepair) {
  mockLists.repairs = [{ ...repair }];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DataProvider>
          <RepairsProbe />
          <RepairDetailScreen />
        </DataProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  await act(async () => {});
  await act(async () => {});
  return result;
}

const press = async (label: string) =>
  act(async () => {
    const matches = screen.getAllByText(label);
    fireEvent.press(matches[matches.length - 1]);
  });

const acceptUpdate = () =>
  mockRepairsUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
    const current = mockLists.repairs[0] as Record<string, unknown>;
    const updated = { ...current, ...patch, id };
    mockLists.repairs = [updated];
    return { repair: updated };
  });

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockLists)) mockLists[key] = [];
  mockRepairPaymentsCreate.mockResolvedValue({ payment: { id: 'p1', amount: 2000 } });
});

describe('repair stage primary action', () => {
  it.each([
    ['received', 'Continue as Repairing'],
    ['repairing', 'Continue as Testing'],
    ['testing', 'Continue as Ready'],
    ['ready', 'Continue to Deliver'],
  ])('shows the destination label for %s', async (status, label) => {
    const { unmount } = await renderDetail({ ...baseRepair, status });
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('Continue & Save')).toBeNull();
    unmount();
  });

  it('keeps the repair detail open after received advances to repairing', async () => {
    acceptUpdate();
    const { unmount } = await renderDetail({ ...baseRepair, status: 'received' });

    await press('Continue as Repairing');

    await waitFor(() => expect(screen.getByText('Continue as Testing')).toBeTruthy());
    expect(screen.queryByText('Repair not found')).toBeNull();
    expect(mockRepairsUpdate).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'repairing' }),
    );
    unmount();
  });

  it('does not expose payment, signature, or delivery OTP actions on the repair page', async () => {
    const { unmount } = await renderDetail();
    expect(screen.queryByText('Receive Payment')).toBeNull();
    expect(screen.queryByText('Delivery Signature')).toBeNull();
    expect(screen.queryByText('Verify Delivery OTP')).toBeNull();
    expect(screen.queryByText('Proceed to Signature (No OTP)')).toBeNull();
    unmount();
  });
});

describe('delivery payment decision', () => {
  it('delivers an already-paid repair without OTP or signature', async () => {
    acceptUpdate();
    const { unmount } = await renderDetail();
    await press('Continue to Deliver');
    expect(screen.getAllByText('Complete Delivery')).toHaveLength(2);
    await press('Complete Delivery');

    await waitFor(() => expect(screen.getByText('repair:r1:delivered:0:')).toBeTruthy());
    expect(mockRepairPaymentsCreate).not.toHaveBeenCalled();
    expect(mockRepairsUpdate).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        status: 'delivered',
        deliveryDate: expect.any(String),
      }),
    );
    expect(mockRepairsUpdate.mock.calls[0][1].deliverySignaturePath).toBeUndefined();
    expect(mockRepairsUpdate.mock.calls[0][1].otpVerified).toBeUndefined();
    unmount();
  });

  it('delivers with an explicitly accepted due without recording a payment', async () => {
    acceptUpdate();
    const dueRepair = { ...baseRepair, advance: 500, paidAmount: 500, balance: 2000 };
    const { unmount } = await renderDetail(dueRepair);
    await press('Continue to Deliver');
    expect(screen.getAllByText('Due').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Mark as Paid')).toBeTruthy();
    await press('Due');

    await waitFor(() => expect(screen.getByText('repair:r1:delivered:0:')).toBeTruthy());
    expect(mockRepairPaymentsCreate).not.toHaveBeenCalled();
    unmount();
  });

  it('records the remaining balance before delivering when marked paid', async () => {
    acceptUpdate();
    const dueRepair = { ...baseRepair, advance: 500, paidAmount: 500, balance: 2000 };
    const { unmount } = await renderDetail(dueRepair);
    await press('Continue to Deliver');
    await press('UPI');
    await press('Mark as Paid');

    await waitFor(() => expect(screen.getByText('repair:r1:delivered:0:UPI')).toBeTruthy());
    expect(mockRepairPaymentsCreate).toHaveBeenCalledWith('r1', {
      amount: 2000,
      method: 'UPI',
      kind: 'final',
      note: 'Payment received at delivery',
    });
    expect(mockRepairsUpdate).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        status: 'delivered',
        paymentMethod: 'UPI',
      }),
    );
    unmount();
  });
});