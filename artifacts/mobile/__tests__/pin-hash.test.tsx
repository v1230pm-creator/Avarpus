/**
 * The stored PIN must be unreadable even if device storage is extracted:
 * - storeMpin persists a salted hash record, never the raw PIN
 * - verifyMpin compares against the hash
 * - legacy plaintext records (SecureStore or old AsyncStorage key) still
 *   verify and are upgraded to hashed form
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/utils/secureStorage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    secureGetItem: jest.fn(async (key: string) => store[key] ?? null),
    secureSetItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    secureDeleteItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
    __store: store,
  };
});

// Back expo-crypto with node's crypto so hashes are real and deterministic.
jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto');
  return {
    __esModule: true,
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: jest.fn(async (_alg: string, data: string) =>
      nodeCrypto.createHash('sha256').update(data, 'utf8').digest('hex'),
    ),
    getRandomBytesAsync: jest.fn(async (n: number) => nodeCrypto.randomBytes(n)),
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as secureStorage from '@/utils/secureStorage';
import {
  MPIN_SECURE_KEY,
  hasStoredMpin,
  isCurrentPinRecord,
  isHashedPinRecord,
  storeMpin,
  verifyMpin,
  verifyPinAgainstRecord,
} from '@/utils/appLock';

const LEGACY_MPIN_KEY = '@vmc_mpin';

function secureStore(): Record<string, string> {
  return (secureStorage as any).__store as Record<string, string>;
}

describe('PIN hashing', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    const store = secureStore();
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it('stores a salted scrypt record, never the raw PIN', async () => {
    await storeMpin('123456');
    const record = secureStore()[MPIN_SECURE_KEY];
    expect(record).toBeTruthy();
    expect(isHashedPinRecord(record)).toBe(true);
    expect(isCurrentPinRecord(record)).toBe(true);
    expect(record.startsWith('v2$scrypt$')).toBe(true);
    expect(record).not.toContain('123456');
  });

  it('rejects tampered records with out-of-bounds cost parameters instead of hanging', async () => {
    const salt = 'a'.repeat(32);
    const hash = 'b'.repeat(64);
    // Absurd N / r / p / non-numeric / non-power-of-two must all fail fast.
    expect(await verifyPinAgainstRecord('123456', `v2$scrypt$1073741824$8$1$${salt}$${hash}`)).toBe(false);
    expect(await verifyPinAgainstRecord('123456', `v2$scrypt$32768$999$1$${salt}$${hash}`)).toBe(false);
    expect(await verifyPinAgainstRecord('123456', `v2$scrypt$32768$8$99$${salt}$${hash}`)).toBe(false);
    expect(await verifyPinAgainstRecord('123456', `v2$scrypt$abc$8$1$${salt}$${hash}`)).toBe(false);
    expect(await verifyPinAgainstRecord('123456', `v2$scrypt$32769$8$1$${salt}$${hash}`)).toBe(false);
    // v1 with an absurd iteration count must fail fast too.
    expect(await verifyPinAgainstRecord('123456', `v1$${salt}$999999999$${hash}`)).toBe(false);
    // Malformed records.
    expect(await verifyPinAgainstRecord('123456', 'v2$scrypt$32768$8$1')).toBe(false);
    expect(await verifyPinAgainstRecord('123456', 'v2$argon2$32768$8$1$x$y')).toBe(false);
  });

  it('verifies the correct PIN and rejects wrong ones', async () => {
    await storeMpin('123456');
    expect(await verifyMpin('123456')).toBe(true);
    expect(await verifyMpin('654321')).toBe(false);
    expect(await verifyMpin('')).toBe(false);
  });

  it('salts hashes: same PIN produces different records', async () => {
    await storeMpin('123456');
    const first = secureStore()[MPIN_SECURE_KEY];
    await storeMpin('123456');
    const second = secureStore()[MPIN_SECURE_KEY];
    expect(first).not.toBe(second);
  });

  it('accepts a legacy plaintext SecureStore record and upgrades it on success', async () => {
    secureStore()[MPIN_SECURE_KEY] = '123456';

    expect(await verifyMpin('999999')).toBe(false);
    // Wrong PIN must not trigger the upgrade.
    expect(secureStore()[MPIN_SECURE_KEY]).toBe('123456');

    expect(await verifyMpin('123456')).toBe(true);
    const record = secureStore()[MPIN_SECURE_KEY];
    expect(isCurrentPinRecord(record)).toBe(true);
    expect(record).not.toContain('123456');
    // Still verifies after the upgrade.
    expect(await verifyMpin('123456')).toBe(true);
  });

  it('accepts an older v1 hashed record and upgrades it to scrypt on success', async () => {
    // Build a genuine v1 record: iterated SHA-256 of `<salt>:<pin>`.
    const nodeCrypto = require('crypto');
    const salt = 'c'.repeat(32);
    let digest = `${salt}:123456`;
    for (let i = 0; i < 1000; i++) {
      digest = nodeCrypto.createHash('sha256').update(digest, 'utf8').digest('hex');
    }
    secureStore()[MPIN_SECURE_KEY] = `v1$${salt}$1000$${digest}`;

    expect(await verifyMpin('000000')).toBe(false);
    expect(secureStore()[MPIN_SECURE_KEY].startsWith('v1$')).toBe(true);

    expect(await verifyMpin('123456')).toBe(true);
    expect(isCurrentPinRecord(secureStore()[MPIN_SECURE_KEY])).toBe(true);
    expect(await verifyMpin('123456')).toBe(true);
  });

  it('migrates a legacy AsyncStorage plaintext PIN directly to a hashed record', async () => {
    await AsyncStorage.setItem(LEGACY_MPIN_KEY, '123456');

    expect(await hasStoredMpin()).toBe(true);
    expect(await AsyncStorage.getItem(LEGACY_MPIN_KEY)).toBeNull();

    const record = secureStore()[MPIN_SECURE_KEY];
    expect(isCurrentPinRecord(record)).toBe(true);
    expect(record).not.toContain('123456');
    expect(await verifyMpin('123456')).toBe(true);
    expect(await verifyMpin('000000')).toBe(false);
  });
});
