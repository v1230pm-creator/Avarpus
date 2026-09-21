import Constants, { ExecutionEnvironment } from 'expo-constants';
import { AppState, Linking, Platform } from 'react-native';
import {
  pushTokenRegister,
  pushTokenUnregister,
  type NotificationPreferences,
} from '@workspace/api-client-react';
import { storage, KEYS } from '@/utils/storage';

// ── Push registration ────────────────────────────────────────────────────────
// The in-app inbox is the record; push is the copy that reaches a phone with
// the app closed. Everything here is optional and silent: a device that cannot
// or will not receive push simply keeps polling the inbox as before.
//
// Remote push needs the native module, which only exists in a signed build.
// Expo Go and web must never touch it — importing it eagerly there cancels
// startup before any error boundary can report why. Expo Go also cannot
// receive remote push from this server at all (SDK 53+), so a missing token
// there is expected, not a fault.
//
// Transport: server → Expo Push Service → FCM (Android) / APNs (iOS). Android
// devices only get a token when the APK was built with google-services.json
// (see app.config.js). That failure used to be swallowed; it is now recorded
// in the diagnostics record so the Settings screen can say so.

type NotificationsModule = typeof import('expo-notifications');

export type PushPermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export type PushDiagnostics = {
  permission: PushPermissionState;
  // Whether the OS permission prompt has been shown by this install. Shown
  // once; afterwards the user is pointed to system settings instead.
  prompted: boolean;
  // Expo push token last obtained on this device, masked to its last 4 chars.
  tokenSuffix: string | null;
  tokenError: string | null;
  // Result of the last attempt to register the token with the API.
  registration: 'never' | 'success' | 'failed';
  registrationError: string | null;
  registeredAt: string | null;
  // Whether the native (FCM/APNs) layer handed out a device token — the
  // definitive sign that Firebase credentials are wired into this build.
  nativeToken: 'unknown' | 'available' | 'unavailable';
  nativeTokenError: string | null;
  lastReceivedAt: string | null;
  lastReceivedType: string | null;
  lastOpenedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

const EMPTY_DIAGNOSTICS: PushDiagnostics = {
  permission: 'undetermined',
  prompted: false,
  tokenSuffix: null,
  tokenError: null,
  registration: 'never',
  registrationError: null,
  registeredAt: null,
  nativeToken: 'unknown',
  nativeTokenError: null,
  lastReceivedAt: null,
  lastReceivedType: null,
  lastOpenedAt: null,
  lastError: null,
  lastErrorAt: null,
};

// ── Channels ─────────────────────────────────────────────────────────────────
// Ids and variants must match the server (artifacts/api-server/src/lib/push.ts).
// Android freezes a channel's sound/vibration once it exists, so each category
// has four variants and the server addresses the one matching the account's
// Sound / Vibration preferences.
export const PUSH_CHANNEL_GROUPS = [
  { id: 'avarpus_messages', name: 'Messages', description: 'New chat messages', importance: 'MAX' as const },
  { id: 'avarpus_calls', name: 'Calls', description: 'Incoming and missed calls', importance: 'MAX' as const },
  { id: 'avarpus_dealer', name: 'Dealer', description: 'Dealer transfers and transactions', importance: 'HIGH' as const },
  { id: 'avarpus_repair', name: 'Repairs', description: 'Repair status and approvals', importance: 'HIGH' as const },
  { id: 'avarpus_payments', name: 'Payments', description: 'Payments, bills and refunds', importance: 'HIGH' as const },
  { id: 'avarpus_general', name: 'General', description: 'Account, security and other alerts', importance: 'DEFAULT' as const },
];

const CHANNEL_VARIANTS: Array<{ suffix: string; label: string; sound: boolean; vibration: boolean }> = [
  { suffix: '', label: '', sound: true, vibration: true },
  { suffix: '_silent', label: ' · no sound', sound: false, vibration: true },
  { suffix: '_novibrate', label: ' · no vibration', sound: true, vibration: false },
  { suffix: '_quiet', label: ' · silent', sound: false, vibration: false },
];

// Bump when channel definitions change: Android ignores updates to an existing
// channel, so a new definition needs new ids. The legacy "default" channel is
// deleted on first run of a build that knows the new set.
const CHANNEL_SET_VERSION = 'v2';
const MESSAGE_SOUND = 'avarpus_message.wav';
const LEGACY_CHANNEL_IDS = ['default'];

export type NotificationData = Record<string, unknown> & {
  type?: string;
  roomId?: string;
  messageId?: string;
  badge?: number;
};

let handlerInstalled = false;
let listenersInstalled = false;
let activeChatRoomId: string | null = null;
let cachedPreferences: NotificationPreferences | null = null;
const receivedListeners = new Set<(data: NotificationData) => void>();
const responseListeners = new Set<(data: NotificationData) => void>();
const diagnosticsListeners = new Set<(diag: PushDiagnostics) => void>();

export function canReceivePush(): boolean {
  return (
    (Platform.OS === 'android' || Platform.OS === 'ios') &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
  );
}

export function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

export function firebaseConfiguredAtBuild(): boolean | null {
  const extra = Constants.expoConfig?.extra as { pushFirebaseConfigured?: boolean } | undefined;
  return typeof extra?.pushFirebaseConfigured === 'boolean' ? extra.pushFirebaseConfigured : null;
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

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return String(err ?? 'unknown error').slice(0, 200);
}

// ── Diagnostics record ───────────────────────────────────────────────────────
// Never holds a raw token. Read by Settings → Notifications.

export async function getPushDiagnostics(): Promise<PushDiagnostics> {
  const stored = await storage.get<Partial<PushDiagnostics>>(KEYS.PUSH_DIAGNOSTICS);
  return { ...EMPTY_DIAGNOSTICS, ...(stored ?? {}) };
}

async function updateDiagnostics(patch: Partial<PushDiagnostics>): Promise<PushDiagnostics> {
  const next = { ...(await getPushDiagnostics()), ...patch };
  await storage.set(KEYS.PUSH_DIAGNOSTICS, next);
  diagnosticsListeners.forEach((listener) => listener(next));
  return next;
}

export function subscribePushDiagnostics(listener: (diag: PushDiagnostics) => void): () => void {
  diagnosticsListeners.add(listener);
  return () => diagnosticsListeners.delete(listener);
}

async function recordError(message: string): Promise<void> {
  await updateDiagnostics({ lastError: message, lastErrorAt: new Date().toISOString() });
}

// ── Device identity ──────────────────────────────────────────────────────────
// A stable per-install id lets the server retire this handset's previous
// token when the token rotates, so one phone never receives every alert twice.

async function deviceId(): Promise<string | null> {
  try {
    const Application = require('expo-application') as typeof import('expo-application');
    if (Platform.OS === 'android') {
      const id = Application.getAndroidId();
      if (id) return `android:${id}`;
    } else if (Platform.OS === 'ios') {
      const id = await Application.getIosIdForVendorAsync();
      if (id) return `ios:${id}`;
    }
  } catch {
    // Fall through to the stored id.
  }
  const stored = await storage.get<string>(KEYS.PUSH_DEVICE_ID);
  if (stored) return stored;
  const generated = `install:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  await storage.set(KEYS.PUSH_DEVICE_ID, generated);
  return generated;
}

export function appVersionLabel(): string {
  try {
    const Application = require('expo-application') as typeof import('expo-application');
    const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '?';
    const build = Application.nativeBuildVersion;
    return build ? `${version} (${build})` : String(version);
  } catch {
    return String(Constants.expoConfig?.version ?? '?');
  }
}

// ── Channels ─────────────────────────────────────────────────────────────────

async function ensureAndroidChannels(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  const installed = await storage.get<string>(KEYS.PUSH_CHANNELS_VERSION);
  if (installed === CHANNEL_SET_VERSION) return;

  const importance = {
    MAX: Notifications.AndroidImportance.MAX,
    HIGH: Notifications.AndroidImportance.HIGH,
    DEFAULT: Notifications.AndroidImportance.DEFAULT,
  };
  for (const group of PUSH_CHANNEL_GROUPS) {
    await Notifications.setNotificationChannelGroupAsync(group.id, {
      name: group.name,
      description: group.description,
    });
    for (const variant of CHANNEL_VARIANTS) {
      const isMessages = group.id === 'avarpus_messages';
      await Notifications.setNotificationChannelAsync(`${group.id}${variant.suffix}`, {
        name: `${group.name}${variant.label}`,
        description: group.description,
        groupId: group.id,
        importance: importance[group.importance],
        // Android reads sound and vibration from the channel, never from the
        // message. `null` sound = silent; a custom sound must be bundled by
        // the expo-notifications config plugin (see app.json).
        sound: variant.sound ? (isMessages ? MESSAGE_SOUND : 'default') : null,
        enableVibrate: variant.vibration,
        vibrationPattern: variant.vibration ? [0, 180, 90, 180] : undefined,
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
        lightColor: '#006DA8',
        enableLights: true,
        bypassDnd: false,
      });
    }
  }
  for (const legacy of LEGACY_CHANNEL_IDS) {
    await Notifications.deleteNotificationChannelAsync(legacy).catch(() => {});
  }
  await storage.set(KEYS.PUSH_CHANNELS_VERSION, CHANNEL_SET_VERSION);
}

// ── Foreground behaviour ─────────────────────────────────────────────────────

/** The chat room currently on screen; a message push for it is not shown. */
export function setActiveChatRoom(roomId: string | null): void {
  activeChatRoomId = roomId;
}

export function getActiveChatRoom(): string | null {
  return activeChatRoomId;
}

/** Cache of the account's server-side preferences for foreground decisions. */
export function setCachedNotificationPreferences(prefs: NotificationPreferences | null): void {
  cachedPreferences = prefs;
}

function dataOf(notification: { request: { content: { data?: unknown } } }): NotificationData {
  const data = notification.request.content.data;
  return data && typeof data === 'object' ? (data as NotificationData) : {};
}

function installForegroundHandler(Notifications: NotificationsModule): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = dataOf(notification);
      const isMessage = data.type === 'chat_message';
      const onScreen =
        isMessage && typeof data.roomId === 'string' && activeChatRoomId === data.roomId;
      if (onScreen) {
        // The conversation is open: the list refreshes itself; a banner and a
        // second sound on top would be noise.
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      const sound = cachedPreferences?.sound ?? true;
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: sound,
        shouldSetBadge: true,
      };
    },
  });
}

// ── Listeners ────────────────────────────────────────────────────────────────

export function onPushReceived(listener: (data: NotificationData) => void): () => void {
  receivedListeners.add(listener);
  return () => receivedListeners.delete(listener);
}

export function onPushOpened(listener: (data: NotificationData) => void): () => void {
  responseListeners.add(listener);
  return () => responseListeners.delete(listener);
}

async function applyBadgeFromData(Notifications: NotificationsModule, data: NotificationData): Promise<void> {
  if (typeof data.badge === 'number' && Number.isFinite(data.badge)) {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(data.badge))).catch(() => {});
  }
}

/**
 * Installs the receive/open listeners once for the process and replays the
 * notification that launched the app (cold start), if any. Returns a cleanup.
 */
export function installPushListeners(): () => void {
  const Notifications = loadNotifications();
  if (!Notifications || listenersInstalled) return () => {};
  listenersInstalled = true;
  installForegroundHandler(Notifications);

  const received = Notifications.addNotificationReceivedListener((notification) => {
    const data = dataOf(notification);
    void updateDiagnostics({
      lastReceivedAt: new Date().toISOString(),
      lastReceivedType: typeof data.type === 'string' ? data.type : null,
    });
    void applyBadgeFromData(Notifications, data);
    receivedListeners.forEach((listener) => listener(data));
  });
  const responded = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = dataOf(response.notification);
    void updateDiagnostics({ lastOpenedAt: new Date().toISOString() });
    responseListeners.forEach((listener) => listener(data));
  });

  // Cold start: the tap that launched the process arrives here rather than
  // through the listener above.
  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!response) return;
      const data = dataOf(response.notification);
      void updateDiagnostics({ lastOpenedAt: new Date().toISOString() });
      responseListeners.forEach((listener) => listener(data));
    })
    .catch(() => {});

  return () => {
    received.remove();
    responded.remove();
    listenersInstalled = false;
  };
}

// ── Badge ────────────────────────────────────────────────────────────────────

export async function setAppBadge(count: number): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(count))).catch(() => {});
}

/** Removes delivered notifications for a room once it is open and read. */
export async function dismissChatNotifications(roomId: string): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => dataOf(n).roomId === roomId)
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    // Cosmetic.
  }
}

// ── Permission ───────────────────────────────────────────────────────────────

export async function getPushPermissionState(): Promise<PushPermissionState> {
  const Notifications = loadNotifications();
  if (!Notifications) return 'unsupported';
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    return current.canAskAgain && current.status === 'undetermined' ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/** Opens the OS notification settings for this app. */
export async function openSystemNotificationSettings(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      const IntentLauncher = require('expo-intent-launcher') as typeof import('expo-intent-launcher');
      const pkg = (require('expo-application') as typeof import('expo-application')).applicationId;
      await IntentLauncher.startActivityAsync('android.settings.APP_NOTIFICATION_SETTINGS', {
        extra: { 'android.provider.extra.APP_PACKAGE': pkg },
      });
      return;
    }
  } catch {
    // Fall back to the generic app settings page.
  }
  await Linking.openSettings();
}

// ── Registration ─────────────────────────────────────────────────────────────

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
 * granted. Asks the OS for permission at most once per install; afterwards a
 * denied state is respected and the Settings screen points to system
 * settings. Safe to call repeatedly; never throws.
 */
export async function syncPushRegistration(
  deviceInfo?: string,
  options: { promptIfNeeded?: boolean } = {},
): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) {
    if (isExpoGo()) {
      await updateDiagnostics({
        permission: 'unsupported',
        tokenError: 'Remote push is not available in Expo Go. Use an installed release build.',
      });
    }
    return;
  }
  try {
    installForegroundHandler(Notifications);
    await ensureAndroidChannels(Notifications);

    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    const diag = await getPushDiagnostics();
    const promptIfNeeded = options.promptIfNeeded ?? !diag.prompted;
    if (!granted && current.canAskAgain && promptIfNeeded) {
      await updateDiagnostics({ prompted: true });
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) {
      // Permission can be withdrawn in system settings long after sign-in.
      // Tell the server rather than leaving it pushing into a void.
      await updateDiagnostics({ permission: 'denied' });
      await dropRegistration(true);
      return;
    }
    await updateDiagnostics({ permission: 'granted' });

    const id = projectId();
    if (!id) {
      await updateDiagnostics({ tokenError: 'EAS project id missing from app config.' });
      return;
    }

    let token: string;
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    } catch (err) {
      // On Android this is where a build without google-services.json (or a
      // project without FCM credentials) fails. Keep the reason.
      const message = errorText(err);
      await updateDiagnostics({ tokenSuffix: null, tokenError: message, registration: 'failed', registrationError: null });
      await recordError(`Push token: ${message}`);
      return;
    }
    if (!token) return;

    try {
      await pushTokenRegister({
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        ...(deviceInfo ? { deviceInfo } : {}),
        deviceId: (await deviceId()) ?? undefined,
        appVersion: appVersionLabel(),
        notificationsEnabled: true,
      });
      await storage.set(KEYS.PUSH_TOKEN, token);
      await updateDiagnostics({
        tokenSuffix: token.replace(/\]$/, '').slice(-4),
        tokenError: null,
        registration: 'success',
        registrationError: null,
        registeredAt: new Date().toISOString(),
      });
    } catch (err) {
      const message = errorText(err);
      await updateDiagnostics({ registration: 'failed', registrationError: message });
      await recordError(`Registration: ${message}`);
    }
  } catch (err) {
    // Push is an enhancement. A denied permission, a build without the native
    // module, or an offline server must never interrupt signing in.
    await recordError(errorText(err)).catch(() => {});
  }
}

/**
 * Checks whether the native push layer (FCM on Android, APNs on iOS) hands
 * out a device token. Only for the diagnostics screen; the raw value is
 * never stored or shown.
 */
export async function probeNativePushToken(): Promise<PushDiagnostics> {
  const Notifications = loadNotifications();
  if (!Notifications) {
    return updateDiagnostics({ nativeToken: 'unavailable', nativeTokenError: isExpoGo() ? 'Not available in Expo Go.' : 'Not supported on this platform.' });
  }
  try {
    const native = await Notifications.getDevicePushTokenAsync();
    return updateDiagnostics({ nativeToken: native?.data ? 'available' : 'unavailable', nativeTokenError: null });
  } catch (err) {
    return updateDiagnostics({ nativeToken: 'unavailable', nativeTokenError: errorText(err) });
  }
}

/**
 * Called when the account signs out. The server drops the token with the
 * session it was bound to — but only if the sign-out request reaches it. An
 * offline sign-out leaves the session (and its token) alive server-side, and
 * mobile sessions do not expire on their own, so this handset would keep
 * showing the previous account's messages. Invalidating the native FCM/APNs
 * registration closes that gap without needing the server: the next push to
 * the old token comes back DeviceNotRegistered and the server retires it.
 * The next sign-in obtains a fresh token.
 */
export async function forgetPushRegistration(): Promise<void> {
  await dropRegistration(false);
  const Notifications = loadNotifications();
  if (Notifications) {
    await Notifications.unregisterForNotificationsAsync().catch(() => {});
    // The tray and badge belong to the account that just left.
    await Notifications.dismissAllNotificationsAsync().catch(() => {});
    await Notifications.setBadgeCountAsync(0).catch(() => {});
  }
  await updateDiagnostics({ registration: 'never', registrationError: null, registeredAt: null, tokenSuffix: null });
}

/**
 * Re-syncs registration whenever the app returns to the foreground, so a
 * permission the user changed in system settings is picked up without a
 * restart. Returns a cleanup.
 */
export function watchAppStateForPush(deviceInfo?: string): () => void {
  if (!canReceivePush()) return () => {};
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void syncPushRegistration(deviceInfo, { promptIfNeeded: false });
  });
  return () => subscription.remove();
}
