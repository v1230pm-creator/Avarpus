import {
  getOrCreateAvarpusDeviceKey,
  isAvarpusDeviceKeyAvailable,
  signAvarpusDeviceChallenge,
} from '@/modules/avarpus-device-key';

/**
 * Expo Go deliberately has no implementation. Returning null is intentional:
 * we must never simulate a device-bound private key in JS or AsyncStorage.
 */
export async function createOrReadDeviceKey(deviceId: string) {
  if (!isAvarpusDeviceKeyAvailable()) return null;
  return getOrCreateAvarpusDeviceKey(deviceId);
}

export async function signWithDeviceKey(challenge: string, deviceId: string): Promise<string | null> {
  if (!isAvarpusDeviceKeyAvailable()) return null;
  return signAvarpusDeviceChallenge(challenge, deviceId);
}

export function hasNativeDeviceKeySupport(): boolean {
  return isAvarpusDeviceKeyAvailable();
}