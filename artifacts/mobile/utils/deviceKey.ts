import { NativeModules, Platform } from 'react-native';

/**
 * Contract for the custom Android native module required for device-bound
 * authentication. The module must generate/store the private key in Android
 * Keystore and expose only the public key and signatures to JavaScript.
 *
 * Expo Go deliberately has no implementation. Returning null is intentional:
 * we must never simulate a device-bound private key in JS or AsyncStorage.
 */
interface AvarpusDeviceKeyModule {
  getOrCreateKeyPair(deviceId: string): Promise<{
    publicKey: string;
    algorithm: 'RSA-SHA256';
  }>;
  signChallenge(challenge: string): Promise<string>;
}

function nativeModule(): AvarpusDeviceKeyModule | null {
  if (Platform.OS !== 'android') return null;
  const candidate = NativeModules.AvarpusDeviceKey as AvarpusDeviceKeyModule | undefined;
  return candidate ?? null;
}

export async function createOrReadDeviceKey(deviceId: string) {
  const module = nativeModule();
  if (!module) return null;
  return module.getOrCreateKeyPair(deviceId);
}

export async function signWithDeviceKey(challenge: string): Promise<string | null> {
  const module = nativeModule();
  if (!module) return null;
  return module.signChallenge(challenge);
}

export function hasNativeDeviceKeySupport(): boolean {
  return nativeModule() !== null;
}