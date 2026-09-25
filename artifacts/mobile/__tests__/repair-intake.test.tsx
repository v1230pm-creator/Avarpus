/**
 * Guards the repair intake form (the app's longest, most important form)
 * against regressions that would lose a staff member's entire ticket entry:
 *  - required-field validation blocks the review step (no API call fired)
 *  - a failed save shows the alert AND keeps every entered value for retry
 *  - a successful save adds the repair to the shop's list
 *
 * The screen is a two-step flow: step 1 collects the details and "Review
 * Intake" validates them; step 2 shows a summary, requires the customer
 * confirmation checkbox, and "Complete Intake" performs the save.
 *
 * Mock boundary is the API client (network) plus native-only modules —
 * the real AuthContext, real DataContext, and the real intake screen render.
 * Pattern follows __tests__/form-sheets.test.tsx.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { formatDayLabel, formatMonthTitle } from '@/components/ui/CalendarDialog';
import { getNextWeekStr, getTodayStr } from '@/utils/helpers';

// ── Mocks (network + native boundaries only) ─────────────────────────────
const mockRepairsCreate = jest.fn();
const mockRepairsUpdate = jest.fn();
const mockCustomersCreate = jest.fn();
const mockApprovalsCreate = jest.fn();
const mockAuthUser = {
  id: 'u1',
  name: 'Owner',
  email: 'o@x.y',
  mobile: '9876543210',
  role: 'dealer' as string,
  isActive: true,
};

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
      user: mockAuthUser,
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
    getRepairsGetQueryKey: jest.fn((id: string) => ['/repairs/' + id]),
    customersCreate: (...a: unknown[]) => mockCustomersCreate(...a),
    customersUpdate: jest.fn(),
    inventoryCreate: jest.fn(),
    inventoryUpdate: jest.fn(),
    purchasesCreate: jest.fn(),
    purchasesUpdate: jest.fn(),
    financeCreate: jest.fn(),
    financeUpdate: jest.fn(),
    approvalsCreate: (...a: unknown[]) => mockApprovalsCreate(...a),
    useDealersList: jest.fn(() => ({ data: { dealers: [] }, isLoading: false })),
    useDealersDetect: jest.fn(() => ({ data: { dealers: [] }, isLoading: false })),
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
// Tests run "online" so saves hit the API mocks, not the offline queue.
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));
const mockOfflineQueueAdd = jest.fn(async (..._a: unknown[]) => {});
jest.mock('@/utils/offlineQueue', () => ({
  offlineQueue: {
    add: (...a: unknown[]) => mockOfflineQueueAdd(...a),
    flush: jest.fn(async () => ({ success: 0, failed: 0 })),
  },
}));
// The form's pop-ups render through the shared dialog (a gradient card); the
// gradient itself is native, so it becomes a plain View here.
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: ({ children, ...rest }: any) => <View {...rest}>{children}</View> };
});
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/context/AuthContext';
import { DataProvider, useData } from '@/context/DataContext';
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog';
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
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <DataProvider>
          <ConfirmDialogProvider>
            <RepairsProbe />
            <NewRepairScreen />
          </ConfirmDialogProvider>
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

const type = (placeholder: string, value: string) =>
  fireEvent.changeText(screen.getByPlaceholderText(placeholder), value);

const CONFIRM_LABEL = 'I have submitted the device and the above details are correct.';

/** The in-app notice card (never the platform alert) currently showing `title`, or null. */
const noticeTitled = (title: string) => (screen.queryByTestId('confirm-dialog') ? screen.queryByText(title) : null);
/** Closes the open notice through its lone OK, the way a user would. */
const dismissNotice = () => press('OK');

/** YYYY-MM-DD ± n days, on the same UTC calendar the helpers use. */
const shiftDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
};

/** Opens the Expected Delivery calendar and pages it to the month that holds `day`. */
const openCalendarOn = async (day: string) => {
  await act(async () => { fireEvent.press(screen.getByLabelText(/^Expected delivery date: /)); });
  expect(screen.getByText('Expected delivery')).toBeTruthy();
  const target = formatMonthTitle(day);
  // The grid opens on the month of the current value (a week ahead), so `day` is at most one month away.
  const direction = day < getNextWeekStr() ? 'Previous month' : 'Next month';
  for (let i = 0; i < 2 && !screen.queryByText(target); i += 1) {
    await act(async () => { fireEvent.press(screen.getByLabelText(direction)); });
  }
  expect(screen.getByText(target)).toBeTruthy();
};

afterEach(() => {
  mockAuthUser.role = 'dealer';
});

it('shows the manual dealer picker to shop staff but not dealer portal accounts', async () => {
  mockAuthUser.role = 'reception';
  const staffScreen = await renderIntake();
  expect(screen.getByText('Link Dealer')).toBeTruthy();
  await press('Link Dealer');
  expect(screen.getByText('Select Dealer')).toBeTruthy();
  expect(screen.getByText('Search dealers')).toBeTruthy();
  expect(screen.queryByText('Dealer (Optional)')).toBeNull();
  staffScreen.unmount();

  mockAuthUser.role = 'dealer_staff';
  await renderIntake();
  expect(screen.queryByText('Link Dealer')).toBeNull();
});

it('adds the alternative mobile field from the Mobile input', async () => {
  const { unmount } = await renderIntake();

  expect(screen.queryByPlaceholderText('10-digit alternative number')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Add alternate mobile'));
  });
  expect(screen.getByPlaceholderText('10-digit alternative number')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Remove alternate mobile'));
  });
  expect(screen.queryByPlaceholderText('10-digit alternative number')).toBeNull();
  unmount();
});

it('enters multiple identifiers inside the popup and preserves them after OK', async () => {
  const { unmount } = await renderIntake();

  expect(screen.queryByPlaceholderText('Serial Number')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Device identifier selector'));
  });
  type('Serial Number', 'SERIAL-123');
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Select IMEI 1'));
  });
  type('IMEI 1', '111111111111111');
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Select IMEI 2'));
  });
  type('IMEI 2', '222222222222222');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Save device identifiers'));
  });
  expect(screen.queryByPlaceholderText('Serial Number')).toBeNull();
  expect(screen.getByText('Serial, IMEI 1, IMEI 2')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Device identifier selector'));
  });
  expect(screen.getByDisplayValue('SERIAL-123')).toBeTruthy();
  expect(screen.getByDisplayValue('111111111111111')).toBeTruthy();
  expect(screen.getByDisplayValue('222222222222222')).toBeTruthy();
  unmount();
});

/** Fills every required intake field on step 1 (brand is a chip selector). */
const fillRequiredFields = async () => {
  type('Full name', 'Asha Kumar');
  type('Number', '9876543210');
  await press('Brand *');
  await press('Samsung');
  type('Model', 'Galaxy S23');
  type('Describe the issue...', 'Screen cracked, no display');
};

/** Step 1 → review summary → confirm checkbox → submit. */
const reviewConfirmAndSubmit = async () => {
  await press('RECEIVE');
  await press(CONFIRM_LABEL);
  await press('Complete Intake');
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockLists)) mockLists[key] = [];
});

// ── Required-field validation blocks the review step ─────────────────────
describe('required-field validation blocks submit', () => {
  it('empty review shows field errors and fires no API call', async () => {
    const { unmount } = await renderIntake();
    await press('RECEIVE');

    // brand / model / problem all flag "Required" (name too)
    expect(screen.getAllByText('Required').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('10-digit mobile required')).toBeTruthy();
    // The validation pop-up is the app's own dialog card, not Alert.alert.
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(screen.getByText('Missing details')).toBeTruthy();
    expect(screen.getByText('Please complete the fields highlighted in red before continuing.')).toBeTruthy();
    // Notices carry no CANCEL row; OK closes the card and the form is untouched.
    expect(screen.queryByTestId('confirm-cancel')).toBeNull();
    await dismissNotice();
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    // Still on step 1 — the confirm/submit step was never reached.
    expect(screen.queryByText('Complete Intake')).toBeNull();
    expect(mockRepairsCreate).not.toHaveBeenCalled();
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(mockApprovalsCreate).not.toHaveBeenCalled();
    unmount();
  });

  it('rejects a short mobile number without calling the API', async () => {
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    type('Number', '98765'); // too short
    await press('RECEIVE');

    expect(screen.getByText('10-digit mobile required')).toBeTruthy();
    expect(screen.queryByText('Complete Intake')).toBeNull();
    expect(mockRepairsCreate).not.toHaveBeenCalled();
    unmount();
  });

  it('does not offer expected-delivery days before the receive date', async () => {
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    // No typed date field any more: the calendar chip opens a month grid.
    expect(screen.queryByPlaceholderText('YYYY-MM-DD')).toBeNull();
    const yesterday = shiftDays(getTodayStr(), -1);
    await openCalendarOn(yesterday);

    const pastDay = screen.getByLabelText(formatDayLabel(yesterday));
    expect(pastDay.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(pastDay);
    // Still open (the press was ignored) and the default date is untouched.
    expect(screen.getByText('Expected delivery')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('Close')); });
    expect(screen.queryByText('Expected delivery')).toBeNull();

    await press('RECEIVE');
    expect(screen.getByText(getNextWeekStr())).toBeTruthy();
    unmount();
  });

  it('picking a day in the calendar closes it and carries the date to the summary', async () => {
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    const tomorrow = shiftDays(getTodayStr(), 1);
    await openCalendarOn(tomorrow);

    await act(async () => { fireEvent.press(screen.getByLabelText(formatDayLabel(tomorrow))); });
    expect(screen.queryByText('Expected delivery')).toBeNull();
    expect(screen.getByLabelText(`Expected delivery date: ${formatDayLabel(tomorrow)}`)).toBeTruthy();

    await press('RECEIVE');
    expect(screen.getByText(tomorrow)).toBeTruthy();
    expect(screen.queryByText(getNextWeekStr())).toBeNull();
    unmount();
  });

  it('the priority chip opens a chooser that closes on selection', async () => {
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    await act(async () => { fireEvent.press(screen.getByLabelText('Priority: Normal')); });
    expect(screen.getByText('Priority')).toBeTruthy();
    await press('Urgent');
    expect(screen.queryByText('Low')).toBeNull();
    expect(screen.getByLabelText('Priority: Urgent')).toBeTruthy();

    await press('RECEIVE');
    expect(screen.getByText('Urgent')).toBeTruthy();
    unmount();
  });
});

// ── Failed save shows the alert and keeps entered values ─────────────────
describe('failed save shows the alert and keeps entered values', () => {
  it('server error alerts and every entered value survives for retry', async () => {
    // Existing customer with this mobile → no customer create on this path.
    mockLists.customers = [
      { id: 'c1', name: 'Asha Kumar', mobile: '9876543210', email: '', address: '', dueAmount: 0, totalRepairs: 0 },
    ];
    mockRepairsCreate.mockRejectedValue(new Error('boom'));
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Physical'));
    });
    fireEvent.press(screen.getByText('Charger'));
    fireEvent.changeText(screen.getAllByPlaceholderText('0')[0], '2500'); // estimate (advance input also uses placeholder 0)
    await reviewConfirmAndSubmit();

    await waitFor(() => expect(noticeTitled('Save failed')).toBeTruthy());
    expect(screen.getByText(/save the repair/)).toBeTruthy();
    await dismissNotice();
    // The review summary stayed up with everything the user entered.
    expect(screen.getByText('Asha Kumar')).toBeTruthy();
    expect(screen.getByText('9876543210')).toBeTruthy();
    expect(screen.getByText('Smartphone - Samsung Galaxy S23')).toBeTruthy();
    expect(screen.getByText('Screen cracked, no display')).toBeTruthy();
    expect(screen.getByText('₹2500')).toBeTruthy();
    // No success screen, no navigation, nothing added to the list.
    expect(screen.queryByText('Job Card Created')).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockOfflineQueueAdd).not.toHaveBeenCalled();
    expect(screen.queryByText(/^repair:/)).toBeNull();
    unmount();
  });

  it('network drop mid-save queues the repair offline and shows Saved Offline', async () => {
    mockLists.customers = [
      { id: 'c1', name: 'Asha Kumar', mobile: '9876543210', email: '', address: '', dueAmount: 0, totalRepairs: 0 },
    ];
    // fetch rejects with a TypeError when the connection drops mid-request.
    // DataContext wraps it in a friendly Error, preserving it on `cause` —
    // the screen must still detect it and fall back to the offline queue.
    mockRepairsCreate.mockRejectedValue(new TypeError('Network request failed'));
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    await reviewConfirmAndSubmit();

    await waitFor(() => expect(noticeTitled('Saved offline')).toBeTruthy());
    expect(screen.getByText(/saved on this phone/)).toBeTruthy();
    expect(mockOfflineQueueAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: 'Asha Kumar',
        mobile: '9876543210',
        brand: 'Samsung',
        model: 'Galaxy S23',
        problem: 'Screen cracked, no display',
      }),
      expect.any(String),
    );
    // No failure notice and no success screen — the offline path won.
    expect(noticeTitled('Save failed')).toBeNull();
    expect(screen.queryByText('Job Card Created')).toBeNull();
    unmount();
  });

  it('failure while creating the new customer also alerts and keeps values', async () => {
    mockCustomersCreate.mockRejectedValue(new Error('boom'));
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    await reviewConfirmAndSubmit();

    await waitFor(() => expect(noticeTitled('Save failed')).toBeTruthy());
    await dismissNotice();
    expect(mockRepairsCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Asha Kumar')).toBeTruthy();
    expect(screen.getByText('Screen cracked, no display')).toBeTruthy();
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
    await reviewConfirmAndSubmit();
    await waitFor(() => expect(noticeTitled('Save failed')).toBeTruthy());
    await dismissNotice();

    mockRepairsCreate.mockResolvedValueOnce({
      repair: {
        id: 'r1', repairId: 'VMC-1001', customerId: 'c1', customerName: 'Asha Kumar', mobile: '9876543210',
        deviceType: 'Smartphone', brand: 'Samsung', model: 'Galaxy S23', problem: 'Screen cracked, no display',
        status: 'received', priority: 'normal', repairCharge: 0, partsCharge: 0, advance: 0,
        receiveDate: '2026-08-08', expectedDate: '2026-08-15', warrantyDays: 0, checklist: {}, createdAt: '',
      },
    });
    // Still on the review step with the confirmation intact — just retry.
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
        status: 'received', priority: 'normal', repairCharge: 2500, partsCharge: 0, advance: 0,
        receiveDate: '2026-08-08', expectedDate: '2026-08-15', warrantyDays: 0, checklist: {}, createdAt: '',
      },
    });
    const { unmount } = await renderIntake();
    await fillRequiredFields();
    fireEvent.changeText(screen.getAllByPlaceholderText('0')[0], '2500'); // estimate (advance input also uses placeholder 0)
    await reviewConfirmAndSubmit();

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
      }),
    );
    expect(mockApprovalsCreate).not.toHaveBeenCalled(); // dealer saves directly
    // Only the validation-free happy path — no notice card was shown.
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    unmount();
  });
});
