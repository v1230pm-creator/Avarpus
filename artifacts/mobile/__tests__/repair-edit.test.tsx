/**
 * Guards the repair detail/edit screen — where staff update status, add
 * work notes, and edit money fields — against regressions that silently
 * lose an update:
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
const mockRepairNotesAdd = jest.fn();
/** Timeline events returned by the mocked events hook (work notes live here). */
const mockEvents: { events: unknown[] } = { events: [] };

const mockLists: Record<string, unknown[]> = { repairs: [], customers: [], items: [], purchases: [], entries: [] };
/** State returned by the mocked per-repair GET hook (detail fallback). */
const mockRepairGet: { data: unknown; isLoading: boolean; error: unknown } = { data: undefined, isLoading: false, error: null };

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
    useRepairsGet: jest.fn(() => ({ data: mockRepairGet.data, isLoading: mockRepairGet.isLoading, error: mockRepairGet.error })),
    useRepairPhotosList: idleHook(),
    useRepairEventsList: jest.fn(() => ({ data: { events: [...mockEvents.events] }, refetch: jest.fn(async () => ({})) })),
    useReturnsList: idleHook(),
    useRepairPartsList: idleHook(),
    useRepairPaymentsList: idleHook(),
    useStaffList: idleHook(),
    useEstimateApprovalsList: idleHook(),
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
    repairPaymentsCreate: jest.fn(),
    repairAssignTechnician: jest.fn(),
    repairNotesAdd: (...a: unknown[]) => mockRepairNotesAdd(...a),
    estimateApprovalsCreate: jest.fn(),
    estimateApprovalsDecide: jest.fn(),
    estimateApprovalsSendOtp: jest.fn(),
    deliveryOtpSend: jest.fn(),
    deliveryOtpVerify: jest.fn(),
    repairNotifyReady: jest.fn(),
  };
});

const mockBack = jest.fn();
const mockRoute = { id: 'r1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({ id: mockRoute.id }),
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

const NOTE_PLACEHOLDER = 'Phone mein kya kaam hua? Yahan likhein…';

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
  mockEvents.events = [];
  mockRepairGet.data = undefined;
  mockRepairGet.isLoading = false;
  mockRepairGet.error = null;
  mockRoute.id = 'r1';
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

// ── Failed update alerts and keeps the edited values ─────────────────────
describe('failed update alerts and keeps edited values', () => {
  it('a failed work-note save alerts and keeps the typed note for retry', async () => {
    mockRepairNotesAdd.mockRejectedValue(new Error('boom'));
    const { unmount } = await renderDetail();

    fireEvent.changeText(screen.getByPlaceholderText(NOTE_PLACEHOLDER), 'Replaced battery, phone charging now');
    await press('Add Note');

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Note not saved', expect.any(String)));
    expect(screen.getByDisplayValue('Replaced battery, phone charging now')).toBeTruthy();
    expect(mockRepairsUpdate).not.toHaveBeenCalled();
    unmount();
  });


  it('status update failure alerts and keeps the status unchanged', async () => {
    mockRepairsUpdate.mockRejectedValue(new Error('boom'));
    const { unmount } = await renderDetail();

    await press('Continue as Testing');

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Update failed', expect.stringContaining('update the repair')),
    );
    // The stage-specific action stays available so staff can retry.
    expect(screen.getByText('Continue as Testing')).toBeTruthy();
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
  it('adding a work note posts it, clears the composer, and shows it newest first', async () => {
    mockRepairNotesAdd.mockImplementation(async (id: string, body: { text: string }) => {
      const event = { id: 'ev-new', repairId: id, userName: 'Owner', userRole: 'dealer', action: 'note_added', details: { text: body.text }, createdAt: '2026-09-12T10:00:00.000Z' };
      mockEvents.events = [event, ...mockEvents.events];
      return { event };
    });
    mockEvents.events = [
      { id: 'ev-old', repairId: 'r1', userName: 'Ravi', userRole: 'technician', action: 'note_added', details: { text: 'Opened back panel' }, createdAt: '2026-09-11T10:00:00.000Z' },
      { id: 'ev-status', repairId: 'r1', userName: 'Owner', userRole: 'dealer', action: 'status_changed', details: { to: 'repairing' }, createdAt: '2026-09-10T10:00:00.000Z' },
    ];
    const { unmount } = await renderDetail();

    // Existing note and legacy structured fields are readable in the card.
    // (The newest note is also echoed as the summary card's Notes line.)
    expect(screen.getAllByText('Opened back panel').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Old diagnosis')).toBeTruthy();
    expect(screen.getByText('Old work')).toBeTruthy();
    // The old Complaint / Diagnosis / Repairing / Testing tab card is gone.
    expect(screen.queryByText('Complaint')).toBeNull();
    expect(screen.queryByText('Update Repair Work')).toBeNull();
    expect(screen.queryByText('Edit Service Details')).toBeNull();

    fireEvent.changeText(screen.getByPlaceholderText(NOTE_PLACEHOLDER), '  Replaced battery  ');
    await press('Add Note');

    await waitFor(() => expect(mockRepairNotesAdd).toHaveBeenCalledWith('r1', { text: 'Replaced battery' }));
    await waitFor(() => expect(screen.getAllByText('Replaced battery').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByPlaceholderText(NOTE_PLACEHOLDER).props.value).toBe('');
    // Notes never go through the repair PATCH, so nothing structured changed.
    expect(mockRepairsUpdate).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('moves to Testing without diagnosis, work performed, or a test result', async () => {
    mockLists.repairs = [{ ...baseRepair, diagnosis: undefined, workPerformed: undefined, testingChecklist: undefined }];
    mockRepairsUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      const updated = { ...baseRepair, diagnosis: undefined, workPerformed: undefined, ...patch, id };
      mockLists.repairs = [updated];
      return { repair: updated };
    });
    const { unmount } = await renderDetail();

    await press('Continue as Testing');

    await waitFor(() => expect(screen.getByText('repair:r1:testing:')).toBeTruthy());
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockRepairsUpdate).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'testing' }));
    unmount();
  });


  it('status change to Testing updates the record directly', async () => {
    mockRepairsUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      const updated = { ...baseRepair, ...patch, id };
      mockLists.repairs = [updated];
      return { repair: updated };
    });
    const { unmount } = await renderDetail();

    await press('Continue as Testing');

    await waitFor(() => expect(screen.getByText('repair:r1:testing:Old diagnosis')).toBeTruthy());
    expect(screen.queryByText('repair:r1:repairing:Old diagnosis')).toBeNull();
    expect(mockRepairsUpdate).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'testing' }));
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });
});

// ── Detail must not depend on the bulk list containing the row ───────────
describe('detail resolves the repair even when the shop list lacks it', () => {
  it('renders from the per-repair GET when the list snapshot does not contain the id', async () => {
    mockLists.repairs = [];
    mockRepairGet.data = { repair: { ...baseRepair } };
    const { unmount } = await renderDetail();
    expect(screen.queryByText('Repair not found')).toBeNull();
    expect(screen.getByText('Asha Kumar')).toBeTruthy();
    unmount();
  });

  it('shows the loader (not "Repair not found") while the GET is still in flight', async () => {
    mockLists.repairs = [];
    mockRepairGet.isLoading = true;
    const { unmount } = await renderDetail();
    expect(screen.queryByText('Repair not found')).toBeNull();
    expect(screen.queryByText('Asha Kumar')).toBeNull();
    unmount();
  });

  it('shows "Repair not found" only once the GET has actually failed', async () => {
    mockLists.repairs = [];
    mockRepairGet.error = new Error('HTTP 404');
    const { unmount } = await renderDetail();
    expect(screen.getByText('Repair not found')).toBeTruthy();
    unmount();
  });
});

describe('GET-backed detail stays correct across mutations and route changes', () => {
  it('a status change on a repair missing from the list does not resend partsCharge and upserts the row', async () => {
    // Ledger-managed parts: the server rejects an unchanged partsCharge resend.
    mockLists.repairs = [];
    mockRepairGet.data = { repair: { ...baseRepair, partsCharge: 450 } };
    mockRepairsUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      if ('partsCharge' in patch) throw new Error('partsCharge is ledger-derived');
      return { repair: { ...baseRepair, partsCharge: 450, ...patch, id } };
    });
    const { unmount } = await renderDetail();

    await press('Continue as Testing');

    await waitFor(() => expect(screen.getByText('repair:r1:testing:Old diagnosis')).toBeTruthy());
    expect(mockRepairsUpdate).toHaveBeenCalledWith('r1', expect.not.objectContaining({ partsCharge: expect.anything() }));
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('never shows a previously opened repair after navigating to an id that fails to load', async () => {
    mockLists.repairs = [];
    mockRepairGet.data = { repair: { ...baseRepair } };
    const { unmount, rerender } = await renderDetail();
    expect(screen.getByText('Asha Kumar')).toBeTruthy();

    mockRoute.id = 'r2';
    mockRepairGet.data = undefined;
    mockRepairGet.error = new Error('HTTP 404');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <DataProvider>
            <RepairsProbe />
            <RepairDetailScreen />
          </DataProvider>
        </AuthProvider>
      </QueryClientProvider>,
    );
    await act(async () => {});
    await waitFor(() => expect(screen.getByText('Repair not found')).toBeTruthy());
    expect(screen.queryByText('Asha Kumar')).toBeNull();
    unmount();
  });
});
