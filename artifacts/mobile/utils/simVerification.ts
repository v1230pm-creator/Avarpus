import { Linking, PermissionsAndroid, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { secureGetItem, secureSetItem } from './secureStorage';

const DEVICE_ID_KEY = 'avarpus_sim_verification_device_id';

export async function getSimVerificationDeviceId(): Promise<string> {
  const existing = await secureGetItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await secureSetItem(DEVICE_ID_KEY, created);
  return created;
}

export function smsVerificationNumber(): string | null {
  const value = process.env.EXPO_PUBLIC_SMS_VERIFICATION_NUMBER?.trim();
  return value && /^\+?[0-9]{8,16}$/.test(value) ? value : null;
}

async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Number(Platform.Version) < 23) return true;
  const current = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
  if (current) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS, {
    title: 'Send verification SMS',
    message: 'Avarpus needs permission to open a SIM-originated verification message.',
    buttonPositive: 'Continue',
    buttonNegative: 'Cancel',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Opens Android's SMS composer with the one-time challenge already addressed
 * and filled in. The user sees and approves the SMS; Avarpus never sends it
 * silently and never reads incoming messages.
 */
export async function openSimVerificationComposer(challenge: string): Promise<{
  ok: boolean;
  reason?: 'android_only' | 'bridge_not_configured' | 'permission_denied' | 'composer_unavailable';
}> {
  if (Platform.OS !== 'android') return { ok: false, reason: 'android_only' };
  const destination = smsVerificationNumber();
  if (!destination) return { ok: false, reason: 'bridge_not_configured' };
  const granted = await requestSmsPermission();
  if (!granted) return { ok: false, reason: 'permission_denied' };
  const message = `AVARPUS VERIFY ${challenge}`;
  const url = `sms:${destination}?body=${encodeURIComponent(message)}`;
  const supported = await Linking.canOpenURL(url);
  if (!supported) return { ok: false, reason: 'composer_unavailable' };
  await Linking.openURL(url);
  return { ok: true };
}