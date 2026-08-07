import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  customersList, customersCreate, customersUpdate,
  repairsList, repairsCreate, repairsUpdate,
  inventoryList, inventoryCreate, inventoryUpdate,
  purchasesList, purchasesCreate,
  financeList, financeCreate,
} from '@workspace/api-client-react';
import { Repair, Customer, InventoryItem, Purchase, FinanceEntry } from '@/types';
import { useAuth } from '@/context/AuthContext';

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
  addCustomer: (c: NewCustomer) => Promise<Customer>;
  updateCustomer: (c: Customer) => Promise<void>;
  addInventoryItem: (i: InventoryItem) => Promise<void>;
  updateInventoryItem: (i: InventoryItem) => Promise<void>;
  addPurchase: (p: Purchase) => Promise<void>;
  addFinanceEntry: (f: FinanceEntry) => Promise<void>;
}

const DataContext = createContext<DataContextType>({
  repairs: [], customers: [], inventory: [], purchases: [], finance: [],
  isLoading: false,
  loadError: null,
  loadAll: async () => {},
  addRepair: async (r) => r,
  updateRepair: async () => {},
  addCustomer: async (c) => c as Customer,
  updateCustomer: async () => {},
  addInventoryItem: async () => {},
  updateInventoryItem: async () => {},
  addPurchase: async () => {},
  addFinanceEntry: async () => {},
});

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [finance, setFinance] = useState<FinanceEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
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
  }, []);

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

  // The server assigns ids (and ticket numbers) — client-provided ids in the
  // input objects are ignored and replaced by the created entity.
  const addRepair = async (r: Repair): Promise<Repair> => {
    const res = await repairsCreate({
      customerId: r.customerId || undefined,
      customerName: r.customerName,
      mobile: r.mobile,
      deviceType: r.deviceType,
      brand: r.brand,
      model: r.model,
      imei: r.imei,
      problem: r.problem,
      technicianId: r.technicianId,
      technicianName: r.technicianName,
      status: r.status,
      priority: r.priority,
      repairCharge: r.repairCharge,
      partsCharge: r.partsCharge,
      advance: r.advance,
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
  };

  const updateRepair = async (r: Repair) => {
    const res = await repairsUpdate(r.id, {
      customerName: r.customerName,
      mobile: r.mobile,
      deviceType: r.deviceType,
      brand: r.brand,
      model: r.model,
      imei: r.imei,
      problem: r.problem,
      technicianId: r.technicianId,
      technicianName: r.technicianName,
      status: r.status,
      priority: r.priority,
      repairCharge: r.repairCharge,
      partsCharge: r.partsCharge,
      advance: r.advance,
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
  };

  // dueAmount / totalRepairs are derived server-side from repairs — the
  // client never sends them.
  const addCustomer = async (c: NewCustomer): Promise<Customer> => {
    const res = await customersCreate({
      name: c.name,
      mobile: c.mobile,
      email: c.email,
      address: c.address,
    });
    const created = res.customer as Customer;
    setCustomers((prev) => [...prev, created]);
    return created;
  };

  const updateCustomer = async (c: Customer) => {
    const res = await customersUpdate(c.id, {
      name: c.name,
      mobile: c.mobile,
      email: c.email,
      address: c.address,
    });
    const updated = res.customer as Customer;
    setCustomers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  };

  const addInventoryItem = async (i: InventoryItem) => {
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
  };

  const updateInventoryItem = async (i: InventoryItem) => {
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
  };

  const addPurchase = async (p: Purchase) => {
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
  };

  const addFinanceEntry = async (f: FinanceEntry) => {
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
  };

  return (
    <DataContext.Provider value={{
      repairs, customers, inventory, purchases, finance,
      isLoading, loadError,
      loadAll, addRepair, updateRepair, addCustomer, updateCustomer,
      addInventoryItem, updateInventoryItem, addPurchase, addFinanceEntry,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
