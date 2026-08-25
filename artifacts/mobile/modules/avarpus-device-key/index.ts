import { requireOptionalNativeModule } from 'expo';

export type AndroidDeviceKeyPair = {
  publicKey: string;
  algorithm: 'RSA-SHA256';
};

type AvarpusDeviceKeyNativeModule = {
  getOrCreateKeyPair(deviceId: string): Promise<AndroidDeviceKeyPair>;
  signChallenge(challenge: string, deviceId: string): Promise<string>;
};

const nativeModule = requireOptionalNativeModule<AvarpusDeviceKeyNativeModule>(
  'AvarpusDeviceKey',
);

export function isAvarpusDeviceKeyAvailable(): boolean {
  return nativeModule !== null;
}

export async function getOrCreateAvarpusDeviceKey(
  deviceId: string,
): Promise<AndroidDeviceKeyPair> {
  if (!nativeModule) {
    throw new Error('Device key sign-in requires an Avarpus Android build.');
  }
  return nativeModule.getOrCreateKeyPair(deviceId);
}

export async function signAvarpusDeviceChallenge(
  challenge: string,
  deviceId: string,
): Promise<string> {
  if (!nativeModule) {
    throw new Error('Device key sign-in requires an Avarpus Android build.');
  }
  return nativeModule.signChallenge(challenge, deviceId);
}