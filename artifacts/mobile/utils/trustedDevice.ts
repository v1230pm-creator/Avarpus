import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

const ANDROID_ID_RE = /^[0-9a-f]{16}$/;

export function canAttemptTrustedDeviceRecovery(): boolean {
  return (
    Platform.OS === 'android' &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
  );
}

/**
 * Returns Android's app-signing-key scoped device identifier only in a native
 * Android build. It is an identifier, not a secret; the server hashes it and
 * applies short, non-sliding trust windows.
 */
export async function getTrustedAndroidDeviceId(): Promise<string | null> {
  if (!canAttemptTrustedDeviceRecovery()) return null;
  try {
    const value = Application.getAndroidId().trim().toLowerCase();
    return ANDROID_ID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}
