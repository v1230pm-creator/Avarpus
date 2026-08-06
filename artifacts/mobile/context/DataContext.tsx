import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Repair, Customer, InventoryItem, Purchase, FinanceEntry, User } from '@/types';
import { storage, KEYS } from '@/utils/storage';

interface DataContextType {
  repairs: Repair[];
  customers: Customer[];
  inventory: InventoryItem[];
  purchases: Purchase[];
  finance: FinanceEntry[];
  users: User[];
  loadAll: () => Promise<void>;
  addRepair: (r: Repair) => Promise<void>;
  updateRepair: (r: Repair) => Promise<void>;
  addCustomer: (c: Customer) => Promise<void>;
  updateCustomer: (c: Customer) => Promise<void>;
  addInventoryItem: (i: InventoryItem) => Promise<void>;
  updateInventoryItem: (i: InventoryItem) => Promise<void>;
  addPurchase: (p: Purchase) => Promise<void>;
  addFinanceEntry: (f: FinanceEntry) => Promise<void>;
}

const DataContext = createContext<DataContextType>({
  repairs: [], customers: [], inventory: [], purchases: [], finance: [], users: [],
  loadAll: async () => {},
  addRepair: async () => {},
  updateRepair: async () => {},
  addCustomer: async () => {},
  updateCustomer: async () => {},
  addInventoryItem: async () => {},
  updateInventoryItem: async () => {},
  addPurchase: async () => {},
  addFinanceEntry: async () => {},
});

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [finance, setFinance] = useState<FinanceEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const loadAll = useCallback(async () => {
    const [r, c, i, p, f, u] = await Promise.all([
      storage.get<Repair[]>(KEYS.REPAIRS),
      storage.get<Customer[]>(KEYS.CUSTOMERS),
      storage.get<InventoryItem[]>(KEYS.INVENTORY),
      storage.get<Purchase[]>(KEYS.PURCHASES),
      storage.get<FinanceEntry[]>(KEYS.FINANCE),
      storage.get<User[]>(KEYS.USERS),
    ]);
    setRepairs(r ?? []);
    setCustomers(c ?? []);
    setInventory(i ?? []);
    setPurchases(p ?? []);
    setFinance(f ?? []);
    setUsers(u ?? []);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const addRepair = async (r: Repair) => {
    const next = [...repairs, r];
    setRepairs(next);
    await storage.set(KEYS.REPAIRS, next);
  };

  const updateRepair = async (r: Repair) => {
    const next = repairs.map((x) => (x.id === r.id ? r : x));
    setRepairs(next);
    await storage.set(KEYS.REPAIRS, next);
  };

  const addCustomer = async (c: Customer) => {
    const next = [...customers, c];
    setCustomers(next);
    await storage.set(KEYS.CUSTOMERS, next);
  };

  const updateCustomer = async (c: Customer) => {
    const next = customers.map((x) => (x.id === c.id ? c : x));
    setCustomers(next);
    await storage.set(KEYS.CUSTOMERS, next);
  };

  const addInventoryItem = async (i: InventoryItem) => {
    const next = [...inventory, i];
    setInventory(next);
    await storage.set(KEYS.INVENTORY, next);
  };

  const updateInventoryItem = async (i: InventoryItem) => {
    const next = inventory.map((x) => (x.id === i.id ? i : x));
    setInventory(next);
    await storage.set(KEYS.INVENTORY, next);
  };

  const addPurchase = async (p: Purchase) => {
    const next = [...purchases, p];
    setPurchases(next);
    await storage.set(KEYS.PURCHASES, next);
  };

  const addFinanceEntry = async (f: FinanceEntry) => {
    const next = [...finance, f];
    setFinance(next);
    await storage.set(KEYS.FINANCE, next);
  };

  return (
    <DataContext.Provider value={{
      repairs, customers, inventory, purchases, finance, users,
      loadAll, addRepair, updateRepair, addCustomer, updateCustomer,
      addInventoryItem, updateInventoryItem, addPurchase, addFinanceEntry,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
