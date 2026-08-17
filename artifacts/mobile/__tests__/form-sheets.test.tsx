/**
 * Guards the add/edit form sheets (customer / inventory / purchase / finance)
 * against regressions that would lose a staff member's entry:
 *  - required-field validation blocks submit (no API call fired)
 *  - a failed save shows the alert AND keeps every entered value for retry
 *  - a successful save adds the record to the shop's list
 *
 * The mock boundary is the API client (network layer) — the real AuthContext,
 * the real DataContext (with its friendly-error wrapping), and the real form
 * components render in the test.
 */
import React from 'react';
import { Alert, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// ── Mocks (network + native boundaries only) ─────────────────────────────
const mockCustomersCreate = jest.fn();
const mockCustomersUpdate = jest.fn();
const mockInventoryCreate = jest.fn();
const mockInventoryUpdate = jest.fn();
const mockPurchasesCreate = jest.fn();
const mockPurchasesUpdate = jest.fn();
const mockFinanceCreate = jest.fn();
const mockFinanceUpdate = jest.fn();
const mockApprovalsCreate = jest.fn();

// Seed data returned by the list endpoints — edit-mode tests preload the
// record being edited so the probe can show the list update. Reset each test.
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
    repairsCreate: jest.fn(),
    repairsUpdate: jest.fn(),
    customersCreate: (...a: unknown[]) => mockCustomersCreate(...a),
    customersUpdate: (...a: unknown[]) => mockCustomersUpdate(...a),
    inventoryCreate: (...a: unknown[]) => mockInventoryCreate(...a),
    inventoryUpdate: (...a: unknown[]) => mockInventoryUpdate(...a),
    purchasesCreate: (...a: unknown[]) => mockPurchasesCreate(...a),
    purchasesUpdate: (...a: unknown[]) => mockPurchasesUpdate(...a),
    financeCreate: (...a: unknown[]) => mockFinanceCreate(...a),
    financeUpdate: (...a: unknown[]) => mockFinanceUpdate(...a),
    approvalsCreate: (...a: unknown[]) => mockApprovalsCreate(...a),
    sampleDataLoad: jest.fn(),
    sampleDataClear: jest.fn(),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Error: 'error', Success: 'success' },
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light' },
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/context/AuthContext';
import { DataProvider, useData } from '@/context/DataContext';
import { CustomerFormSheet } from '@/components/forms/CustomerFormSheet';
import { InventoryFormSheet } from '@/components/forms/InventoryFormSheet';
import { PurchaseFormSheet } from '@/components/forms/PurchaseFormSheet';
import { FinanceFormSheet } from '@/components/forms/FinanceFormSheet';

/** Shows the current lists so tests can assert records appear/update. */
function ListsProbe() {
  const { customers, inventory, purchases, finance } = useData();
  return (
    <>
      {customers.map((c) => (
        <Text key={c.id}>{`customer:${c.name}`}</Text>
      ))}
      {inventory.map((i) => (
        <Text key={i.id}>{`item:${i.name}:${i.quantity}`}</Text>
      ))}
      {purchases.map((p) => (
        <Text key={p.id}>{`purchase:${p.invoiceNo}:${p.supplier}`}</Text>
      ))}
      {finance.map((f) => (
        <Text key={f.id}>{`finance:${f.category}:${f.amount}`}</Text>
      ))}
    </>
  );
}

async function renderWithProviders(ui: React.ReactElement) {
  const utils = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <DataProvider>
          <ListsProbe />
          {ui}
        </DataProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  // Let the auth restore (storage + authMe) and initial data load settle.
  await act(async () => {});
  await act(async () => {});
  return utils;
}

// The sheet title and the submit button often share the same text
// (e.g. "Add Customer") — the footer button is the last match.
const press = async (label: string) =>
  act(async () => {
    const matches = screen.getAllByText(label);
    fireEvent.press(matches[matches.length - 1]);
  });

const type = (label: string, value: string) =>
  fireEvent.changeText(screen.getByPlaceholderText(label), value);

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockLists)) mockLists[key] = [];
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

// Records used by edit-mode tests (preloaded into the mocked list endpoints).
const existingCustomer = { id: 'c9', name: 'Old Name', mobile: '9000000000', email: '', address: '', dueAmount: 0, totalRepairs: 0 } as any;
const existingItem = { id: 'i9', name: 'Old Screen', category: 'spare_part', brand: 'Samsung', quantity: 5, minStock: 2, purchasePrice: 700, sellingPrice: 1200, supplier: '', createdAt: '' } as any;
const existingPurchase = { id: 'p9', purchaseId: 'P-9', invoiceNo: 'INV-9', supplier: 'Old Supplier', supplierMobile: '', itemName: 'Cables', quantity: 4, purchasePrice: 50, total: 200, paymentStatus: 'paid', paymentMethod: 'Cash', date: '2026-08-01', createdAt: '' } as any;
const existingEntry = { id: 'f9', type: 'expense', category: 'Rent', amount: 8000, description: '', paymentMethod: 'Cash', date: '2026-08-01', createdAt: '' } as any;

afterEach(() => {
  alertSpy.mockRestore();
});

// ── Required-field validation blocks submit ──────────────────────────────
describe('required-field validation blocks submit', () => {
  it('customer form: empty submit shows field errors and fires no API call', async () => {
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <CustomerFormSheet visible onClose={onClose} />,
    );
    await press('Add Customer');
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(screen.getByText('Enter a valid 10-digit mobile number')).toBeTruthy();
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it('customer form: rejects an invalid email without calling the API', async () => {
    const { unmount } = await renderWithProviders(
      <CustomerFormSheet visible onClose={jest.fn()} />,
    );
    type('Customer name', 'Asha');
    type('10-digit mobile', '9876543210');
    // Three fields share the "Optional" placeholder — alt mobile, email, address.
    fireEvent.changeText(screen.getAllByPlaceholderText('Optional')[1], 'not-an-email');
    await press('Add Customer');
    expect(screen.getByText('Enter a valid email')).toBeTruthy();
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    unmount();
  });

  it('inventory form: empty submit shows field errors and fires no API call', async () => {
    const { unmount } = await renderWithProviders(
      <InventoryFormSheet visible onClose={jest.fn()} />,
    );
    await press('Add Item');
    expect(screen.getByText('Item name is required')).toBeTruthy();
    expect(screen.getByText('Brand is required')).toBeTruthy();
    expect(screen.getByText('Enter a quantity of 0 or more')).toBeTruthy();
    expect(mockInventoryCreate).not.toHaveBeenCalled();
    unmount();
  });

  it('purchase form: empty submit shows field errors and fires no API call', async () => {
    const { unmount } = await renderWithProviders(
      <PurchaseFormSheet visible onClose={jest.fn()} />,
    );
    await press('Add Purchase');
    expect(screen.getByText('Invoice number is required')).toBeTruthy();
    expect(screen.getByText('Supplier is required')).toBeTruthy();
    expect(screen.getByText('Item name is required')).toBeTruthy();
    expect(mockPurchasesCreate).not.toHaveBeenCalled();
    expect(mockApprovalsCreate).not.toHaveBeenCalled();
    unmount();
  });

  it('finance form: empty submit shows field errors and fires no API call', async () => {
    const { unmount } = await renderWithProviders(
      <FinanceFormSheet visible onClose={jest.fn()} />,
    );
    await press('Add Entry');
    expect(screen.getByText('Category is required')).toBeTruthy();
    expect(screen.getByText('Enter an amount greater than 0')).toBeTruthy();
    expect(mockFinanceCreate).not.toHaveBeenCalled();
    unmount();
  });
});

// ── Failed save shows the alert and keeps entered values ─────────────────
describe('failed save shows the alert and keeps entered values', () => {
  it('customer form: server error alerts and every typed value survives for retry', async () => {
    mockCustomersCreate.mockRejectedValue(new TypeError('Network request failed'));
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <CustomerFormSheet visible onClose={onClose} />,
    );
    type('Customer name', 'Asha Kumar');
    type('10-digit mobile', '9876543210');
    await press('Add Customer');

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(
      'Save failed',
      expect.stringContaining('Your entries are still here'),
    );
    // The sheet stayed open with everything the user typed.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Asha Kumar')).toBeTruthy();
    expect(screen.getByDisplayValue('9876543210')).toBeTruthy();
    // Nothing was added to the list.
    expect(screen.queryByText(/^customer:/)).toBeNull();
    unmount();
  });

  it('purchase form: failed save alerts and every typed value survives for retry', async () => {
    mockPurchasesCreate.mockRejectedValue(new Error('boom'));
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <PurchaseFormSheet visible onClose={onClose} />,
    );
    type('e.g. INV-1024', 'INV-42');
    type('Supplier name', 'Acme Parts');
    type('What was purchased', 'Charging Ports');
    const zeros = screen.getAllByPlaceholderText('0'); // quantity, unit price
    fireEvent.changeText(zeros[0], '10');
    fireEvent.changeText(zeros[1], '150');
    await press('Add Purchase');

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Save failed', expect.any(String)),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('INV-42')).toBeTruthy();
    expect(screen.getByDisplayValue('Acme Parts')).toBeTruthy();
    expect(screen.getByDisplayValue('Charging Ports')).toBeTruthy();
    expect(screen.getByDisplayValue('10')).toBeTruthy();
    expect(screen.getByDisplayValue('150')).toBeTruthy();
    expect(screen.queryByText(/^purchase:/)).toBeNull();
    unmount();
  });

  it('finance form: failed save alerts and every typed value survives for retry', async () => {
    mockFinanceCreate.mockRejectedValue(new TypeError('Network request failed'));
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <FinanceFormSheet visible onClose={onClose} />,
    );
    type('e.g. Repair Charges, Utilities', 'Utilities');
    type('0', '1200');
    type('Optional note', 'Electricity bill');
    await press('Add Entry');

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Save failed',
        expect.stringContaining('Your entries are still here'),
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Utilities')).toBeTruthy();
    expect(screen.getByDisplayValue('1200')).toBeTruthy();
    expect(screen.getByDisplayValue('Electricity bill')).toBeTruthy();
    expect(screen.queryByText(/^finance:/)).toBeNull();
    unmount();
  });

  it('inventory form: failed save alerts and keeps all numeric fields', async () => {
    mockInventoryCreate.mockRejectedValue(new Error('boom'));
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <InventoryFormSheet visible onClose={onClose} />,
    );
    type('e.g. iPhone 12 Battery', 'Battery XR');
    type('e.g. Apple', 'Apple');
    const zeros = screen.getAllByPlaceholderText('0'); // qty, minStock, purchase, selling
    fireEvent.changeText(zeros[0], '12');
    fireEvent.changeText(zeros[1], '3');
    fireEvent.changeText(zeros[2], '900');
    fireEvent.changeText(zeros[3], '1500');
    await press('Add Item');

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Save failed', expect.any(String)),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Battery XR')).toBeTruthy();
    expect(screen.getByDisplayValue('12')).toBeTruthy();
    expect(screen.getByDisplayValue('3')).toBeTruthy();
    expect(screen.getByDisplayValue('900')).toBeTruthy();
    expect(screen.getByDisplayValue('1500')).toBeTruthy();
    unmount();
  });
});

// ── Successful save adds the record to the list ──────────────────────────
describe('successful save adds the record to the list', () => {
  it('customer form: created customer appears in the list and the sheet closes', async () => {
    mockCustomersCreate.mockResolvedValue({
      customer: { id: 'c1', name: 'Asha Kumar', mobile: '9876543210', dueAmount: 0, totalRepairs: 0 },
    });
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <CustomerFormSheet visible onClose={onClose} />,
    );
    type('Customer name', 'Asha Kumar');
    type('10-digit mobile', '9876543210');
    await press('Add Customer');

    await waitFor(() => expect(screen.getByText('customer:Asha Kumar')).toBeTruthy());
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      name: 'Asha Kumar',
      mobile: '9876543210',
      email: undefined,
      address: undefined,
    });
    expect(onClose).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('inventory form: created item appears in the list and the sheet closes', async () => {
    mockInventoryCreate.mockResolvedValue({
      item: { id: 'i1', name: 'Battery XR', category: 'spare_part', brand: 'Apple', quantity: 12, minStock: 3, purchasePrice: 900, sellingPrice: 1500, createdAt: '' },
    });
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <InventoryFormSheet visible onClose={onClose} />,
    );
    type('e.g. iPhone 12 Battery', 'Battery XR');
    type('e.g. Apple', 'Apple');
    const zeros = screen.getAllByPlaceholderText('0');
    fireEvent.changeText(zeros[0], '12');
    fireEvent.changeText(zeros[1], '3');
    fireEvent.changeText(zeros[2], '900');
    fireEvent.changeText(zeros[3], '1500');
    await press('Add Item');

    await waitFor(() => expect(screen.getByText('item:Battery XR:12')).toBeTruthy());
    expect(mockInventoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Battery XR', brand: 'Apple', quantity: 12, minStock: 3, purchasePrice: 900, sellingPrice: 1500 }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('purchase form: created purchase appears in the list and the sheet closes', async () => {
    mockPurchasesCreate.mockResolvedValue({
      purchase: { id: 'p1', purchaseId: 'P-1', invoiceNo: 'INV-42', supplier: 'Acme Parts', itemName: 'Charging Ports', quantity: 10, purchasePrice: 150, total: 1500, paymentStatus: 'unpaid', paymentMethod: 'Cash', date: '2026-08-08', createdAt: '' },
    });
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <PurchaseFormSheet visible onClose={onClose} />,
    );
    type('e.g. INV-1024', 'INV-42');
    type('Supplier name', 'Acme Parts');
    type('What was purchased', 'Charging Ports');
    const zeros = screen.getAllByPlaceholderText('0');
    fireEvent.changeText(zeros[0], '10');
    fireEvent.changeText(zeros[1], '150');
    await press('Add Purchase');

    await waitFor(() => expect(screen.getByText('purchase:INV-42:Acme Parts')).toBeTruthy());
    expect(mockPurchasesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceNo: 'INV-42', supplier: 'Acme Parts', itemName: 'Charging Ports', quantity: 10, purchasePrice: 150, total: 1500 }),
    );
    expect(mockApprovalsCreate).not.toHaveBeenCalled(); // dealer saves directly
    expect(onClose).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('finance form: created entry appears in the list and the sheet closes', async () => {
    mockFinanceCreate.mockResolvedValue({
      entry: { id: 'f1', type: 'income', category: 'Repair Charges', amount: 500, description: '', paymentMethod: 'Cash', date: '2026-01-01' },
    });
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <FinanceFormSheet visible onClose={onClose} />,
    );
    type('e.g. Repair Charges, Utilities', 'Repair Charges');
    type('0', '500');
    await press('Add Entry');

    await waitFor(() => expect(screen.getByText('finance:Repair Charges:500')).toBeTruthy());
    expect(mockFinanceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'income', category: 'Repair Charges', amount: 500 }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });
});

// ── Edit mode: failed edits keep values, successful edits update the list ─
describe('edit mode', () => {
  it('customer edit: failed update alerts, keeps the edited values, list unchanged', async () => {
    mockLists.customers = [existingCustomer];
    mockCustomersUpdate.mockRejectedValue(new Error('boom'));
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <CustomerFormSheet visible onClose={onClose} customer={existingCustomer} />,
    );
    // Pre-seeded with the record, then the user edits the name.
    fireEvent.changeText(screen.getByDisplayValue('Old Name'), 'New Name');
    await press('Save Changes');

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Update failed', expect.any(String)),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('New Name')).toBeTruthy(); // edit survives for retry
    expect(screen.getByText('customer:Old Name')).toBeTruthy(); // list untouched
    unmount();
  });

  it('customer edit: successful update replaces the record in the list', async () => {
    mockLists.customers = [existingCustomer];
    mockCustomersUpdate.mockResolvedValue({ customer: { ...existingCustomer, name: 'New Name' } });
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <CustomerFormSheet visible onClose={onClose} customer={existingCustomer} />,
    );
    fireEvent.changeText(screen.getByDisplayValue('Old Name'), 'New Name');
    await press('Save Changes');

    await waitFor(() => expect(screen.getByText('customer:New Name')).toBeTruthy());
    expect(screen.queryByText('customer:Old Name')).toBeNull();
    expect(mockCustomersUpdate).toHaveBeenCalledWith('c9', expect.objectContaining({ name: 'New Name', mobile: '9000000000' }));
    expect(onClose).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('inventory edit: failed update keeps values; successful update changes the list', async () => {
    mockLists.items = [existingItem];
    mockInventoryUpdate.mockRejectedValueOnce(new Error('boom'));
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <InventoryFormSheet visible onClose={onClose} item={existingItem} />,
    );
    fireEvent.changeText(screen.getByDisplayValue('5'), '8'); // quantity
    await press('Save Changes');
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Update failed', expect.any(String)),
    );
    expect(screen.getByDisplayValue('8')).toBeTruthy();
    expect(screen.getByText('item:Old Screen:5')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    // Retry succeeds with the retained values.
    mockInventoryUpdate.mockResolvedValueOnce({ item: { ...existingItem, quantity: 8 } });
    await press('Save Changes');
    await waitFor(() => expect(screen.getByText('item:Old Screen:8')).toBeTruthy());
    expect(mockInventoryUpdate).toHaveBeenLastCalledWith('i9', expect.objectContaining({ quantity: 8 }));
    expect(onClose).toHaveBeenCalled();
    unmount();
  });

  it('purchase edit: failed update keeps values; successful update changes the list', async () => {
    mockLists.purchases = [existingPurchase];
    mockPurchasesUpdate.mockRejectedValueOnce(new Error('boom'));
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <PurchaseFormSheet visible onClose={onClose} purchase={existingPurchase} />,
    );
    fireEvent.changeText(screen.getByDisplayValue('Old Supplier'), 'New Supplier');
    await press('Save Changes');
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Update failed', expect.any(String)),
    );
    expect(screen.getByDisplayValue('New Supplier')).toBeTruthy();
    expect(screen.getByText('purchase:INV-9:Old Supplier')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    mockPurchasesUpdate.mockResolvedValueOnce({ purchase: { ...existingPurchase, supplier: 'New Supplier' } });
    await press('Save Changes');
    await waitFor(() => expect(screen.getByText('purchase:INV-9:New Supplier')).toBeTruthy());
    expect(mockPurchasesUpdate).toHaveBeenLastCalledWith('p9', expect.objectContaining({ supplier: 'New Supplier' }));
    expect(mockApprovalsCreate).not.toHaveBeenCalled(); // dealer edits directly
    expect(onClose).toHaveBeenCalled();
    unmount();
  });

  it('finance edit: failed update keeps values; successful update changes the list', async () => {
    mockLists.entries = [existingEntry];
    mockFinanceUpdate.mockRejectedValueOnce(new Error('boom'));
    const onClose = jest.fn();
    const { unmount } = await renderWithProviders(
      <FinanceFormSheet visible onClose={onClose} entry={existingEntry} />,
    );
    fireEvent.changeText(screen.getByDisplayValue('8000'), '9000');
    await press('Save Changes');
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Update failed', expect.any(String)),
    );
    expect(screen.getByDisplayValue('9000')).toBeTruthy();
    expect(screen.getByText('finance:Rent:8000')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    mockFinanceUpdate.mockResolvedValueOnce({ entry: { ...existingEntry, amount: 9000 } });
    await press('Save Changes');
    await waitFor(() => expect(screen.getByText('finance:Rent:9000')).toBeTruthy());
    expect(mockFinanceUpdate).toHaveBeenLastCalledWith('f9', expect.objectContaining({ amount: 9000 }));
    expect(onClose).toHaveBeenCalled();
    unmount();
  });
});
