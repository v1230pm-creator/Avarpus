const mockGetAndroidId = jest.fn();

jest.mock('expo-application', () => ({
  getAndroidId: () => mockGetAndroidId(),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'standalone' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

import { Platform } from 'react-native';
import {
  canAttemptTrustedDeviceRecovery,
  getTrustedAndroidDeviceId,
} from '@/utils/trustedDevice';

describe('trusted Android device identifier', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  it('returns the normalized Android identifier in a native Android build', async () => {
    mockGetAndroidId.mockReturnValue('A1B2C3D4E5F60708');

    expect(canAttemptTrustedDeviceRecovery()).toBe(true);
    await expect(getTrustedAndroidDeviceId()).resolves.toBe('a1b2c3d4e5f60708');
  });

  it('does not expose an identifier or call native APIs on unsupported platforms', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });

    expect(canAttemptTrustedDeviceRecovery()).toBe(false);
    await expect(getTrustedAndroidDeviceId()).resolves.toBeNull();
    expect(mockGetAndroidId).not.toHaveBeenCalled();
  });
});