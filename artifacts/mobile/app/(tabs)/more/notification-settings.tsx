import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  getNotificationPreferencesGetQueryKey,
  getPushDevicesListQueryKey,
  useNotificationPreferencesGet,
  useNotificationPreferencesUpdate,
  usePushDevicesList,
  usePushSendTest,
  type NotificationPreferences,
} from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import {
  appVersionLabel,
  canReceivePush,
  firebaseConfiguredAtBuild,
  getPushDiagnostics,
  getPushPermissionState,
  isExpoGo,
  openSystemNotificationSettings,
  probeNativePushToken,
  setCachedNotificationPreferences,
  subscribePushDiagnostics,
  syncPushRegistration,
  type PushDiagnostics,
  type PushPermissionState,
} from '@/utils/pushNotifications';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

// Settings → Notifications. Preferences are per account and enforced by the
// server at send time, so every device of the account behaves the same; the
// OS permission is per device and is only reported here (the app asks once,
// afterwards the system settings page is the only place to change it).

type PreferenceKey = keyof NotificationPreferences;

const CATEGORY_TOGGLES: Array<{ key: PreferenceKey; title: string; subtitle: string }> = [
  { key: 'messages', title: 'Message notifications', subtitle: 'New chat messages from customers and contacts' },
  { key: 'calls', title: 'Call notifications', subtitle: 'Incoming and missed calls' },
  { key: 'dealer', title: 'Dealer notifications', subtitle: 'Transfer requests, dealer transactions and bills' },
  { key: 'repair', title: 'Repair notifications', subtitle: 'Repair updates and approval requests' },
  { key: 'payments', title: 'Payment notifications', subtitle: 'Payments, refunds and khata entries' },
  { key: 'status', title: 'Status notifications', subtitle: 'Updates about status posts' },
];

const BEHAVIOUR_TOGGLES: Array<{ key: PreferenceKey; title: string; subtitle: string }> = [
  { key: 'showPreview', title: 'Show message preview', subtitle: 'Off: the lock screen shows who wrote, not what' },
  { key: 'sound', title: 'Sound', subtitle: 'Play the Avarpus tone for new alerts' },
  { key: 'vibration', title: 'Vibration', subtitle: 'Vibrate for new alerts' },
];

const DARK_BACKGROUND = '#0B1014';
const DIVIDER = '#1C252A';
const MUTED = '#899399';
const FOREGROUND = '#E9EEF1';

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'never';
  return date.toLocaleString();
}

function permissionLabel(state: PushPermissionState): { label: string; tone: 'on' | 'off' | 'muted' } {
  switch (state) {
    case 'granted':
      return { label: 'Notifications: ON', tone: 'on' };
    case 'denied':
      return { label: 'Notifications: OFF', tone: 'off' };
    case 'undetermined':
      return { label: 'Notifications: not set up', tone: 'muted' };
    default:
      return { label: 'Notifications: unavailable here', tone: 'muted' };
  }
}

function ToggleRow({
  title,
  subtitle,
  value,
  disabled,
  onValueChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowContent}>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, disabled && styles.dimmed]}>{title}</Text>
          {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
        </View>
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onValueChange}
          trackColor={{ false: '#465158', true: '#4F9D78' }}
          thumbColor={value ? '#D6F4E2' : '#AAB4B9'}
          ios_backgroundColor="#465158"
          accessibilityLabel={title}
        />
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const supported = canReceivePush();

  const [permission, setPermission] = useState<PushPermissionState>(supported ? 'undetermined' : 'unsupported');
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [probing, setProbing] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const preferencesQuery = useNotificationPreferencesGet({
    query: { enabled: isAuthenticated, queryKey: getNotificationPreferencesGetQueryKey() },
  });
  const devicesQuery = usePushDevicesList({
    query: { enabled: isAuthenticated && showDiagnostics, queryKey: getPushDevicesListQueryKey() },
  });
  const updateMutation = useNotificationPreferencesUpdate();
  const testMutation = usePushSendTest();

  const preferences = preferencesQuery.data?.preferences ?? null;

  const refreshLocalState = useCallback(async () => {
    const [state, diag] = await Promise.all([getPushPermissionState(), getPushDiagnostics()]);
    setPermission(state);
    setDiagnostics(diag);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshLocalState();
      return subscribePushDiagnostics(setDiagnostics);
    }, [refreshLocalState]),
  );

  useEffect(() => {
    if (preferences) setCachedNotificationPreferences(preferences);
  }, [preferences]);

  const setPreference = useCallback(
    (key: PreferenceKey, value: boolean) => {
      if (!preferences) return;
      const previous = preferences;
      const optimistic = { ...preferences, [key]: value };
      queryClient.setQueryData(getNotificationPreferencesGetQueryKey(), { preferences: optimistic });
      updateMutation.mutate(
        { data: { [key]: value } },
        {
          onSuccess: (result) => {
            queryClient.setQueryData(getNotificationPreferencesGetQueryKey(), result);
          },
          onError: () => {
            queryClient.setQueryData(getNotificationPreferencesGetQueryKey(), { preferences: previous });
          },
        },
      );
    },
    [preferences, queryClient, updateMutation],
  );

  const enableOnThisDevice = useCallback(async () => {
    if (permission === 'denied') {
      await openSystemNotificationSettings();
      return;
    }
    await syncPushRegistration(undefined, { promptIfNeeded: true });
    await refreshLocalState();
  }, [permission, refreshLocalState]);

  const runProbe = useCallback(async () => {
    setProbing(true);
    try {
      await probeNativePushToken();
      await syncPushRegistration(undefined, { promptIfNeeded: false });
      await refreshLocalState();
      await queryClient.invalidateQueries({ queryKey: getPushDevicesListQueryKey() });
    } finally {
      setProbing(false);
    }
  }, [queryClient, refreshLocalState]);

  const sendTest = useCallback(() => {
    setTestResult(null);
    testMutation.mutate(undefined, {
      onSuccess: (result) => {
        setTestResult(
          result.deviceCount === 0
            ? 'Sent to the inbox, but no device is registered for push on this account yet.'
            : `Sent to ${result.deviceCount} device${result.deviceCount === 1 ? '' : 's'}. It should arrive within a few seconds.`,
        );
      },
      onError: (error) => {
        const message = (error as { message?: string })?.message;
        setTestResult(message ? `Could not send: ${message}` : 'Could not send the test notification.');
      },
    });
  }, [testMutation]);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const status = permissionLabel(permission);
  const statusColor = status.tone === 'on' ? '#4F9D78' : status.tone === 'off' ? '#E0685E' : MUTED;
  const prefsDisabled = !preferences || updateMutation.isPending;
  const firebase = firebaseConfiguredAtBuild();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={DARK_BACKGROUND} />
      <View style={[styles.header, { paddingTop: topPad }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to Settings"
        >
          <Feather name="arrow-left" size={25} color={FOREGROUND} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Device permission */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Feather name={status.tone === 'on' ? 'bell' : 'bell-off'} size={20} color={statusColor} />
            <Text style={[styles.statusTitle, { color: statusColor }]}>{status.label}</Text>
          </View>
          {permission === 'granted' ? (
            <Text style={styles.statusBody}>
              This phone can receive Avarpus alerts even when the app is closed.
            </Text>
          ) : permission === 'denied' ? (
            <Text style={styles.statusBody}>
              Notifications are turned off for Avarpus in your phone settings. You will still see
              messages inside the app, but nothing will alert you when the app is closed. Turn them on
              in Settings → Apps → Avarpus → Notifications.
            </Text>
          ) : permission === 'undetermined' ? (
            <Text style={styles.statusBody}>
              Allow notifications so new messages, payments and repair updates reach you when the app
              is closed.
            </Text>
          ) : (
            <Text style={styles.statusBody}>
              {isExpoGo()
                ? 'Push notifications need the installed Avarpus app; they are not available in Expo Go.'
                : 'Push notifications are not available on this platform.'}
            </Text>
          )}
          {supported && permission !== 'granted' ? (
            <TouchableOpacity style={styles.primaryButton} onPress={() => void enableOnThisDevice()} accessibilityRole="button">
              <Text style={styles.primaryButtonText}>
                {permission === 'denied' ? 'Open phone settings' : 'Turn on notifications'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {supported && permission === 'granted' ? (
            <TouchableOpacity style={styles.secondaryButton} onPress={() => void openSystemNotificationSettings()} accessibilityRole="button">
              <Text style={styles.secondaryButtonText}>Phone notification settings</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Preferences */}
        <Text style={styles.sectionHeading}>Alert me about</Text>
        {preferencesQuery.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={MUTED} />
          </View>
        ) : preferencesQuery.isError ? (
          <View style={styles.loadingRow}>
            <Text style={styles.errorText}>Could not load your notification preferences.</Text>
            <TouchableOpacity onPress={() => void preferencesQuery.refetch()} accessibilityRole="button">
              <Text style={styles.linkText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {CATEGORY_TOGGLES.map((item) => (
          <ToggleRow
            key={item.key}
            title={item.title}
            subtitle={item.subtitle}
            value={preferences?.[item.key] ?? true}
            disabled={prefsDisabled}
            onValueChange={(value) => setPreference(item.key, value)}
          />
        ))}

        <View style={styles.divider} />
        <Text style={styles.sectionHeading}>How alerts behave</Text>
        {BEHAVIOUR_TOGGLES.map((item) => (
          <ToggleRow
            key={item.key}
            title={item.title}
            subtitle={item.subtitle}
            value={preferences?.[item.key] ?? true}
            disabled={prefsDisabled}
            onValueChange={(value) => setPreference(item.key, value)}
          />
        ))}
        <Text style={styles.footnote}>
          Account and security alerts are always delivered. Preferences apply to every phone signed in
          to this account.
        </Text>

        {/* Test + diagnostics */}
        <View style={styles.divider} />
        <Text style={styles.sectionHeading}>Check delivery</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.secondaryButton, styles.actionButton]}
            onPress={sendTest}
            disabled={testMutation.isPending || !isAuthenticated}
            accessibilityRole="button"
          >
            {testMutation.isPending ? (
              <ActivityIndicator color={FOREGROUND} />
            ) : (
              <Text style={styles.secondaryButtonText}>Send test notification</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, styles.actionButton]}
            onPress={() => setShowDiagnostics((v) => !v)}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>{showDiagnostics ? 'Hide details' : 'Show details'}</Text>
          </TouchableOpacity>
        </View>
        {testResult ? <Text style={styles.footnote}>{testResult}</Text> : null}

        {showDiagnostics ? (
          <View style={styles.diagnostics}>
            <InfoRow label="App" value={appVersionLabel()} />
            <InfoRow label="Runtime" value={isExpoGo() ? 'Expo Go (no remote push)' : Platform.OS === 'web' ? 'Web (no remote push)' : 'Installed build'} />
            <InfoRow
              label="Firebase config in build"
              value={firebase === null ? 'unknown' : firebase ? 'present' : 'missing — Android push cannot work'}
            />
            <InfoRow label="Phone permission" value={permission} />
            <InfoRow label="Asked for permission" value={diagnostics?.prompted ? 'yes' : 'not yet'} />
            <InfoRow
              label="Native push token"
              value={
                diagnostics?.nativeToken === 'available'
                  ? 'issued'
                  : diagnostics?.nativeToken === 'unavailable'
                    ? `not issued${diagnostics.nativeTokenError ? ` — ${diagnostics.nativeTokenError}` : ''}`
                    : 'not checked'
              }
            />
            <InfoRow
              label="Device token"
              value={diagnostics?.tokenSuffix ? `…${diagnostics.tokenSuffix}` : diagnostics?.tokenError ?? 'none'}
            />
            <InfoRow
              label="Registered with Avarpus"
              value={
                diagnostics?.registration === 'success'
                  ? `yes · ${formatWhen(diagnostics.registeredAt)}`
                  : diagnostics?.registration === 'failed'
                    ? `failed${diagnostics.registrationError ? ` — ${diagnostics.registrationError}` : ''}`
                    : 'not yet'
              }
            />
            <InfoRow label="Last alert received" value={diagnostics?.lastReceivedAt ? `${formatWhen(diagnostics.lastReceivedAt)} (${diagnostics.lastReceivedType ?? 'alert'})` : 'never'} />
            <InfoRow label="Last alert opened" value={formatWhen(diagnostics?.lastOpenedAt)} />
            {diagnostics?.lastError ? (
              <InfoRow label="Last problem" value={`${diagnostics.lastError} · ${formatWhen(diagnostics.lastErrorAt)}`} />
            ) : null}

            <Text style={[styles.sectionHeading, styles.subHeading]}>Devices on this account</Text>
            {devicesQuery.isLoading ? (
              <ActivityIndicator color={MUTED} />
            ) : (devicesQuery.data?.devices ?? []).length === 0 ? (
              <Text style={styles.infoValue}>No device is registered for push yet.</Text>
            ) : (
              (devicesQuery.data?.devices ?? []).map((device) => (
                <View key={`${device.tokenSuffix}-${device.createdAt}`} style={styles.deviceRow}>
                  <Text style={styles.deviceTitle}>
                    {device.platform === 'ios' ? 'iPhone' : 'Android'} · …{device.tokenSuffix}
                    {device.current ? '  (this phone)' : ''}
                  </Text>
                  <Text style={styles.infoValue}>
                    {device.deviceInfo ?? 'Unknown device'}
                    {device.appVersion ? ` · v${device.appVersion}` : ''}
                    {device.notificationsEnabled ? '' : ' · notifications off'}
                  </Text>
                  <Text style={styles.infoValue}>
                    Seen {formatWhen(device.lastSeenAt)} · last push {formatWhen(device.lastSentAt)}
                  </Text>
                  {device.lastError ? (
                    <Text style={styles.errorText}>Last error: {device.lastError}</Text>
                  ) : null}
                </View>
              ))
            )}

            {supported ? (
              <TouchableOpacity style={[styles.secondaryButton, { marginTop: 14 }]} onPress={() => void runProbe()} disabled={probing} accessibilityRole="button">
                {probing ? <ActivityIndicator color={FOREGROUND} /> : <Text style={styles.secondaryButtonText}>Re-check this phone</Text>}
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK_BACKGROUND },
  header: {
    minHeight: 57,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DIVIDER,
  },
  backButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: FOREGROUND, ...font.title, marginLeft: 1 },
  statusCard: {
    marginHorizontal: 16,
    marginTop: 18,
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#121A20',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
  },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusTitle: { ...font.bodyStrong },
  statusBody: { color: MUTED, marginTop: space.md, ...font.caption },
  primaryButton: {
    marginTop: 14,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#006DA8',
  },
  primaryButtonText: { color: '#FFFFFF', ...font.button },
  secondaryButton: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A353C',
    paddingHorizontal: 14,
  },
  secondaryButtonText: { color: FOREGROUND, ...font.button },
  sectionHeading: {
    paddingHorizontal: 25,
    paddingTop: 24,
    paddingBottom: 8,
    fontSize: 15,
    color: MUTED,
    ...font.overline,
  },
  subHeading: { paddingHorizontal: 0, paddingTop: 18 },
  row: { minHeight: 76, paddingHorizontal: 25, justifyContent: 'center' },
  rowContent: { minHeight: 58, flexDirection: 'row', alignItems: 'center' },
  rowCopy: { flex: 1, justifyContent: 'center', paddingVertical: 8, paddingRight: 12 },
  rowTitle: { color: FOREGROUND, ...font.bodyStrong },
  dimmed: { opacity: 0.6 },
  rowSubtitle: { color: MUTED, marginTop: 2, ...font.caption },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 8, backgroundColor: DIVIDER },
  footnote: { color: MUTED, paddingHorizontal: layout.screenPadding, paddingTop: space.md, ...font.small },
  loadingRow: { paddingHorizontal: 25, paddingVertical: 12, gap: 8 },
  errorText: { color: '#E0685E', ...font.caption },
  linkText: { color: '#5FB8FF', ...font.captionStrong },
  actionsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  actionButton: { flex: 1 },
  diagnostics: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#0F161B',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
  },
  infoRow: { paddingVertical: 6 },
  infoLabel: { color: MUTED, ...font.overline },
  infoValue: { color: FOREGROUND, marginTop: 2, ...font.caption },
  deviceRow: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: DIVIDER },
  deviceTitle: { color: FOREGROUND, ...font.captionStrong },
});
