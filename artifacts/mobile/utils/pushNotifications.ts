import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { pushTokenRegister, pushTokenUnregister } from '@workspace/api-client-react';
import { storage, KEYS } from '@/utils/storage';

// ── Push registration ────────────────────────────────────────────────────────
// The in-app inbox is the record; push is the copy that reaches a phone with
// the app closed. Everything here is optional and silent: a device that cannot
// or will not receive push simply keeps polling the inbox as before.
//
// Remote push needs the native module, which only exists in a signed build.
// Expo Go and web must never touch it — importing it eagerly there cancels
// startup before any error boundary can report why.

type NotificationsModule = typeof import('expo-notifications');

let handlerInstalled = false;

export function canReceivePush(): boolean {
  return (
    (Platform.OS === 'android' || Platform.OS === 'ios') &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
  );
}

function loadNotifications(): NotificationsModule | null {
  if (!canReceivePush()) return null;
  try {
    // Lazy require: startup must not depend on a module that a store client
    // or an older installed build does not have.
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

function projectId(): string | null {
  const eas = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas;
  return typeof eas?.projectId === 'string' && eas.projectId ? eas.projectId : null;
}

// The server sends every message on the "default" channel; without it Android
// files the notification under a channel the user cannot see or configure.
async function ensureAndroidChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Alerts',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

function installForegroundHandler(Notifications: NotificationsModule): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function dropRegistration(remote: boolean): Promise<void> {
  const stored = await storage.get<string>(KEYS.PUSH_TOKEN);
  await storage.remove(KEYS.PUSH_TOKEN);
  if (!remote || !stored) return;
  try {
    await pushTokenUnregister({ token: stored });
  } catch {
    // The session may already be gone, in which case the server dropped the
    // token with it. Nothing here is worth reporting to the user.
  }
}

/**
 * Registers this device for push against the signed-in account, or tells the
 * server to stop pushing when notification permission is not (or no longer)
 * granted. Safe to call repeatedly; never throws.
 */
export async function syncPushRegistration(deviceInfo?: string): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    installForegroundHandler(Notifications);
    await ensureAndroidChannel(Notifications);

    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) {
      // Permission can be withdrawn in system settings long after sign-in.
      // Retire the token rather than leaving the server pushing into a void.
      await dropRegistration(true);
      return;
    }

    const id = projectId();
    if (!id) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    if (!token) return;
    await pushTokenRegister({
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      ...(deviceInfo ? { deviceInfo } : {}),
    });
    await storage.set(KEYS.PUSH_TOKEN, token);
  } catch {
    // Push is an enhancement. A denied permission, a build without the native
    // module, or an offline server must never interrupt signing in.
  }
}

/**
 * Called when the account signs out. The server drops the token with the
 * session it was bound to, so this only clears the local record.
 */
export async function forgetPushRegistration(): Promise<void> {
  await dropRegistration(false);
}
