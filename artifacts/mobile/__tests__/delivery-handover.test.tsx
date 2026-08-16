/**
 * Guards the delivery handover flow — the terminal step that marks a repair
 * delivered and locks its money fields — against regressions that could
 * finish a delivery without a recorded signature/OTP or drop the warranty
 * and payment-method settings:
 *  - a failed signature upload alerts and does NOT mark the repair delivered
 *  - a successful signature path sends the stored signature path with
 *    status 'delivered'
 *  - a successful OTP verify sends status 'delivered' with the chosen
 *    warranty days and payment method
 *  - a failed OTP verify alerts and keeps the repair undelivered
 *
 * Mock boundary is the API client (network) plus native-only modules —
 * the real AuthContext, real DataContext, and the real detail screen render.
 * Pattern follows __tests__/repair-edit.test.tsx.
 */
import React from 'react';
import { Alert, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mocks (network + native boundaries only) ─────────────────────────────
const mockRepairsUpdate = jest.fn();
const mockDeliveryOtpSend = jest.fn();
const mockDeliveryOtpVerify = jest.fn();
const mockRequestUploadUrl = jest.fn();
const mockExpoFetch = jest.fn();

const mockLists: Record<string, unknown[]> = { repairs: [], customers: [], items: [], purchases: [], entries: [] };

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
    repairsUpdate: (...a: unknown[]) => mockRepairsUpdate(...a),
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
    // Detail-screen react-query hooks — all idle (no photos/parts/etc.).
    useRepairPhotosList: idleHook(),
    useRepairEventsList: idleHook(),
    useReturnsList: idleHook(),
    useRepairPartsList: idleHook(),
    useRepairPaymentsList: idleHook(),
    useStaffList: idleHook(),
    useEstimateApprovalsList: idleHook(),
    useRepairTesting: idleHook(),
    getRepairPhotosListQueryKey: key('photos'),
    getRepairEventsListQueryKey: key('events'),
    getReturnsListQueryKey: key('returns'),
    getRepairPartsListQueryKey: key('parts'),
    getRepairPaymentsListQueryKey: key('payments'),
    getStaffListQueryKey: key('staff'),
    getEstimateApprovalsListQueryKey: key('estimateApprovals'),
    requestUploadUrl: (...a: unknown[]) => mockRequestUploadUrl(...a),
    repairPhotosAdd: jest.fn(),
    repairPartsAdd: jest.fn(),
    repairPaymentsCreate: jest.fn(),
    repairAssignTechnician: jest.fn(),
    repairTesting: jest.fn(),
    estimateApprovalsCreate: jest.fn(),
    estimateApprovalsDecide: jest.fn(),
    estimateApprovalsSendOtp: jest.fn(),
    deliveryOtpSend: (...a: unknown[]) => mockDeliveryOtpSend(...a),
    deliveryOtpVerify: (...a: unknown[]) => mockDeliveryOtpVerify(...a),
    repairNotifyReady: jest.fn(),
  };
});

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: jest.fn(), push: jest.fn() }),
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

// Native-only modules the detail screen imports but these tests never exercise.
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: (props: object) => <View {...props} /> };
});
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 128 })),
  writeAsStringAsync: jest.fn(async () => {}),
  cacheDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
}));
jest.mock('expo-file-system', () => ({ File: class {} }));
jest.mock('expo/fetch', () => ({ fetch: (...a: unknown[]) => mockExpoFetch(...a) }));
jest.mock('expo-print', () => ({ printAsync: jest.fn(), printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => false), shareAsync: jest.fn() }));
// Capture the signature pad props so tests can drive onOK (a drawn signature).
const mockSigProps: { current: { onOK?: (sig: string) => void } } = { current: {} };
jest.mock('react-native-signature-canvas', () => {
  const { View } = require('react-native');
  return (props: { onOK?: (sig: string) => void }) => {
    mockSigProps.current = props;
    return <View testID="signature-pad" />;
  };
});
jest.mock('react-native-qrcode-svg', () => {
  const { View } = require('react-native');
  return (props: object) => <View {...props} />;
});

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
  id: 'r1', repairId: 'VMC-1001', customerId: 'c1', customerName: 'Asha Kumar', mobile: '9876543210',
  deviceType: 'Smartphone', brand: 'Samsung', model: 'Galaxy S23',
  problem: 'Screen cracked, no display', diagnosis: 'Panel damaged', workPerformed: 'Replaced panel',
  // Fully paid (advance == charge): delivery is payment-gated, so the
  // "Mark as Delivered" button only appears once nothing is left to pay.
  status: 'ready', priority: 'normal', repairCharge: 2500, partsCharge: 0, advance: 2500,
  receiveDate: '2026-08-08', expectedDate: '2026-08-15', warrantyDays: 0, checklist: {}, createdAt: '',
};

/** Shows the current repairs list so tests can assert delivery state. */
function RepairsProbe() {
  const { repairs } = useData();
  return (
    <>
      {repairs.map((r) => (
        <Text key={r.id}>{`repair:${r.id}:${r.status}:${(r as any).warrantyDays ?? ''}:${(r as any).paymentMethod ?? ''}`}</Text>
      ))}
    </>
  );
}

async function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <DataProvider>
          <RepairsProbe />
          <RepairDetailScreen />
        </DataProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  // Let the auth restore (storage + authMe) and initial data load settle.
  await act(async () => {});
  await act(async () => {});
  return utils;
}

const press = async (label: string) =>
  act(async () => {
    const matches = screen.getAllByText(label);
    fireEvent.press(matches[matches.length - 1]);
  });

/** The screen swaps modals via 350ms setTimeout; flush those transitions. */
const flushModalSwap = async () =>
  act(async () => {
    jest.advanceTimersByTime(400);
  });

/** Update Status → Delivered → handover modal (after the modal-swap delay). */
const openHandover = async () => {
  await press('Mark as Delivered');
  // Pressing the button raises a native confirm Alert; drive its confirm action.
  const confirmCall = alertSpy.mock.calls.find((c) => c[0] === 'Confirm Delivery');
  expect(confirmCall).toBeTruthy();
  await act(async () => {
    confirmCall![2][1].onPress();
  });
  alertSpy.mockClear();
  await flushModalSwap();
  expect(screen.getByText('Delivery Handover')).toBeTruthy();
};

/** Handover modal → Proceed to Signature → signature pad visible. */
const proceedToSignature = async () => {
  await press('Proceed to Signature (No OTP)');
  await flushModalSwap();
  expect(screen.getByText('Delivery Signature')).toBeTruthy();
  expect(mockSigProps.current.onOK).toBeTruthy();
};

/** Drives the signature pad's onOK as if the customer drew and confirmed. */
const submitSignature = async () =>
  act(async () => {
    await mockSigProps.current.onOK!('data:image/png;base64,AAAA');
  });

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockLists)) mockLists[key] = [];
  mockLists.repairs = [{ ...baseRepair }];
  mockSigProps.current = {};
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

/** Server accepts the update and returns the new record on reload. */
const acceptUpdate = () =>
  mockRepairsUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
    const updated = { ...baseRepair, ...patch, id };
    mockLists.repairs = [updated];
    return { repair: updated };
  });

// ── Signature path ────────────────────────────────────────────────────────
describe('signature handover path', () => {
  it('a failed signature upload alerts and does NOT mark the repair delivered', async () => {
    mockRequestUploadUrl.mockRejectedValue(new Error('storage down'));
    const { unmount } = await renderDetail();
    await openHandover();
    await proceedToSignature();
    await submitSignature();

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Update failed', expect.stringContaining('signature')),
    );
    // The delivery never reached the API and the repair stayed undelivered.
    expect(mockRepairsUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('repair:r1:ready:0:')).toBeTruthy();
    unmount();
  });

  it('a rejected upload PUT also alerts and keeps the repair undelivered', async () => {
    mockRequestUploadUrl.mockResolvedValue({ uploadURL: 'https://sig.upload', objectPath: '/objects/uploads/s1/sig.png' });
    mockExpoFetch.mockResolvedValue({ ok: false, status: 500 });
    const { unmount } = await renderDetail();
    await openHandover();
    await proceedToSignature();
    await submitSignature();

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Update failed', expect.stringContaining('signature')),
    );
    expect(mockRepairsUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('repair:r1:ready:0:')).toBeTruthy();
    unmount();
  });

  it('a successful signature stores the signature path and delivers with warranty + payment method', async () => {
    mockRequestUploadUrl.mockResolvedValue({ uploadURL: 'https://sig.upload', objectPath: '/objects/uploads/s1/sig.png' });
    mockExpoFetch.mockResolvedValue({ ok: true });
    acceptUpdate();
    const { unmount } = await renderDetail();
    await openHandover();
    await press('UPI'); // payment method
    await press('30'); // warranty days
    await proceedToSignature();
    await submitSignature();

    await waitFor(() => expect(screen.getByText('repair:r1:delivered:30:UPI')).toBeTruthy());
    expect(mockRepairsUpdate).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        status: 'delivered',
        deliverySignaturePath: '/objects/uploads/s1/sig.png',
        warrantyDays: 30,
        paymentMethod: 'UPI',
      }),
    );
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });
});

// ── OTP path ──────────────────────────────────────────────────────────────
describe('OTP handover path', () => {
  const openOtpModal = async () => {
    await press('Send OTP');
    await flushModalSwap();
    expect(screen.getByText('Verify Delivery OTP')).toBeTruthy();
    expect(mockDeliveryOtpSend).toHaveBeenCalledWith('r1');
  };

  it('a successful OTP verify sends status delivered with warranty days and payment method', async () => {
    mockDeliveryOtpSend.mockResolvedValue({});
    mockDeliveryOtpVerify.mockResolvedValue({ verified: true });
    acceptUpdate();
    const { unmount } = await renderDetail();
    await openHandover();
    await press('UPI'); // payment method
    await press('90'); // warranty days
    await openOtpModal();

    fireEvent.changeText(screen.getByPlaceholderText('OTP Code'), '123456');
    await press('Verify & Deliver');

    await waitFor(() => expect(screen.getByText('repair:r1:delivered:90:UPI')).toBeTruthy());
    expect(mockDeliveryOtpVerify).toHaveBeenCalledWith('r1', { code: '123456' });
    expect(mockRepairsUpdate).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        status: 'delivered',
        warrantyDays: 90,
        paymentMethod: 'UPI',
      }),
    );
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('a failed OTP verify alerts and keeps the repair undelivered in the list', async () => {
    mockDeliveryOtpSend.mockResolvedValue({});
    mockDeliveryOtpVerify.mockRejectedValue(new Error('Invalid or expired OTP'));
    const { unmount } = await renderDetail();
    await openHandover();
    await openOtpModal();

    fireEvent.changeText(screen.getByPlaceholderText('OTP Code'), '000000');
    await press('Verify & Deliver');

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('OTP')),
    );
    // Delivery was never sent — the repair stays undelivered for retry.
    expect(mockRepairsUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('repair:r1:ready:0:')).toBeTruthy();
    unmount();
  });

  it('an empty OTP code does nothing — no verify call, repair untouched', async () => {
    mockDeliveryOtpSend.mockResolvedValue({});
    const { unmount } = await renderDetail();
    await openHandover();
    await openOtpModal();

    await press('Verify & Deliver'); // no code entered

    expect(mockDeliveryOtpVerify).not.toHaveBeenCalled();
    expect(mockRepairsUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('repair:r1:ready:0:')).toBeTruthy();
    unmount();
  });
});
