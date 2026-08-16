/**
 * Guards the repair detail/edit screen — where staff update status,
 * diagnosis/service notes, and money fields — against regressions that
 * silently lose an update:
 *  - a failed update alerts and keeps the edited values on screen for retry
 *  - a successful update replaces the record in the shop's repairs list
 *
 * Mock boundary is the API client (network) plus native-only modules —
 * the real AuthContext, real DataContext, and the real detail screen render.
 * Pattern follows __tests__/repair-intake.test.tsx.
 */
import React from 'react';
import { Alert, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mocks (network + native boundaries only) ─────────────────────────────
const mockRepairsUpdate = jest.fn();

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
    requestUploadUrl: jest.fn(),
    repairPhotosAdd: jest.fn(),
    repairPartsAdd: jest.fn(),
    repairPaymentsCreate: jest.fn(),
    repairAssignTechnician: jest.fn(),
    repairTesting: jest.fn(),
    estimateApprovalsCreate: jest.fn(),
    estimateApprovalsDecide: jest.fn(),
    estimateApprovalsSendOtp: jest.fn(),
    deliveryOtpSend: jest.fn(),
    deliveryOtpVerify: jest.fn(),
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
jest.mock('react-native-keyboard-controller', () => {
  const { ScrollView, View } = require('react-native');
  return { KeyboardAwareScrollView: ScrollView, KeyboardAvoidingView: View };
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
  problem: 'Screen cracked, no display', diagnosis: 'Old diagnosis', workPerformed: 'Old work',
  status: 'repairing', priority: 'normal', repairCharge: 2500, partsCharge: 0, advance: 0,
  receiveDate: '2026-08-08', expectedDate: '2026-08-15', warrantyDays: 0, checklist: {}, createdAt: '',
};

/** Shows the current repairs list so tests can assert the record's state. */
function RepairsProbe() {
  const { repairs } = useData();
  return (
    <>
      {repairs.map((r) => (
        <Text key={r.id}>{`repair:${r.id}:${r.status}:${r.diagnosis ?? ''}`}</Text>
      ))}
      {repairs.map((r) => (
        <Text key={`m-${r.id}`}>
          {`money:${r.id}:${r.repairCharge}:${(r as any).serviceCharge ?? 0}:${(r as any).otherCharge ?? 0}:${(r as any).discount ?? 0}:${(r as any).taxPercent ?? 0}`}
        </Text>
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

/**
 * Opens the Edit Service Details modal. With the tabbed service section the
 * sheet opens from the Repairing tab's "Update Repair Work" button (repair is
 * in the repairing stage in these tests, so Repairing is the default tab).
 */
const openServiceEdit = async () => {
  await press('Update Repair Work');
  expect(screen.getByText('Edit Service Details')).toBeTruthy();
};

/** Opens the Edit Financials modal via the Edit Estimate action. */
const openFinancialEdit = async () => {
  await press('Edit Estimate');
  expect(screen.getByText('Edit Financials')).toBeTruthy();
};

/** Fills the financial edit inputs with distinct new amounts. */
const fillFinancialEdits = () => {
  // Labour/repair charge shows the current value; the other four start at '0'
  // in modal order: service charge, other charge, discount, tax %.
  fireEvent.changeText(screen.getByDisplayValue('2500'), '3000');
  const zeros = screen.getAllByDisplayValue('0');
  expect(zeros.length).toBe(4);
  fireEvent.changeText(zeros[0], '150'); // service charge
  fireEvent.changeText(zeros[1], '80'); // other charge
  fireEvent.changeText(zeros[2], '200'); // discount
  fireEvent.changeText(zeros[3], '18'); // tax %
};

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockLists)) mockLists[key] = [];
  mockLists.repairs = [{ ...baseRepair }];
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

// ── Failed update alerts and keeps the edited values ─────────────────────
describe('failed update alerts and keeps edited values', () => {
  it('service-details save failure alerts, keeps the modal open with edits, and the record unchanged', async () => {
    mockRepairsUpdate.mockRejectedValue(new Error('boom'));
    const { unmount } = await renderDetail();
    await openServiceEdit();

    fireEvent.changeText(screen.getByDisplayValue('Old diagnosis'), 'Battery swollen, needs replacement');
    fireEvent.changeText(screen.getByDisplayValue('Old work'), 'Opened back panel');
    await press('Update Status');

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Error', expect.any(String)),
    );
    // Modal stayed open with every edited value intact for retry.
    expect(screen.getByText('Edit Service Details')).toBeTruthy();
    expect(screen.getByDisplayValue('Battery swollen, needs replacement')).toBeTruthy();
    expect(screen.getByDisplayValue('Opened back panel')).toBeTruthy();
    // The list still holds the original record — nothing was replaced.
    expect(screen.getByText('repair:r1:repairing:Old diagnosis')).toBeTruthy();
    unmount();
  });

  it('status update failure alerts, keeps the picker open, and the status unchanged', async () => {
    mockRepairsUpdate.mockRejectedValue(new Error('boom'));
    const { unmount } = await renderDetail();

    await press('Continue & Save');
    expect(screen.getByText('Move job to testing')).toBeTruthy(); // picker open, next step unlocked
    await press('Move job to testing');

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Update failed', expect.stringContaining('update the repair')),
    );
    // Picker stayed open so staff can retry; status untouched in the list.
    expect(screen.getByText('Move job to testing')).toBeTruthy();
    expect(screen.getByText('repair:r1:repairing:Old diagnosis')).toBeTruthy();
    unmount();
  });
});

// ── Financial edits: failure keeps entered amounts, success saves them ───
describe('financial edit keeps amounts on failure and saves them on success', () => {
  it('failed financial save alerts, keeps the modal open with every entered amount, and the record unchanged', async () => {
    mockRepairsUpdate.mockRejectedValue(new Error('boom'));
    const { unmount } = await renderDetail();
    await openFinancialEdit();
    fillFinancialEdits();
    await press('Save');

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('update the repair')),
    );
    // Modal stayed open with every entered amount intact for retry.
    expect(screen.getByText('Edit Financials')).toBeTruthy();
    expect(screen.getByDisplayValue('3000')).toBeTruthy();
    expect(screen.getByDisplayValue('150')).toBeTruthy();
    expect(screen.getByDisplayValue('80')).toBeTruthy();
    expect(screen.getByDisplayValue('200')).toBeTruthy();
    expect(screen.getByDisplayValue('18')).toBeTruthy();
    // The list still holds the original money values — nothing was replaced.
    expect(screen.getByText('money:r1:2500:0:0:0:0')).toBeTruthy();
    unmount();
  });

  it('successful financial save sends every changed amount and the updated record replaces the old one', async () => {
    mockRepairsUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      const updated = { ...baseRepair, ...patch, id };
      mockLists.repairs = [updated]; // server now returns the new record on reload
      return { repair: updated };
    });
    const { unmount } = await renderDetail();
    await openFinancialEdit();
    fillFinancialEdits();
    await press('Save');

    await waitFor(() => expect(screen.getByText('money:r1:3000:150:80:200:18')).toBeTruthy());
    expect(screen.queryByText('money:r1:2500:0:0:0:0')).toBeNull();
    expect(screen.queryByText('Edit Financials')).toBeNull(); // modal closed
    expect(alertSpy).not.toHaveBeenCalled();

    // Every changed monetary field reached the API — none silently dropped.
    expect(mockRepairsUpdate).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        repairCharge: 3000,
        serviceCharge: 150,
        otherCharge: 80,
        discount: 200,
        taxPercent: 18,
      }),
    );
    unmount();
  });
});

// ── Successful update replaces the record in the list ────────────────────
describe('successful update replaces the record in the list', () => {
  it('saving service details sends the edits and the updated record replaces the old one', async () => {
    mockRepairsUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      const updated = { ...baseRepair, ...patch, id };
      mockLists.repairs = [updated]; // server now returns the new record on reload
      return { repair: updated };
    });
    const { unmount } = await renderDetail();
    await openServiceEdit();

    fireEvent.changeText(screen.getByDisplayValue('Old diagnosis'), 'Battery swollen, needs replacement');
    fireEvent.changeText(screen.getByDisplayValue('Old work'), 'Replaced battery');
    await press('Update Status');

    await waitFor(() =>
      expect(screen.getByText('repair:r1:repairing:Battery swollen, needs replacement')).toBeTruthy(),
    );
    expect(screen.queryByText('repair:r1:repairing:Old diagnosis')).toBeNull();
    // Modal closed and the screen shows the new diagnosis text.
    expect(screen.queryByText('Edit Service Details')).toBeNull();
    expect(screen.getAllByText('Battery swollen, needs replacement').length).toBeGreaterThanOrEqual(1);
    expect(alertSpy).not.toHaveBeenCalled();

    // Only the current stage's fields are sent — the complaint is immutable
    // and is never included in the payload.
    expect(mockRepairsUpdate).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        diagnosis: 'Battery swollen, needs replacement',
        workPerformed: 'Replaced battery',
      }),
    );
    expect(mockRepairsUpdate).toHaveBeenCalledWith('r1', expect.not.objectContaining({ problem: expect.anything() }));
    unmount();
  });

  it('status change to Testing updates the record in the list and closes the picker', async () => {
    mockRepairsUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      const updated = { ...baseRepair, ...patch, id };
      mockLists.repairs = [updated];
      return { repair: updated };
    });
    const { unmount } = await renderDetail();

    await press('Continue & Save');
    await press('Move job to testing');

    await waitFor(() => expect(screen.getByText('repair:r1:testing:Old diagnosis')).toBeTruthy());
    expect(screen.queryByText('repair:r1:repairing:Old diagnosis')).toBeNull();
    expect(mockRepairsUpdate).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'testing' }));
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });
});
