import { storage, KEYS } from '@/utils/storage';

// Business data (repairs, customers, inventory, purchases, finance) now lives
// server-side, scoped to the signed-in user's shop — no demo data is seeded
// on the device anymore. Only local app settings defaults are initialized.

const SETTINGS_DEFAULTS = {
  invoicePrefix: 'VMC-INV',
  repairPrefix: 'VMC',
  currency: 'INR',
  currencySymbol: '₹',
  language: 'English',
  theme: 'dark',
};

/** Keys that previously held on-device demo data. Cleared on startup. */
const LEGACY_DEMO_KEYS = [
  KEYS.USERS,
  KEYS.REPAIRS,
  KEYS.CUSTOMERS,
  KEYS.INVENTORY,
  KEYS.PURCHASES,
  KEYS.FINANCE,
];

export async function seedIfNeeded(): Promise<void> {
  // Remove any demo data left behind by earlier app versions.
  await Promise.all(LEGACY_DEMO_KEYS.map((key) => storage.remove(key)));

  const settings = await storage.get<Record<string, unknown>>(KEYS.SETTINGS);
  if (!settings) {
    await storage.set(KEYS.SETTINGS, SETTINGS_DEFAULTS);
  }
}
