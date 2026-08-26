jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockSecureDeleteItem = jest.fn(async (_key: string) => {});
jest.mock('@/utils/secureStorage', () => ({
  secureDeleteItem: (key: string) => mockSecureDeleteItem(key),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BIOMETRIC_ENABLED_KEY,
  clearLegacyMpinData,
  isLockEnabled,
  isUnlocked,
  setBiometricLockEnabled,
  setUnlocked,
} from '@/utils/appLock';

describe('biometric-only app lock', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    setUnlocked(false);
  });

  it('is disabled until the user enables it in settings', async () => {
    await expect(isLockEnabled()).resolves.toBe(false);
    await setBiometricLockEnabled(true);
    await expect(isLockEnabled()).resolves.toBe(true);
  });

  it('turning the lock off keeps the authenticated session unlocked', async () => {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
    await setBiometricLockEnabled(false);
    await expect(AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY)).resolves.toBeNull();
    expect(isUnlocked()).toBe(true);
  });

  it('removes obsolete MPIN and PIN-throttle records without changing biometric preference', async () => {
    await AsyncStorage.multiSet([
      ['@vmc_mpin_setup', 'true'],
      ['@vmc_mpin', '123456'],
      ['@vmc_pin_failed_attempts', '5'],
      ['@vmc_pin_lockout_until', '9999999999999'],
      [BIOMETRIC_ENABLED_KEY, 'true'],
    ]);

    await clearLegacyMpinData();

    expect(mockSecureDeleteItem).toHaveBeenCalledWith('vmc_mpin');
    await expect(AsyncStorage.getItem('@vmc_mpin_setup')).resolves.toBeNull();
    await expect(AsyncStorage.getItem('@vmc_mpin')).resolves.toBeNull();
    await expect(AsyncStorage.getItem('@vmc_pin_failed_attempts')).resolves.toBeNull();
    await expect(AsyncStorage.getItem('@vmc_pin_lockout_until')).resolves.toBeNull();
    await expect(AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY)).resolves.toBe('true');
  });
});