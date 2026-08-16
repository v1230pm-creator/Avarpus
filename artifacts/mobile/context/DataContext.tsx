import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  customersList, customersCreate, customersUpdate,
  repairsList, repairsCreate, repairsUpdate, repairsDelete,
  inventoryList, inventoryCreate, inventoryUpdate,
  purchasesList, purchasesCreate, purchasesUpdate,
  financeList, financeCreate, financeUpdate,
  sampleDataLoad, sampleDataClear,
} from '@workspace/api-client-react';
import { Repair, Customer, InventoryItem, Purchase, FinanceEntry, isDealerPortalRole } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { toFriendlyError } from '@/utils/friendlyError';

// Business data now lives server-side, scoped to the signed-in user's shop.
// This context loads it from the API and keeps mutations in sync — nothing
// is persisted on the device anymore.

/** Input for creating a customer — derived stats are computed server-side. */
export type NewCustomer = Pick<Customer, 'name' | 'mobile'> & Partial<Pick<Customer, 'email' | 'address'>>;

interface DataContextType {
  repairs: Repair[];
  customers: Customer[];
  inventory: InventoryItem[];
  purchases: Purchase[];
  finance: FinanceEntry[];
  /** True while the initial load for the current session is in flight. */
  isLoading: boolean;
  /** Set when the last load failed (e.g. server unreachable). */
  loadError: string | null;
  loadAll: () => Promise<void>;
  addRepair: (r: Repair) => Promise<Repair>;
  updateRepair: (r: Repair) => Promise<void>;
  /** Permanently delete a repair — dealer/owner only (server-enforced). */
  deleteRepair: (id: string) => Promise<void>;
  addCustomer: (c: NewCustomer) => Promise<Customer>;
  updateCustomer: (c: Customer) => Promise<void>;
  addInventoryItem: (i: InventoryItem) => Promise<void>;
  updateInventoryItem: (i: InventoryItem) => Promise<void>;
  addPurchase: (p: Purchase) => Promise<void>;
  updatePurchase: (p: Purchase) => Promise<void>;
  addFinanceEntry: (f: FinanceEntry) => Promise<void>;
  updateFinanceEntry: (f: FinanceEntry) => Promise<void>;
  /** True when any loaded record is flagged as sample data. */
  hasSampleData: boolean;
  /** Seed labelled demo data into this shop, then reload everything. */
  loadSampleData: () => Promise<void>;
  /** Remove every sample-flagged record from this shop, then reload. */
  clearSampleData: () => Promise<void>;
}

const DataContext = createContext<DataContextType>({
  repairs: [], customers: [], inventory: [], purchases: [], finance: [],
  isLoading: false,
  loadError: null,
  loadAll: async () => {},
  addRepair: async (r) => r,
  updateRepair: async () => {},
  deleteRepair: async () => {},
  addCustomer: async (c) => c as Customer,
  updateCustomer: async () => {},
  addInventoryItem: async () => {},
  updateInventoryItem: async () => {},
  addPurchase: async () => {},
  updatePurchase: async () => {},
  addFinanceEntry: async () => {},
  updateFinanceEntry: async () => {},
  hasSampleData: false,
  loadSampleData: async () => {},
  clearSampleData: async () => {},
});

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  // Dealer-portal accounts are read-only and only allowed to fetch their own
  // repairs — bulk shop data (customers/inventory/purchases/finance) would
  // just 403 server-side, so skip loading it entirely.
  const isPortal = isDealerPortalRole(user?.role);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [finance, setFinance] = useState<FinanceEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (isPortal) {
      // Portal accounts: only their own repairs (server-scoped).
      setIsLoading(true);
      setLoadError(null);
      try {
        const r = await repairsList();
        setRepairs(r.repairs as Repair[]);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Could not load repairs');
      } finally {
        setIsLoading(false);
      }
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const [r, c, i, p, f] = await Promise.all([
        repairsList(),
        customersList(),
        inventoryList(),
        purchasesList(),
        financeList(),
      ]);
      setRepairs(r.repairs as Repair[]);
      setCustomers(c.customers as Customer[]);
      setInventory(i.items as InventoryItem[]);
      setPurchases(p.purchases as Purchase[]);
      setFinance(f.entries as FinanceEntry[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load shop data');
    } finally {
      setIsLoading(false);
    }
  }, [isPortal]);

  useEffect(() => {
    if (isAuthenticated) {
      loadAll();
    } else {
      // Clear any previous shop's data on sign-out.
      setRepairs([]);
      setCustomers([]);
      setInventory([]);
      setPurchases([]);
      setFinance([]);
      setLoadError(null);
    }
  }, [isAuthenticated, loadAll]);

  // Best-effort refresh of the customers list (used after repair mutations,
  // which change customers' server-derived dueAmount/totalRepairs).
  const refreshCustomers = useCallback(() => {
    customersList()
      .then((c) => setCustomers(c.customers as Customer[]))
      .catch(() => {}); // non-fatal: stats refresh on next full load
  }, []);

  // Wrap a mutation so failures surface a short, user-friendly Error message
  // (network vs server vs validation) that screens can show directly in an
  // alert. The original error is preserved on `cause`.
  const guarded = async <T,>(action: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw toFriendlyError(err, action);
    }
  };

  // The server assigns ids (and ticket numbers) — client-provided ids in the
  // input objects are ignored and replaced by the created entity.
  const addRepair = async (r: Repair): Promise<Repair> => guarded('save the repair', async () => {
    const res = await repairsCreate({
      clientRequestId: (r as any).clientRequestId,
      customerId: r.customerId || undefined,
      customerName: r.customerName,
      mobile: r.mobile,
      deviceType: r.deviceType,
      brand: r.brand,
      model: r.model,
      imei: r.imei,
      imei2: r.imei2,
      serialNumber: r.serialNumber,
      color: r.color,
      storage: r.storage,
      ram: r.ram,
      devicePassword: r.devicePassword,
      simPresent: r.simPresent,
      memoryCardPresent: r.memoryCardPresent,
      alternateMobile: r.alternateMobile,
      accessories: r.accessories,
      accessoriesList: r.accessoriesList,
      physicalCondition: r.physicalCondition,
      deviceCondition: r.deviceCondition,
      problem: r.problem,
      dealerId: r.dealerId,
      status: r.status,
      priority: r.priority,
      repairCharge: r.repairCharge,
      partsCharge: r.partsCharge,
      receiveDate: r.receiveDate,
      expectedDate: r.expectedDate,
      deliveryDate: r.deliveryDate,
      notes: r.notes,
      checklist: r.checklist,
      warrantyDays: r.warrantyDays,
      receivingSignaturePath: r.receivingSignaturePath,
      deliverySignaturePath: r.deliverySignaturePath,
    });
    const created = res.repair as Repair;
    setRepairs((prev) => [...prev, created]);
    // The server derives customer dueAmount/totalRepairs from repairs —
    // refresh customers so those stats stay in sync on screen.
    refreshCustomers();
    return created;
  });

  const updateRepair = async (r: Repair) => guarded('update the repair', async () => {
    // partsCharge is server-derived once parts are tracked in the ledger —
    // only send it when it actually changed, or the server rejects the patch.
    const current = repairs.find((x) => x.id === r.id);
    const res = await repairsUpdate(r.id, {
      customerName: r.customerName,
      mobile: r.mobile,
      deviceType: r.deviceType,
      brand: r.brand,
      model: r.model,
      imei: r.imei,
      imei2: r.imei2,
      serialNumber: r.serialNumber,
      color: r.color,
      storage: r.storage,
      ram: r.ram,
      devicePassword: r.devicePassword,
      simPresent: r.simPresent,
      memoryCardPresent: r.memoryCardPresent,
      alternateMobile: r.alternateMobile,
      accessories: r.accessories,
      accessoriesList: r.accessoriesList,
      physicalCondition: r.physicalCondition,
      deviceCondition: r.deviceCondition,
      paymentMethod: r.paymentMethod,
      problem: r.problem,
      diagnosis: r.diagnosis,
      workPerformed: r.workPerformed,
      status: r.status,
      priority: r.priority,
      repairCharge: r.repairCharge,
      serviceCharge: r.serviceCharge,
      otherCharge: r.otherCharge,
      discount: r.discount,
      taxPercent: r.taxPercent,
      ...(current && current.partsCharge === r.partsCharge ? {} : { partsCharge: r.partsCharge }),
      receiveDate: r.receiveDate,
      expectedDate: r.expectedDate,
      deliveryDate: r.deliveryDate,
      notes: r.notes,
      checklist: r.checklist,
      warrantyDays: r.warrantyDays,
      receivingSignaturePath: r.receivingSignaturePath,
      deliverySignaturePath: r.deliverySignaturePath,
    });
    const updated = res.repair as Repair;
    setRepairs((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    refreshCustomers();
  });

  const deleteRepair = async (id: string) => guarded('delete the repair', async () => {
    await repairsDelete(id);
    setRepairs((prev) => prev.filter((x) => x.id !== id));
    // Customer dueAmount/totalRepairs are derived from repairs server-side.
    refreshCustomers();
  });

  // dueAmount / totalRepairs are derived server-side from repairs — the
  // client never sends them.
  const addCustomer = async (c: NewCustomer): Promise<Customer> => guarded('save the customer', async () => {
    const res = await customersCreate({
      name: c.name,
      mobile: c.mobile,
      alternateMobile: (c as any).alternateMobile,
      email: c.email,
      address: c.address,
    } as any);
    const created = res.customer as Customer;
    setCustomers((prev) => [...prev, created]);
    return created;
  });

  const updateCustomer = async (c: Customer) => guarded('update the customer', async () => {
    const res = await customersUpdate(c.id, {
      name: c.name,
      mobile: c.mobile,
      alternateMobile: (c as any).alternateMobile,
      email: c.email,
      address: c.address,
    } as any);
    const updated = res.customer as Customer;
    setCustomers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  });

  const addInventoryItem = async (i: InventoryItem) => guarded('save the inventory item', async () => {
    const res = await inventoryCreate({
      name: i.name,
      category: i.category,
      brand: i.brand,
      quantity: i.quantity,
      minStock: i.minStock,
      purchasePrice: i.purchasePrice,
      sellingPrice: i.sellingPrice,
      supplier: i.supplier,
    });
    const created = res.item as InventoryItem;
    setInventory((prev) => [...prev, created]);
  });

  const updateInventoryItem = async (i: InventoryItem) => guarded('update the inventory item', async () => {
    const res = await inventoryUpdate(i.id, {
      name: i.name,
      category: i.category,
      brand: i.brand,
      quantity: i.quantity,
      minStock: i.minStock,
      purchasePrice: i.purchasePrice,
      sellingPrice: i.sellingPrice,
      supplier: i.supplier,
    });
    const updated = res.item as InventoryItem;
    setInventory((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  });

  const addPurchase = async (p: Purchase) => guarded('save the purchase', async () => {
    const res = await purchasesCreate({
      invoiceNo: p.invoiceNo,
      supplier: p.supplier,
      supplierMobile: p.supplierMobile,
      itemName: p.itemName,
      quantity: p.quantity,
      purchasePrice: p.purchasePrice,
      total: p.total,
      paymentStatus: p.paymentStatus,
      paymentMethod: p.paymentMethod,
      date: p.date,
    });
    const created = res.purchase as Purchase;
    setPurchases((prev) => [...prev, created]);
  });

  const updatePurchase = async (p: Purchase) => guarded('update the purchase', async () => {
    const res = await purchasesUpdate(p.id, {
      invoiceNo: p.invoiceNo,
      supplier: p.supplier,
      supplierMobile: p.supplierMobile,
      itemName: p.itemName,
      quantity: p.quantity,
      purchasePrice: p.purchasePrice,
      total: p.total,
      paymentStatus: p.paymentStatus,
      paymentMethod: p.paymentMethod,
      date: p.date,
    });
    const updated = res.purchase as Purchase;
    setPurchases((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  });

  const addFinanceEntry = async (f: FinanceEntry) => guarded('save the entry', async () => {
    const res = await financeCreate({
      type: f.type,
      category: f.category,
      amount: f.amount,
      description: f.description,
      paymentMethod: f.paymentMethod,
      date: f.date,
    });
    const created = res.entry as FinanceEntry;
    setFinance((prev) => [...prev, created]);
  });

  const updateFinanceEntry = async (f: FinanceEntry) => guarded('update the entry', async () => {
    const res = await financeUpdate(f.id, {
      type: f.type,
      category: f.category,
      amount: f.amount,
      description: f.description,
      paymentMethod: f.paymentMethod,
      date: f.date,
    });
    const updated = res.entry as FinanceEntry;
    setFinance((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  });

  const hasSampleData =
    repairs.some((r) => r.isSample) ||
    customers.some((c) => c.isSample) ||
    inventory.some((i) => i.isSample) ||
    purchases.some((p) => p.isSample) ||
    finance.some((f) => f.isSample);

  const loadSampleData = async () => {
    await sampleDataLoad();
    await loadAll();
  };

  const clearSampleData = async () => {
    await sampleDataClear();
    await loadAll();
  };

  return (
    <DataContext.Provider value={{
      repairs, customers, inventory, purchases, finance,
      isLoading, loadError,
      loadAll, addRepair, updateRepair, deleteRepair, addCustomer, updateCustomer,
      addInventoryItem, updateInventoryItem, addPurchase, updatePurchase,
      addFinanceEntry, updateFinanceEntry,
      hasSampleData, loadSampleData, clearSampleData,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
