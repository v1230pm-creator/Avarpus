/**
 * disableAppLock must never leave the device with a biometric-only lock.
 *
 * It removes the biometric flag first, then the PIN. If either write fails,
 * the user must still have a viable unlock method (their PIN).
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Back expo-crypto with node's crypto so PIN hashing works in tests.
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

import {
  BIOMETRIC_ENABLED_KEY,
  disableAppLock,
  hasStoredMpin,
  storeMpin,
  verifyMpin,
} from '@/utils/appLock';
import * as secureStorage from '@/utils/secureStorage';

const secureDeleteItem = secureStorage.secureDeleteItem as jest.Mock;

describe('disableAppLock', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    const store = (secureStorage as any).__store as Record<string, string>;
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it('removes both the biometric flag and the PIN on success', async () => {
    await storeMpin('123456');
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');

    await disableAppLock();

    expect(await hasStoredMpin()).toBe(false);
    expect(await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY)).toBeNull();
  });

  it('removes the biometric flag BEFORE clearing the PIN', async () => {
    await storeMpin('123456');
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');

    // When the PIN deletion runs, the biometric flag must ALREADY be gone.
    let flagWhenPinDeleted: string | null = 'not-called';
    secureDeleteItem.mockImplementationOnce(async () => {
      flagWhenPinDeleted = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    });

    await disableAppLock();

    expect(flagWhenPinDeleted).toBeNull();
  });

  it('keeps the PIN usable if clearing the PIN fails mid-way', async () => {
    await storeMpin('123456');
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');

    secureDeleteItem.mockRejectedValueOnce(new Error('storage failure'));

    await expect(disableAppLock()).rejects.toThrow('storage failure');

    // Biometric flag is gone, but the PIN survives — a working lock remains.
    expect(await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY)).toBeNull();
    expect(await verifyMpin('123456')).toBe(true);
  });

  it('leaves the full lock intact if removing the biometric flag fails first', async () => {
    await storeMpin('123456');
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');

    const removeSpy = jest.spyOn(AsyncStorage, 'removeItem');
    removeSpy.mockRejectedValueOnce(new Error('storage failure'));

    await expect(disableAppLock()).rejects.toThrow('storage failure');
    removeSpy.mockRestore();

    expect(await verifyMpin('123456')).toBe(true);
    expect(secureDeleteItem).not.toHaveBeenCalled();
  });
});
