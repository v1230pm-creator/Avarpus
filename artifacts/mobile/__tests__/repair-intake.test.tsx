/**
 * Guards the repair intake form (the app's longest, most important form)
 * against regressions that would lose a staff member's entire ticket entry:
 *  - required-field validation blocks submit (no API call fired)
 *  - a failed save shows the alert AND keeps every entered value for retry
 *  - a successful save adds the repair to the shop's list
 *
 * Mock boundary is the API client (network) plus native-only modules —
 * the real AuthContext, real DataContext, and the real intake screen render.
 * Pattern follows __tests__/form-sheets.test.tsx.
 */
import React from 'react';
import { Alert, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// ── Mocks (network + native boundaries only) ─────────────────────────────
const mockRepairsCreate = jest.fn();
const mockRepairsUpdate = jest.fn();
const mockCustomersCreate = jest.fn();
const mockApprovalsCreate = jest.fn();

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
    repairsCreate: (...a: unknown[]) => mockRepairsCreate(...a),
    repairsUpdate: (...a: unknown[]) => mockRepairsUpdate(...a),
    customersCreate: (...a: unknown[]) => mockCustomersCreate(...a),
    customersUpdate: jest.fn(),
    inventoryCreate: jest.fn(),
    inventoryUpdate: jest.fn(),
    purchasesCreate: jest.fn(),
    purchasesUpdate: jest.fn(),
    financeCreate: jest.fn(),
    financeUpdate: jest.fn(),
    approvalsCreate: (...a: unknown[]) => mockApprovalsCreate(...a),
    requestUploadUrl: jest.fn(),
    repairPhotosAdd: jest.fn(),
    sampleDataLoad: jest.fn(),
    sampleDataClear: jest.fn(),
  };
});

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: jest.fn(), push: jest.fn() }),
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

// Native-only modules the intake screen imports but these tests never exercise.
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  launchCameraAsync: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  writeAsStringAsync: jest.fn(),
  cacheDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
}));
jest.mock('expo-file-system', () => ({ File: class {} }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-print', () => ({ printAsync: jest.fn(), printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => false), shareAsync: jest.fn() }));
jest.mock('react-native-signature-canvas', () => {
  const { View } = require('react-native');
  return (props: object) => <View {...props} />;
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
import NewRepairScreen from '@/app/(tabs)/repairs/new';

/** Shows the current repairs list so tests can assert records appear. */
function RepairsProbe() {
  const { repairs } = useData();
  return (
    <>
      {repairs.map((r) => (
        <Text key={r.id}>{`repair:${r.customerName}:${r.model}`}</Text>
      ))}
    </>
  );
}

async function renderIntake() {
  const utils = render(
    <AuthProvider>
      <DataProvider>
        <RepairsProbe />
        <NewRepairScreen />
      </DataProvider>
    </AuthProvider>,
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

const type = (placeholder: string, value: string) =>
  fireEvent.changeText(screen.getByPlaceholderText(placeholder), value);

/** Fills every required intake field (brand is a chip selector). */
const fillRequiredFields = async () => {
  type('Full name', 'Asha Kumar');
  type('10-digit number', '9876543210');
  await press('Samsung'); // brand chip
  type('e.g. Galaxy S23', 'Galaxy S23');
  type('Describe the issue...', 'Screen cracked, no display');
};

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockLists)) mockLists[key] = [];
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

// ── Required-field validation blocks submit ──────────────────────────────
describe('required-field validation blocks submit', () => {
  it('empty submit shows field errors and fires no API call', async () => {
    const { unmount } = await renderIntake();
    await press('Complete Intake');

    // name / brand / model / problem all flag "Required"
    expect(screen.getAllByText('Required').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('10-digit mobile required')).toBeTruthy();
    expect(alertSpy).toHaveBeenCalledWith('Validation Error', expect.any(String));
    expect(mockRepairsCreate).not.toHaveBeenCalled();
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(mockApprovalsCreate).not.toHaveBeenCalled();
    unmount();
  });

  it('rejects a short mobile number without calling the API', async () => {
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    type('10-digit number', '98765'); // too short
    await press('Complete Intake');

    expect(screen.getByText('10-digit mobile required')).toBeTruthy();
    expect(mockRepairsCreate).not.toHaveBeenCalled();
    unmount();
  });

  it('rejects an expected date before the receive date without calling the API', async () => {
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    // Both date inputs share the placeholder — first is receive, second expected.
    const dates = screen.getAllByPlaceholderText('YYYY-MM-DD');
    fireEvent.changeText(dates[1], '2000-01-01');
    await press('Complete Intake');

    expect(screen.getByText('Cannot be before the receive date')).toBeTruthy();
    expect(mockRepairsCreate).not.toHaveBeenCalled();
    unmount();
  });
});

// ── Failed save shows the alert and keeps entered values ─────────────────
describe('failed save shows the alert and keeps entered values', () => {
  it('server error alerts and every typed value survives for retry', async () => {
    // Existing customer with this mobile → no customer create on this path.
    mockLists.customers = [
      { id: 'c1', name: 'Asha Kumar', mobile: '9876543210', email: '', address: '', dueAmount: 0, totalRepairs: 0 },
    ];
    mockRepairsCreate.mockRejectedValue(new TypeError('Network request failed'));
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    type('e.g. Charger, Cover, SIM tray', 'Charger, Cover');
    const zeros = screen.getAllByPlaceholderText('0'); // estimate, advance
    fireEvent.changeText(zeros[0], '2500');
    fireEvent.changeText(zeros[1], '500');
    await press('Complete Intake');

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Save failed', expect.stringContaining('save the repair')),
    );
    // The form stayed up with everything the user typed.
    expect(screen.getByDisplayValue('Asha Kumar')).toBeTruthy();
    expect(screen.getByDisplayValue('9876543210')).toBeTruthy();
    expect(screen.getByDisplayValue('Galaxy S23')).toBeTruthy();
    expect(screen.getByDisplayValue('Screen cracked, no display')).toBeTruthy();
    expect(screen.getByDisplayValue('Charger, Cover')).toBeTruthy();
    expect(screen.getByDisplayValue('2500')).toBeTruthy();
    expect(screen.getByDisplayValue('500')).toBeTruthy();
    // No success screen, no navigation, nothing added to the list.
    expect(screen.queryByText('Job Card Created')).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.queryByText(/^repair:/)).toBeNull();
    unmount();
  });

  it('failure while creating the new customer also alerts and keeps values', async () => {
    mockCustomersCreate.mockRejectedValue(new Error('boom'));
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    await press('Complete Intake');

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Save failed', expect.any(String)));
    expect(mockRepairsCreate).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Asha Kumar')).toBeTruthy();
    expect(screen.getByDisplayValue('Screen cracked, no display')).toBeTruthy();
    expect(screen.queryByText(/^repair:/)).toBeNull();
    unmount();
  });

  it('retry after a failure succeeds with the retained values', async () => {
    mockLists.customers = [
      { id: 'c1', name: 'Asha Kumar', mobile: '9876543210', email: '', address: '', dueAmount: 0, totalRepairs: 0 },
    ];
    mockRepairsCreate.mockRejectedValueOnce(new Error('boom'));
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    await press('Complete Intake');
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Save failed', expect.any(String)));

    mockRepairsCreate.mockResolvedValueOnce({
      repair: {
        id: 'r1', repairId: 'VMC-1001', customerId: 'c1', customerName: 'Asha Kumar', mobile: '9876543210',
        deviceType: 'Smartphone', brand: 'Samsung', model: 'Galaxy S23', problem: 'Screen cracked, no display',
        status: 'received', priority: 'normal', repairCharge: 0, partsCharge: 0, advance: 0,
        receiveDate: '2026-08-08', expectedDate: '2026-08-15', warrantyDays: 0, checklist: {}, createdAt: '',
      },
    });
    await press('Complete Intake');
    await waitFor(() => expect(screen.getByText('Job Card Created')).toBeTruthy());
    expect(screen.getByText('repair:Asha Kumar:Galaxy S23')).toBeTruthy();
    unmount();
  });
});

// ── Successful save adds the repair to the list ──────────────────────────
describe('successful save adds the repair to the list', () => {
  it('created repair appears in the list and the success screen shows the ticket', async () => {
    mockCustomersCreate.mockResolvedValue({
      customer: { id: 'c1', name: 'Asha Kumar', mobile: '9876543210', dueAmount: 0, totalRepairs: 0 },
    });
    mockRepairsCreate.mockResolvedValue({
      repair: {
        id: 'r1', repairId: 'VMC-1001', customerId: 'c1', customerName: 'Asha Kumar', mobile: '9876543210',
        deviceType: 'Smartphone', brand: 'Samsung', model: 'Galaxy S23', problem: 'Screen cracked, no display',
        status: 'received', priority: 'normal', repairCharge: 2500, partsCharge: 0, advance: 500,
        receiveDate: '2026-08-08', expectedDate: '2026-08-15', warrantyDays: 0, checklist: {}, createdAt: '',
      },
    });
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    const zeros = screen.getAllByPlaceholderText('0');
    fireEvent.changeText(zeros[0], '2500');
    fireEvent.changeText(zeros[1], '500');
    await press('Complete Intake');

    await waitFor(() => expect(screen.getByText('Job Card Created')).toBeTruthy());
    expect(screen.getByText('repair:Asha Kumar:Galaxy S23')).toBeTruthy();
    expect(screen.getByText(/VMC-1001/)).toBeTruthy();

    // New customer was created first, then the repair, with everything typed.
    expect(mockCustomersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Asha Kumar', mobile: '9876543210' }),
    );
    expect(mockRepairsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'c1',
        customerName: 'Asha Kumar',
        mobile: '9876543210',
        brand: 'Samsung',
        model: 'Galaxy S23',
        problem: 'Screen cracked, no display',
        repairCharge: 2500,
        advance: 500,
        status: 'received',
      }),
    );
    expect(mockApprovalsCreate).not.toHaveBeenCalled(); // dealer saves directly
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });
});
