import { storage, KEYS } from './storage';
import {
  repairsCreate, repairsUpdate, customersCreate, inventoryCreate, purchasesCreate, financeCreate,
} from '@workspace/api-client-react';
import type { Repair, Customer, InventoryItem, Purchase, FinanceEntry } from '@/types';

// One-time upload of data saved on this device by the old (pre-server) app
// version, so "purana data" reaches the server and syncs to every device.
//
// Safety rules:
// - An item is removed from device storage only AFTER the server accepts it,
//   so nothing is lost if the app closes mid-migration (it resumes next login).
// - Repairs send clientRequestId = `legacy-<oldId>` — the server's idempotency
//   guarantee means a retry can never create the same repair twice.
// - A 409 (already exists) also counts as migrated.
// - Items the server permanently rejects (validation/permission) are left in
//   place but don't block the rest; we retry them on the next login.

const LEGACY_KEYS = [
  KEYS.REPAIRS, KEYS.CUSTOMERS, KEYS.INVENTORY, KEYS.PURCHASES, KEYS.FINANCE,
] as const;

// Legacy customer id → server customer id, persisted so repairs migrated on a
// later login still link to the right server customer.
const CUSTOMER_IDMAP_KEY = 'vmc_legacy_customer_idmap';

export interface LegacyMigrationResult {
  migrated: number;
  remaining: number;
}

export interface LegacyMigrationOptions {
  /** Return true to stop between items (e.g. user/session changed). */
  shouldAbort?: () => boolean;
}

/** True if any pre-server data is still sitting in device storage. */
export async function hasLegacyLocalData(): Promise<boolean> {
  for (const key of LEGACY_KEYS) {
    const items = await storage.get<unknown[]>(key);
    if (Array.isArray(items) && items.length > 0) return true;
  }
  return false;
}

type Uploader<T> = (item: T) => Promise<unknown>;

/** Upload a category one item at a time, persisting progress after each. */
async function migrateCategory<T>(
  key: string,
  upload: Uploader<T>,
  shouldAbort?: () => boolean,
): Promise<LegacyMigrationResult> {
  const items = await storage.get<T[]>(key);
  if (!Array.isArray(items) || items.length === 0) {
    if (Array.isArray(items)) await storage.remove(key);
    return { migrated: 0, remaining: 0 };
  }
  const queue = [...items];
  let migrated = 0;
  const kept: T[] = [];
  for (let idx = 0; idx < queue.length; idx++) {
    if (shouldAbort?.()) {
      // Stop cleanly: everything not yet uploaded stays for the next login.
      const rest = [...kept, ...queue.slice(idx)];
      await storage.set(key, rest);
      return { migrated, remaining: rest.length };
    }
    const item = queue[idx];
    try {
      await upload(item);
      migrated++;
    } catch (e: any) {
      if (e?.status === 409) {
        migrated++; // already on the server — done
      } else {
        kept.push(item); // retry on a later login
      }
    }
    // Persist after every item so a crash can't re-upload what succeeded.
    await storage.set(key, [...kept, ...queue.slice(idx + 1)]);
  }
  if (kept.length === 0) await storage.remove(key);
  else await storage.set(key, kept);
  return { migrated, remaining: kept.length };
}

/**
 * Push all pre-server device data up to the API. Call only for non-portal,
 * signed-in users. Returns counts so the caller can decide to reload.
 */
export async function migrateLegacyLocalData(
  options: LegacyMigrationOptions = {},
): Promise<LegacyMigrationResult> {
  const { shouldAbort } = options;
  let migrated = 0;
  let remaining = 0;
  const add = (r: LegacyMigrationResult) => { migrated += r.migrated; remaining += r.remaining; };

  // Customers first, remembering legacy→server ids so repairs migrated now or
  // on a later login still link to the right customer record.
  const idMap = (await storage.get<Record<string, string>>(CUSTOMER_IDMAP_KEY)) || {};
  add(await migrateCategory<Customer>(KEYS.CUSTOMERS, async (c) => {
    const res = await customersCreate({
      name: c.name,
      mobile: c.mobile,
      alternateMobile: (c as any).alternateMobile,
      email: c.email,
      address: c.address,
    } as any);
    const created = (res as any)?.customer;
    if (c.id && created?.id) {
      idMap[c.id] = created.id;
      await storage.set(CUSTOMER_IDMAP_KEY, idMap);
    }
  }, shouldAbort));

  add(await migrateCategory<Repair>(KEYS.REPAIRS, async (r) => {
    const res = await repairsCreate({
      clientRequestId: `legacy-${r.id}`,
      customerId: (r.customerId && idMap[r.customerId]) || undefined,
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
    });
    // The server forces every created repair to 'received'. Best-effort
    // restore of the old status via a normal update (server-side stage gates
    // still apply — if a transition is rejected the repair stays 'received').
    const created = (res as any)?.repair;
    if (created?.id && r.status && r.status !== 'received' && created.status !== r.status) {
      try {
        await repairsUpdate(created.id, {
          diagnosis: r.diagnosis,
          workPerformed: r.workPerformed,
          status: r.status,
          deliveryDate: r.deliveryDate,
        } as any);
      } catch {
        // non-fatal — record is on the server, just at the entry stage
      }
    }
  }, shouldAbort));

  add(await migrateCategory<InventoryItem>(KEYS.INVENTORY, (i) =>
    inventoryCreate({
      name: i.name,
      category: i.category,
      brand: i.brand,
      quantity: i.quantity,
      minStock: i.minStock,
      purchasePrice: i.purchasePrice,
      sellingPrice: i.sellingPrice,
      supplier: i.supplier,
    }), shouldAbort));

  add(await migrateCategory<Purchase>(KEYS.PURCHASES, (p) =>
    purchasesCreate({
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
    }), shouldAbort));

  add(await migrateCategory<FinanceEntry>(KEYS.FINANCE, (f) =>
    financeCreate({
      type: f.type,
      category: f.category,
      amount: f.amount,
      description: f.description,
      paymentMethod: f.paymentMethod,
      date: f.date,
    }), shouldAbort));

  return { migrated, remaining };
}
