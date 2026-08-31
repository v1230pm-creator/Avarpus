import React, { useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import * as Network from 'expo-network';
import {
  driveBackupOauthStart,
  getDriveBackupGetQueryKey,
  useDriveBackupAccountDisconnect,
  useDriveBackupGet,
  useDriveBackupRun,
  useDriveBackupSettingsUpdate,
  type DriveBackupFrequency,
  type DriveBackupStatus,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

const GOOGLE_STORAGE_URL = 'https://one.google.com/storage/management';
const OAUTH_RETURN_URL = 'vmcelectronicerp://google-backup';

function formatBytes(value: string | null | undefined): string {
  if (!value) return '0 B';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const digits = amount >= 10 || unit === 0 ? 0 : 1;
  return `${amount.toFixed(digits)} ${units[unit]}`;
}

function formatBackupTime(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return date.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function frequencyLabel(value: DriveBackupFrequency): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function ChatBackupScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const automaticRunAttempted = useRef(false);
  const statusQuery = useDriveBackupGet({
    query: {
      queryKey: getDriveBackupGetQueryKey(),
      staleTime: 30_000,
      retry: 1,
    },
  });

  const updateCachedStatus = useCallback(
    (status: DriveBackupStatus) => {
      queryClient.setQueryData(getDriveBackupGetQueryKey(), status);
    },
    [queryClient],
  );

  const settingsMutation = useDriveBackupSettingsUpdate({
    mutation: {
      onSuccess: updateCachedStatus,
      onError: () => Alert.alert('Could not save', 'Please check your connection and try again.'),
    },
  });
  const backupMutation = useDriveBackupRun({
    mutation: {
      onSuccess: (status) => {
        updateCachedStatus(status);
        Alert.alert('Backup complete', 'Your chats were backed up to your Google Drive.');
      },
      onError: () => Alert.alert('Backup failed', 'Your chats could not be backed up. Please try again.'),
    },
  });
  const disconnectMutation = useDriveBackupAccountDisconnect({
    mutation: {
      onSuccess: () => {
        automaticRunAttempted.current = false;
        void queryClient.invalidateQueries({ queryKey: getDriveBackupGetQueryKey() });
      },
      onError: () => Alert.alert('Could not disconnect', 'Please try again.'),
    },
  });

  const status = statusQuery.data;
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const canRunOnCurrentNetwork = useCallback(async (): Promise<boolean> => {
    if (status?.allowCellular !== false) return true;
    const network = await Network.getNetworkStateAsync();
    if (network.type === Network.NetworkStateType.CELLULAR) {
      Alert.alert('Wi-Fi required', 'Back up using cellular is turned off. Connect to Wi-Fi and try again.');
      return false;
    }
    return true;
  }, [status?.allowCellular]);

  const runBackup = useCallback(async () => {
    if (!status?.connected) return;
    if (!(await canRunOnCurrentNetwork())) return;
    backupMutation.mutate();
  }, [backupMutation, canRunOnCurrentNetwork, status?.connected]);

  useEffect(() => {
    if (
      status?.connected &&
      status.backupDue &&
      !automaticRunAttempted.current &&
      !backupMutation.isPending
    ) {
      automaticRunAttempted.current = true;
      void runBackup();
    }
  }, [backupMutation.isPending, runBackup, status?.backupDue, status?.connected]);

  const addGoogleAccount = useCallback(async () => {
    try {
      const { url } = await driveBackupOauthStart();
      const result = await WebBrowser.openAuthSessionAsync(url, OAUTH_RETURN_URL);
      if (result.type === 'success') {
        await statusQuery.refetch();
      } else if (result.type !== 'cancel' && result.type !== 'dismiss') {
        Alert.alert('Google account not added', 'The Google sign-in flow did not finish.');
      }
    } catch {
      Alert.alert('Google account not added', 'Could not start Google sign-in. Please try again.');
    }
  }, [statusQuery]);

  const saveSettings = useCallback(
    (change: Partial<Pick<DriveBackupStatus, 'automaticFrequency' | 'allowCellular' | 'includeVideos'>>) => {
      if (!status) return;
      settingsMutation.mutate({
        data: {
          automaticFrequency: change.automaticFrequency ?? status.automaticFrequency,
          allowCellular: change.allowCellular ?? status.allowCellular,
          includeVideos: change.includeVideos ?? status.includeVideos,
        },
      });
    },
    [settingsMutation, status],
  );

  const chooseFrequency = useCallback(() => {
    if (!status) return;
    const values: DriveBackupFrequency[] = ['never', 'daily', 'weekly', 'monthly'];
    Alert.alert('Automatic backups', 'Choose how often chats should be backed up.', [
      ...values.map((value) => ({
        text: frequencyLabel(value),
        onPress: () => saveSettings({ automaticFrequency: value }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [saveSettings, status]);

  const manageAccount = useCallback(() => {
    Alert.alert(status?.email ?? 'Google Account', 'Manage the account used for chat backup.', [
      { text: 'Change account', onPress: () => void addGoogleAccount() },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => disconnectMutation.mutate(),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [addGoogleAccount, disconnectMutation, status?.email]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 12, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Chat backup</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Backup settings</Text>
        <Text style={[styles.description, { color: colors.mutedForeground }]}>
          Back up your chats and media to Google Drive so you don't lose them when you get a new
          Android phone.
        </Text>

        {statusQuery.isLoading ? (
          <ActivityIndicator style={styles.loader} color={colors.success} />
        ) : statusQuery.isError ? (
          <TouchableOpacity style={styles.retryBlock} onPress={() => void statusQuery.refetch()}>
            <Text style={[styles.errorText, { color: colors.destructive }]}>
              Backup settings could not be loaded.
            </Text>
            <Text style={[styles.retryText, { color: colors.primary }]}>Tap to retry</Text>
          </TouchableOpacity>
        ) : status ? (
          <>
            <View style={styles.backupSummary}>
              <Text style={[styles.summaryText, { color: colors.foreground }]}>
                Last Backup: {formatBackupTime(status.lastBackupAt)}
              </Text>
              <Text style={[styles.summaryText, { color: colors.foreground }]}>
                Size: {formatBytes(status.lastBackupSizeBytes)}
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.backupButton,
                { backgroundColor: colors.success, opacity: backupMutation.isPending ? 0.65 : 1 },
              ]}
              disabled={backupMutation.isPending}
              onPress={status.connected ? () => void runBackup() : () => void addGoogleAccount()}
              accessibilityRole="button"
              accessibilityLabel={status.connected ? 'Back up chats now' : 'Add Google account'}
            >
              {backupMutation.isPending ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text style={[styles.backupButtonText, { color: colors.background }]}>
                  {status.connected ? 'Back up' : 'Add account'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.accountBlock}
              onPress={status.connected ? manageAccount : () => void addGoogleAccount()}
              accessibilityRole="button"
              accessibilityLabel={status.connected ? 'Manage Google backup account' : 'Add Google account'}
            >
              <Text style={[styles.accountTitle, { color: colors.foreground }]}>Google Account</Text>
              <Text style={[styles.accountSubtitle, { color: status.email ? colors.mutedForeground : colors.primary }]}>
                {status.email ?? 'Add Google account'}
              </Text>
            </TouchableOpacity>

            {status.connected && status.email ? (
              <TouchableOpacity
                style={styles.storageBlock}
                onPress={() => void Linking.openURL(GOOGLE_STORAGE_URL)}
                accessibilityRole="link"
                accessibilityLabel="Manage Google storage"
              >
                <Text style={[styles.storageTitle, { color: colors.success }]}>Manage Google storage</Text>
                <Text style={[styles.accountSubtitle, { color: colors.mutedForeground }]}>
                  {status.quota?.usageBytes && status.quota?.limitBytes
                    ? `${formatBytes(status.quota.usageBytes)} of ${formatBytes(status.quota.limitBytes)} used`
                    : 'Storage usage unavailable'}
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={styles.settingRow} onPress={chooseFrequency}>
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>Automatic backups</Text>
                <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                  {frequencyLabel(status.automaticFrequency)}
                </Text>
              </View>
            </TouchableOpacity>

            <View style={styles.settingRow}>
              <Text style={[styles.rowTitle, styles.rowCopy, { color: colors.foreground }]}>
                Back up using cellular
              </Text>
              <Switch
                value={status.allowCellular}
                onValueChange={(value) => saveSettings({ allowCellular: value })}
                disabled={settingsMutation.isPending}
                trackColor={{ false: colors.backgroundSecondary, true: colors.success }}
                thumbColor={status.allowCellular ? colors.foreground : colors.mutedForeground}
                accessibilityLabel="Back up using cellular"
              />
            </View>

            <View style={styles.settingRow}>
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>Include video in chats</Text>
                <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                  {status.includeVideos ? 'Included in future video-message backups' : 'Not included'}
                </Text>
              </View>
              <Switch
                value={status.includeVideos}
                onValueChange={(value) => saveSettings({ includeVideos: value })}
                disabled={settingsMutation.isPending}
                trackColor={{ false: colors.backgroundSecondary, true: colors.success }}
                thumbColor={status.includeVideos ? colors.foreground : colors.mutedForeground}
                accessibilityLabel="Include video in chats"
              />
            </View>

            {status.lastError ? (
              <Text style={[styles.inlineError, { color: colors.destructive }]}>{status.lastError}</Text>
            ) : null}

            <View style={[styles.divider, { borderTopColor: colors.border }]} />
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              End-to-end encryption
            </Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              For added security, you can protect your backup with end-to-end encryption.
            </Text>
            <TouchableOpacity
              style={styles.encryptionRow}
              onPress={() =>
                Alert.alert(
                  'End-to-end encrypted backup',
                  'This requires a recovery password and restore flow. It remains off until both are available, so Avarpus does not make a false encryption claim.',
                )
              }
            >
              <Feather name="lock" size={22} color={colors.mutedForeground} />
              <View style={styles.encryptionCopy}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  End-to-end encrypted backup
                </Text>
                <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>Off</Text>
              </View>
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: { padding: 10 },
  headerTitle: {
    fontSize: 20,
    marginLeft: 8,
    fontFamily: 'Inter_500Medium',
  },
  sectionLabel: {
    fontSize: 14,
    marginTop: 18,
    paddingHorizontal: 17,
    fontFamily: 'Inter_400Regular',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 17,
    marginTop: 2,
    fontFamily: 'Inter_400Regular',
  },
  loader: { marginVertical: 42 },
  retryBlock: { padding: 24, alignItems: 'center' },
  errorText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  retryText: { marginTop: 8, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  backupSummary: { marginTop: 20, paddingHorizontal: 17, gap: 5 },
  summaryText: { fontSize: 15, fontFamily: 'Inter_400Regular' },
  backupButton: {
    minWidth: 106,
    height: 43,
    borderRadius: 22,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 17,
    marginTop: 26,
    paddingHorizontal: 24,
  },
  backupButtonText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  accountBlock: { paddingHorizontal: 17, marginTop: 31, paddingVertical: 5 },
  accountTitle: { fontSize: 16, fontFamily: 'Inter_400Regular' },
  accountSubtitle: { fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' },
  storageBlock: { paddingHorizontal: 17, marginTop: 28, paddingVertical: 5 },
  storageTitle: { fontSize: 15, fontFamily: 'Inter_400Regular' },
  settingRow: {
    minHeight: 74,
    paddingVertical: 12,
    paddingHorizontal: 17,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  rowCopy: { flex: 1, paddingRight: 14 },
  rowTitle: { fontSize: 16, lineHeight: 21, fontFamily: 'Inter_400Regular' },
  rowSubtitle: { fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' },
  inlineError: {
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 17,
    marginTop: 4,
    fontFamily: 'Inter_400Regular',
  },
  divider: { marginTop: 12, borderTopWidth: 1 },
  encryptionRow: {
    minHeight: 86,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 28,
  },
  encryptionCopy: { flex: 1 },
});