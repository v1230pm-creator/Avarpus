import React, { useCallback } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import * as Network from 'expo-network';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  customFetch,
  driveBackupOauthStart,
  getDriveBackupGetQueryKey,
  useDriveBackupAccountDisconnect,
  useDriveBackupGet,
  useDriveBackupSettingsUpdate,
  type DriveBackupStatus,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  bytesToBase64,
  decryptDriveBackup,
  encryptDriveBackup,
} from '@/utils/driveBackupCrypto';

const GOOGLE_STORAGE_URL = 'https://one.google.com/storage/management';
const OAUTH_RETURN_URL = 'avarpus://google-backup';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

type BackupPreparation = {
  archiveBase64: string;
  accessToken: string;
  existingFileId: string | null;
  driveEtag: string | null;
  uploadLeaseToken: string;
  encryptionSalt: string | null;
};

type RecoveryPreparation = {
  accessToken: string;
  fileId: string;
  encryptionSalt: string;
};

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

export default function ChatBackupScreen() {
  const colors = useColors();
  const { confirm } = useConfirmDialog();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [encryptionDialog, setEncryptionDialog] = React.useState<
    'setup' | 'run' | 'verify' | null
  >(null);
  const [recoveryPassword, setRecoveryPassword] = React.useState('');
  const [recoveryPasswordConfirmation, setRecoveryPasswordConfirmation] = React.useState('');
  const [recoveryPasswordError, setRecoveryPasswordError] = React.useState<string | null>(null);
  const [backupPending, setBackupPending] = React.useState(false);
  const [recoveryPending, setRecoveryPending] = React.useState(false);
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
  const disconnectMutation = useDriveBackupAccountDisconnect({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getDriveBackupGetQueryKey() });
      },
      onError: () => Alert.alert('Could not disconnect', 'Please try again.'),
    },
  });

  const status = statusQuery.data;
  const backupMutation = { isPending: backupPending };
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

  const uploadEncryptedArchive = useCallback(async (
    encryptedBytes: Uint8Array,
    accessToken: string,
    existingFileId: string | null,
    driveEtag: string | null,
  ): Promise<{ id: string; size: string }> => {
    const target = existingFileId
      ? `${DRIVE_UPLOAD}/${encodeURIComponent(existingFileId)}?uploadType=media&fields=id,size`
      : `${DRIVE_UPLOAD}?uploadType=media&fields=id,size`;
    const response = await fetch(target, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        ...(existingFileId && driveEtag ? { 'If-Match': driveEtag } : {}),
      },
      body: new Blob([encryptedBytes as unknown as BlobPart]),
    });
    if (!response.ok) throw new Error(`Google Drive upload failed (HTTP ${response.status}).`);
    const uploaded = await response.json() as { id: string; size?: string };
    const metadataResponse = await fetch(`${DRIVE_FILES}/${encodeURIComponent(uploaded.id)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Avarpus Chat Backup.avb',
        mimeType: 'application/octet-stream',
        appProperties: {
          source: 'avarpus-chat-backup',
          version: '2',
          encrypted: 'true',
        },
      }),
    });
    if (!metadataResponse.ok) throw new Error('Google Drive could not finalize the backup file.');
    return { id: uploaded.id, size: uploaded.size ?? String(encryptedBytes.byteLength) };
  }, []);

  const performBackup = useCallback(async (password: string, enabling = false) => {
    setBackupPending(true);
    try {
      const prepared = await customFetch<BackupPreparation>('/api/drive-backup/prepare', {
        method: 'POST',
        responseType: 'json',
      });
      const encrypted = encryptDriveBackup(
        prepared.archiveBase64,
        password,
        prepared.encryptionSalt,
      );
      const uploaded = await uploadEncryptedArchive(
        encrypted.encryptedBytes,
        prepared.accessToken,
        prepared.existingFileId,
        prepared.driveEtag,
      );
      const nextStatus = await customFetch<DriveBackupStatus>('/api/drive-backup/complete', {
        method: 'POST',
        responseType: 'json',
        body: JSON.stringify({
          fileId: uploaded.id,
          sizeBytes: uploaded.size,
          encryptionSalt: encrypted.salt,
          encryptionVerifier: encrypted.verifier,
          uploadLeaseToken: prepared.uploadLeaseToken,
        }),
      });
      updateCachedStatus(nextStatus);
      setEncryptionDialog(null);
      setRecoveryPasswordConfirmation('');
      setRecoveryPassword('');
      Alert.alert(
        enabling ? 'Encryption enabled' : 'Backup complete',
        enabling
          ? 'Your Drive backup is now encrypted on this device before upload. Encrypted backups are manual so the recovery password is never stored. Write it down: Avarpus cannot recover or reset it.'
          : 'Your chats were encrypted on this device and backed up to Google Drive.',
      );
    } catch (error) {
      Alert.alert(
        enabling ? 'Could not enable encryption' : 'Backup failed',
        error instanceof Error ? error.message : 'Please check your connection and try again.',
      );
    } finally {
      setBackupPending(false);
    }
  }, [updateCachedStatus, uploadEncryptedArchive]);

  const runBackup = useCallback(async () => {
    if (!status?.connected) return;
    if (!(await canRunOnCurrentNetwork())) return;
    if (!status.encryptionEnabled) {
      setRecoveryPassword('');
      setRecoveryPasswordConfirmation('');
      setRecoveryPasswordError(null);
      setEncryptionDialog('setup');
      return;
    }
    if (recoveryPassword.length === 0) {
      setEncryptionDialog('run');
      return;
    }
    await performBackup(recoveryPassword);
  }, [
    canRunOnCurrentNetwork,
    performBackup,
    recoveryPassword,
    status?.connected,
    status?.encryptionEnabled,
  ]);

  const recoverBackup = useCallback(async () => {
    setRecoveryPending(true);
    try {
      const prepared = await customFetch<RecoveryPreparation>('/api/drive-backup/recovery/prepare', {
        method: 'POST',
        responseType: 'json',
      });
      const response = await fetch(
        `${DRIVE_FILES}/${encodeURIComponent(prepared.fileId)}?alt=media`,
        { headers: { Authorization: `Bearer ${prepared.accessToken}` } },
      );
      if (!response.ok) throw new Error(`Google Drive download failed (HTTP ${response.status}).`);
      const encryptedBytes = new Uint8Array(await response.arrayBuffer());
      const archive = decryptDriveBackup(
        encryptedBytes,
        recoveryPassword,
        prepared.encryptionSalt,
      );
      const parsed = JSON.parse(new TextDecoder().decode(archive)) as Record<string, unknown>;
      if (parsed.format !== 'avarpus-chat-backup' || parsed.version !== 1) {
        throw new Error('The decrypted file is not a valid Avarpus chat backup.');
      }
      const filename = `Avarpus-Chat-Backup-${new Date().toISOString().slice(0, 10)}.json`;
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([archive as unknown as BlobPart], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const uri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(uri, bytesToBase64(archive), {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error('File sharing is not available on this device.');
        }
        await Sharing.shareAsync(uri, {
          mimeType: 'application/json',
          dialogTitle: 'Save recovered Avarpus chat backup',
        });
      }
      setEncryptionDialog(null);
      setRecoveryPassword('');
      Alert.alert('Backup recovered', 'The decrypted chat archive is ready to save or share.');
    } catch (error) {
      Alert.alert(
        'Could not recover backup',
        error instanceof Error ? error.message : 'The encrypted backup could not be opened.',
      );
    } finally {
      setRecoveryPending(false);
    }
  }, [recoveryPassword]);

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
    Alert.alert(
      'Manual backups only',
      'End-to-end encrypted backups run only when you enter the recovery password. Avarpus never stores it.',
    );
  }, [status]);

  const manageAccount = useCallback(() => {
    confirm({
      title: status?.email ?? 'Google Account',
      message: 'Manage the account used for chat backup.',
      caption: null,
      icon: 'cloud-off',
      actions: [
        {
          label: 'Disconnect',
          description: 'Stop backing up chats to this account',
          icon: 'cloud-off',
          tone: 'destructive',
          onPress: () => disconnectMutation.mutateAsync(),
        },
        {
          label: 'Change account',
          description: 'Back up to a different Google account',
          icon: 'refresh-cw',
          tone: 'neutral',
          onPress: () => addGoogleAccount(),
        },
      ],
    });
  }, [addGoogleAccount, confirm, disconnectMutation, status?.email]);

  const openEncryptionDialog = useCallback(() => {
    if (!status) return;
    if (status.encryptionEnabled) {
      Alert.alert(
        'Encrypted backup',
        'Your recovery password is never stored by Avarpus. If you lose it, existing encrypted backups cannot be restored and the password cannot be reset.',
        [
          {
            text: 'Recover backup file',
            onPress: () => {
              setRecoveryPassword('');
              setEncryptionDialog('verify');
            },
          },
          { text: 'Close', style: 'cancel' },
        ],
      );
      return;
    }
    setRecoveryPassword('');
    setRecoveryPasswordConfirmation('');
      setRecoveryPasswordError(null);
    setEncryptionDialog('setup');
  }, [status]);

  const submitEncryptionDialog = useCallback(() => {
    if (encryptionDialog === 'setup') {
      if (recoveryPassword.length < 12) {
        setRecoveryPasswordError('Use at least 12 characters for your recovery password.');
        return;
      }
      if (recoveryPassword !== recoveryPasswordConfirmation) {
        setRecoveryPasswordError('Enter the same recovery password twice.');
        return;
      }
      setRecoveryPasswordError(null);
      void performBackup(recoveryPassword, true);
      return;
    }
    if (encryptionDialog === 'run' && recoveryPassword.length > 0) {
      if (recoveryPassword.length < 12) {
        setRecoveryPasswordError('Use at least 12 characters for your recovery password.');
        return;
      }
      void performBackup(recoveryPassword);
      return;
    }
    if (encryptionDialog === 'verify' && recoveryPassword.length > 0) {
      void recoverBackup();
    }
  }, [
    encryptionDialog,
    performBackup,
    recoverBackup,
    recoveryPassword,
    recoveryPasswordConfirmation,
  ]);

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
          <AvarpusSpinner size={20} style={styles.loader} color={colors.success} />
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
                <AvarpusSpinner size={20} color={colors.background} />
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
                  Manual only — recovery password is never stored
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
              onPress={openEncryptionDialog}
            >
              <Feather name="lock" size={22} color={colors.mutedForeground} />
              <View style={styles.encryptionCopy}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  End-to-end encrypted backup
                </Text>
                <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                  {status.encryptionEnabled ? 'On · Recovery password protected' : 'Off'}
                </Text>
              </View>
              <Feather
                name="chevron-right"
                size={20}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={encryptionDialog !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEncryptionDialog(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {encryptionDialog === 'setup'
                ? 'Set recovery password'
                : encryptionDialog === 'verify'
                  ? 'Recover backup'
                  : 'Enter recovery password'}
            </Text>
            <Text style={[styles.modalDescription, { color: colors.mutedForeground }]}>
              {encryptionDialog === 'setup'
                ? 'This password encrypts your backup before upload. Avarpus cannot recover it, so save it somewhere safe.'
                : encryptionDialog === 'verify'
                  ? 'The encrypted Drive backup will be decrypted only on this device, then opened as a JSON file you can save or share.'
                : 'This password is required to encrypt this backup. It is not saved by Avarpus.'}
            </Text>
            <TextInput
              value={recoveryPassword}
              onChangeText={(value) => {
                setRecoveryPassword(value);
                setRecoveryPasswordError(null);
              }}
              placeholder="Recovery password"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.passwordInput,
                { color: colors.foreground, borderColor: colors.border },
              ]}
              accessibilityLabel="Recovery password"
            />
            {encryptionDialog === 'setup' ? (
              <TextInput
                value={recoveryPasswordConfirmation}
                onChangeText={(value) => {
                  setRecoveryPasswordConfirmation(value);
                  setRecoveryPasswordError(null);
                }}
                placeholder="Confirm recovery password"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.passwordInput,
                  { color: colors.foreground, borderColor: colors.border },
                ]}
                accessibilityLabel="Confirm recovery password"
              />
            ) : null}
            {recoveryPasswordError ? (
              <Text
                style={[styles.validationError, { color: colors.destructive }]}
                accessibilityRole="alert"
              >
                {recoveryPasswordError}
              </Text>
            ) : null}
            <Text style={[styles.warningText, { color: colors.destructive }]}>
              Lost passwords cannot be recovered. Existing encrypted backups will be permanently inaccessible.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setEncryptionDialog(null)}
                style={styles.modalCancel}
                disabled={
                  recoveryPending ||
                  backupMutation.isPending
                }
              >
                <Text style={[styles.modalCancelText, { color: colors.mutedForeground }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitEncryptionDialog}
                style={[styles.modalSubmit, { backgroundColor: colors.success }]}
                disabled={
                  recoveryPending ||
                  backupMutation.isPending
                }
              >
                {recoveryPending ||
                backupMutation.isPending ? (
                  <AvarpusSpinner size={20} color={colors.background} />
                ) : (
                  <Text style={[styles.modalSubmitText, { color: colors.background }]}>
                    {encryptionDialog === 'setup'
                      ? 'Enable'
                      : encryptionDialog === 'verify'
                        ? 'Recover'
                        : 'Back up'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  modalCard: {
    borderRadius: 16,
    padding: 22,
    gap: 12,
  },
  modalTitle: { fontSize: 20, fontFamily: 'Inter_600SemiBold' },
  modalDescription: { fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' },
  passwordInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  },
  warningText: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_500Medium' },
  validationError: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_500Medium' },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 18,
    marginTop: 4,
  },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 4 },
  modalCancelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  modalSubmit: {
    minWidth: 92,
    minHeight: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalSubmitText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});