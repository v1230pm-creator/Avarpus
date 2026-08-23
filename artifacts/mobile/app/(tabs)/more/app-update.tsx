import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { sha256 } from 'js-sha256';
import { useColors } from '@/hooks/useColors';
import { FlatCard, useStaggerAnim } from '@/components/ui/Glass';
import { storage, KEYS } from '@/utils/storage';
import { getAppVersion, getAppBuildNumber, formatBytes } from '@/utils/appVersion';
import {
  enqueueBackgroundDownload,
  cancelBackgroundDownload,
  getBackgroundDownloadStatus,
  getStoredBackgroundDownload,
  isBackgroundDownloaderAvailable,
  openBackgroundDownloadInstaller,
} from '@/modules/vmc-background-downloader';
import {
  parseStoredBackgroundDownload,
  restoredStateForSnapshot,
  type PersistedAppUpdateDownload,
} from '@/utils/appUpdateDownload';
import {
  latestAppUpdate,
  appUpdateChangelog,
  type AppUpdate,
} from '@workspace/api-client-react';

// ── OTA App Update screen ───────────────────────────────────────────────────
// User is ALWAYS in control: manual check → view details → download →
// explicit "Install Update". No auto-download, no auto-install, no forced
// restart. The install uses Android's official package installer, which
// preserves all app data (same package + higher versionCode = normal
// in-place update; nothing is uninstalled or wiped).

type DownloadPhase =
  | 'idle'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'ready'
  | 'error';

const UPDATE_TYPE_META: Record<string, { label: string; color: string }> = {
  optional: { label: 'Optional Update', color: '#34D399' },
  recommended: { label: 'Recommended Update', color: '#F59E0B' },
  critical: { label: 'Critical Update', color: '#FB7185' },
};

function releaseNoteLines(notes: unknown): { category: string | null; items: string[] }[] {
  if (!notes) return [];
  if (Array.isArray(notes)) {
    if (notes.every((n) => typeof n === 'string')) {
      return [{ category: null, items: notes as string[] }];
    }
    const out: { category: string | null; items: string[] }[] = [];
    for (const n of notes) {
      if (n && typeof n === 'object' && Array.isArray((n as any).items)) {
        out.push({
          category: typeof (n as any).category === 'string' ? (n as any).category : null,
          items: (n as any).items.filter((i: unknown) => typeof i === 'string'),
        });
      }
    }
    return out;
  }
  return [];
}

// Base64 → bytes without Node's Buffer (not available in React Native).
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charCodeAt(i)] = i;
  return table;
})();
function base64ToBytes(b64: string): Uint8Array {
  let len = b64.length;
  while (len > 0 && (b64[len - 1] === '=' || b64[len - 1] === '\n' || b64[len - 1] === '\r')) len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const c = B64_LOOKUP[b64.charCodeAt(i)];
    if (c < 0) continue;
    acc = (acc << 6) | c;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

// SHA-256 of a (possibly large) file, read in 2 MB base64 chunks so we never
// hold the whole APK in memory.
async function sha256OfFile(
  uri: string,
  totalSize: number,
  shouldContinue: () => boolean = () => true,
): Promise<string> {
  const hash = sha256.create();
  const CHUNK = 2 * 1024 * 1024;
  let position = 0;
  while (position < totalSize) {
    if (!shouldContinue()) throw new Error('verification-cancelled');
    const length = Math.min(CHUNK, totalSize - position);
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position,
      length,
    });
    hash.update(base64ToBytes(b64));
    position += length;
  }
  if (!shouldContinue()) throw new Error('verification-cancelled');
  return hash.hex();
}

export default function AppUpdateScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const anims = useStaggerAnim(4);

  const currentVersion = getAppVersion();
  const currentBuild = getAppBuildNumber();

  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [latest, setLatest] = useState<AppUpdate | null>(null);
  const [changelog, setChangelog] = useState<AppUpdate[] | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);

  const [phase, setPhase] = useState<DownloadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [written, setWritten] = useState(0);
  const [total, setTotal] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [downloadMode, setDownloadMode] = useState<'native' | 'legacy' | null>(null);
  const [downloadActionInFlight, setDownloadActionInFlight] = useState(false);

  const resumableRef = useRef<FileSystem.DownloadResumable | null>(null);
  const speedRef = useRef<{ t: number; bytes: number }>({ t: 0, bytes: 0 });
  const nativeDownloadIdRef = useRef<string | null>(null);
  const nativePollingRef = useRef(false);
  const persistentRecordRef = useRef<PersistedAppUpdateDownload | null>(null);
  const verificationInFlightRef = useRef(false);
  const reconcileInFlightRef = useRef(false);
  const downloadActionInFlightRef = useRef(false);
  const operationGenerationRef = useRef(0);
  const cancelledGenerationRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const isUpdateAvailable = !!latest && latest.buildNumber > currentBuild;
  const typeMeta = UPDATE_TYPE_META[latest?.updateType ?? 'optional'] ?? UPDATE_TYPE_META.optional;
  const persistentDownloaderAvailable =
    Platform.OS === 'android' && isBackgroundDownloaderAvailable();

  const isOperationCurrent = useCallback(
    (generation: number, downloadId?: string) =>
      mountedRef.current &&
      operationGenerationRef.current === generation &&
      (!downloadId || nativeDownloadIdRef.current === downloadId),
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      nativePollingRef.current = false;
    };
  }, []);

  const handleCheck = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChecking(true);
    setCheckError(null);
    try {
      const res = await latestAppUpdate({ buildNumber: currentBuild });
      setLatest(res.update ?? null);
      setChecked(true);
      setLastChecked(new Date());
    } catch (e: any) {
      const offline = !e?.status;
      setCheckError(
        offline
          ? 'Unable to check for updates. Please check your internet connection and try again.'
          : 'Update server is unavailable right now. Please try again later.',
      );
    } finally {
      setChecking(false);
    }
  }, [currentBuild]);

  const loadChangelog = useCallback(async () => {
    setChangelogOpen((o) => !o);
    if (!changelog) {
      try {
        const res = await appUpdateChangelog();
        setChangelog(res.updates);
      } catch {
        setChangelog([]);
      }
    }
  }, [changelog]);

  const onProgress = useCallback(
    (p: FileSystem.DownloadProgressData) => {
      const now = Date.now();
      const prev = speedRef.current;
      if (prev.t && now > prev.t) {
        const instant = ((p.totalBytesWritten - prev.bytes) / (now - prev.t)) * 1000;
        if (instant >= 0) setSpeed((s) => (s ? s * 0.7 + instant * 0.3 : instant));
      }
      speedRef.current = { t: now, bytes: p.totalBytesWritten };
      setWritten(p.totalBytesWritten);
      setTotal(p.totalBytesExpectedToWrite || 0);
      if (p.totalBytesExpectedToWrite > 0) {
        setProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
      }
    },
    [],
  );

  const verifyAndFinish = useCallback(
    async (
      uri: string,
      update: AppUpdate | null,
      generation: number,
      nativeDownloadId?: string,
    ) => {
      if (!isOperationCurrent(generation, nativeDownloadId)) return;
      setPhase('verifying');
      try {
        if (
          !update ||
          typeof update.apkSize !== 'number' ||
          update.apkSize <= 0 ||
          typeof update.checksum !== 'string' ||
          !/^[a-f0-9]{64}$/i.test(update.checksum)
        ) {
          throw new Error('missing-security-metadata');
        }
        const info = await FileSystem.getInfoAsync(uri);
        if (!isOperationCurrent(generation, nativeDownloadId)) return;
        if (!info.exists) throw new Error('missing');
        const size = (info as any).size as number;
        if (size !== update.apkSize) {
          throw new Error('size-mismatch');
        }
        const digest = await sha256OfFile(
          uri,
          size,
          () => isOperationCurrent(generation, nativeDownloadId),
        );
        if (!isOperationCurrent(generation, nativeDownloadId)) return;
        if (digest.toLowerCase() !== update.checksum.toLowerCase()) {
          throw new Error('checksum-mismatch');
        }
        setLocalUri(uri);
        setPhase('ready');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e: any) {
        if (
          e?.message === 'verification-cancelled' ||
          !isOperationCurrent(generation, nativeDownloadId)
        ) {
          return;
        }
        if (nativeDownloadId) {
          await cancelBackgroundDownload(nativeDownloadId).catch(() => false);
          if (!isOperationCurrent(generation, nativeDownloadId)) return;
          await storage.remove(KEYS.APP_UPDATE_DOWNLOAD);
          nativeDownloadIdRef.current = null;
          persistentRecordRef.current = null;
          nativePollingRef.current = false;
        }
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        setPhase('error');
        setDownloadError(
          e?.message === 'missing-security-metadata'
            ? 'This release is missing required security metadata. Please contact the administrator.'
            : e?.message === 'checksum-mismatch' || e?.message === 'size-mismatch'
            ? 'The downloaded file failed the security check (corrupted or incomplete). Please download again.'
            : 'Could not verify the downloaded file. Please try again.',
        );
      }
    },
    [isOperationCurrent],
  );

  const loadNativePersistentDownload = useCallback(async () => {
    const stored = await getStoredBackgroundDownload();
    if (!stored) {
      await storage.remove(KEYS.APP_UPDATE_DOWNLOAD);
      return null;
    }
    const record = parseStoredBackgroundDownload(stored);
    if (!record) {
      await cancelBackgroundDownload(stored.downloadId).catch(() => false);
      await storage.remove(KEYS.APP_UPDATE_DOWNLOAD);
      return null;
    }
    await storage.set(KEYS.APP_UPDATE_DOWNLOAD, record);
    return record;
  }, []);

  const clearPersistentDownload = useCallback(async (cancel = false) => {
    const downloadId =
      nativeDownloadIdRef.current ?? persistentRecordRef.current?.downloadId;
    nativePollingRef.current = false;
    if (cancel && downloadId) {
      await cancelBackgroundDownload(downloadId).catch(() => false);
    }
    await storage.remove(KEYS.APP_UPDATE_DOWNLOAD);
    nativeDownloadIdRef.current = null;
    persistentRecordRef.current = null;
  }, []);

  const reconcilePersistentDownload = useCallback(
    async (recordOverride?: PersistedAppUpdateDownload) => {
      if (!persistentDownloaderAvailable || reconcileInFlightRef.current) return;
      reconcileInFlightRef.current = true;
      const generation = operationGenerationRef.current;
      try {
        const record =
          recordOverride ??
          persistentRecordRef.current ??
          await loadNativePersistentDownload();
        if (!isOperationCurrent(generation) || !record?.downloadId || !record.update) {
          return;
        }

        if (record.update.buildNumber <= currentBuild) {
          persistentRecordRef.current = record;
          nativeDownloadIdRef.current = record.downloadId;
          await clearPersistentDownload(true);
          return;
        }

        persistentRecordRef.current = record;
        nativeDownloadIdRef.current = record.downloadId;
        setDownloadMode('native');
        setLatest(record.update);
        setChecked(true);
        setTotal(record.update.apkSize ?? 0);

        const snapshot = await getBackgroundDownloadStatus(record.downloadId);
        if (!isOperationCurrent(generation, record.downloadId)) return;
        const restored = restoredStateForSnapshot(snapshot);
        const now = Date.now();
        const previous = speedRef.current;
        if (
          previous.t &&
          now > previous.t &&
          snapshot.bytesDownloaded >= previous.bytes
        ) {
          const instant =
            ((snapshot.bytesDownloaded - previous.bytes) / (now - previous.t)) *
            1000;
          setSpeed((value) =>
            value ? value * 0.7 + instant * 0.3 : instant,
          );
        }
        speedRef.current = {
          t: now,
          bytes: snapshot.bytesDownloaded,
        };
        setWritten(snapshot.bytesDownloaded);
        const expectedTotal =
          snapshot.totalBytes || record.update.apkSize || 0;
        setTotal(expectedTotal);
        setProgress(
          expectedTotal > 0
            ? Math.min(1, snapshot.bytesDownloaded / expectedTotal)
            : 0,
        );

        if (snapshot.status === 'successful') {
          nativePollingRef.current = false;
          if (!snapshot.localUri) {
            throw new Error('missing-download-uri');
          }
          if (!verificationInFlightRef.current) {
            verificationInFlightRef.current = true;
            try {
              await verifyAndFinish(
                snapshot.localUri,
                record.update,
                generation,
                record.downloadId,
              );
            } finally {
              verificationInFlightRef.current = false;
            }
          }
          return;
        }

        if (snapshot.status === 'failed' || snapshot.status === 'missing') {
          if (!isOperationCurrent(generation, record.downloadId)) return;
          setPhase('error');
          setDownloadError(restored.error);
          await clearPersistentDownload(true);
          return;
        }

        if (!isOperationCurrent(generation, record.downloadId)) return;
        nativePollingRef.current = true;
        setPhase(restored.phase);
        setDownloadError(null);
      } catch (error) {
        if (!isOperationCurrent(generation)) return;
        if (
          error instanceof Error &&
          error.message === 'missing-download-uri'
        ) {
          await clearPersistentDownload(true);
        }
        setPhase('error');
        setDownloadError(
          'Could not restore the update download. Please download it again.',
        );
      } finally {
        reconcileInFlightRef.current = false;
      }
    },
    [
      clearPersistentDownload,
      currentBuild,
      isOperationCurrent,
      loadNativePersistentDownload,
      persistentDownloaderAvailable,
      verifyAndFinish,
    ],
  );

  useEffect(() => {
    if (!persistentDownloaderAvailable) return;
    void reconcilePersistentDownload();

    const interval = setInterval(() => {
      if (nativePollingRef.current) {
        void reconcilePersistentDownload();
      }
    }, 1500);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void reconcilePersistentDownload();
      }
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [persistentDownloaderAvailable, reconcilePersistentDownload]);

  const handleDownload = useCallback(async () => {
    if (downloadActionInFlightRef.current || !latest?.apkUrl) return;
    if (Platform.OS !== 'android') {
      Alert.alert('Android only', 'APK updates can only be installed on Android devices.');
      return;
    }
    if (
      typeof latest.apkSize !== 'number' ||
      latest.apkSize <= 0 ||
      typeof latest.checksum !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(latest.checksum)
    ) {
      setPhase('error');
      setDownloadError(
        'This release is missing required security metadata. Please contact the administrator.',
      );
      return;
    }

    downloadActionInFlightRef.current = true;
    setDownloadActionInFlight(true);
    const generation = operationGenerationRef.current + 1;
    operationGenerationRef.current = generation;
    cancelledGenerationRef.current = null;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDownloadError(null);
    setProgress(0);
    setWritten(0);
    setSpeed(0);
    speedRef.current = { t: 0, bytes: 0 };
    setTotal(latest.apkSize ?? 0);
    setPhase('downloading');
    try {
      const token = await storage.get<string>(KEYS.AUTH_TOKEN);
      if (!isOperationCurrent(generation)) return;
      const url = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api${latest.apkUrl}`;

      if (persistentDownloaderAvailable) {
        const startedAt = new Date().toISOString();
        const queued = await enqueueBackgroundDownload({
          url,
          fileName: `vmc-update-${latest.buildNumber}-${latest.checksum.slice(0, 12)}.apk`,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          title: `Avarpus v${latest.version}`,
          description: `Downloading build ${latest.buildNumber}`,
          identity: `${latest.buildNumber}:${latest.checksum.toLowerCase()}`,
          metadataJson: JSON.stringify({ update: latest, startedAt }),
        });
        if (!isOperationCurrent(generation)) {
          if (cancelledGenerationRef.current === generation) {
            await cancelBackgroundDownload(queued.downloadId).catch(() => false);
          }
          return;
        }
        const record: PersistedAppUpdateDownload = {
          downloadId: queued.downloadId,
          update: latest,
          startedAt,
        };
        persistentRecordRef.current = record;
        nativeDownloadIdRef.current = queued.downloadId;
        nativePollingRef.current = true;
        setDownloadMode('native');
        await storage.set(KEYS.APP_UPDATE_DOWNLOAD, record);
        if (!isOperationCurrent(generation, queued.downloadId)) {
          await storage.remove(KEYS.APP_UPDATE_DOWNLOAD);
          return;
        }
        await reconcilePersistentDownload(record);
        return;
      }

      setDownloadMode('legacy');
      const dest = `${FileSystem.cacheDirectory}vmc-update-${latest.buildNumber}.apk`;
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
      const resumable = FileSystem.createDownloadResumable(
        url,
        dest,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        onProgress,
      );
      resumableRef.current = resumable;
      const result = await resumable.downloadAsync();
      if (!isOperationCurrent(generation)) return;
      if (result?.uri) {
        if (result.status && result.status !== 200 && result.status !== 206) {
          throw new Error(`http-${result.status}`);
        }
        await verifyAndFinish(result.uri, latest, generation);
      }
      // undefined result = paused/cancelled; state handled elsewhere.
    } catch (e: any) {
      if (!isOperationCurrent(generation)) return;
      setPhase('error');
      setDownloadError(
        String(e?.message ?? '').includes('ENOSPC') || String(e?.message ?? '').includes('space')
          ? 'Not enough storage space on this device. Free up some space and try again.'
          : 'Download failed. Please check your connection and try again.',
      );
    } finally {
      downloadActionInFlightRef.current = false;
      if (mountedRef.current) setDownloadActionInFlight(false);
      if (cancelledGenerationRef.current === generation) {
        cancelledGenerationRef.current = null;
      }
    }
  }, [
    isOperationCurrent,
    latest,
    onProgress,
    persistentDownloaderAvailable,
    reconcilePersistentDownload,
    verifyAndFinish,
  ]);

  const handlePause = useCallback(async () => {
    try {
      await resumableRef.current?.pauseAsync();
      setPhase('paused');
      setSpeed(0);
    } catch {
      // ignore
    }
  }, []);

  const handleResume = useCallback(async () => {
    const resumable = resumableRef.current;
    if (!resumable || downloadActionInFlightRef.current) return;
    downloadActionInFlightRef.current = true;
    setDownloadActionInFlight(true);
    const generation = operationGenerationRef.current + 1;
    operationGenerationRef.current = generation;
    cancelledGenerationRef.current = null;
    setPhase('downloading');
    speedRef.current = { t: 0, bytes: 0 };
    try {
      const result = await resumable.resumeAsync();
      if (!isOperationCurrent(generation)) return;
      if (result?.uri) {
        await verifyAndFinish(result.uri, latest, generation);
      }
    } catch {
      if (!isOperationCurrent(generation)) return;
      setPhase('error');
      setDownloadError('Download interrupted. Please try again.');
    } finally {
      downloadActionInFlightRef.current = false;
      if (mountedRef.current) setDownloadActionInFlight(false);
      if (cancelledGenerationRef.current === generation) {
        cancelledGenerationRef.current = null;
      }
    }
  }, [isOperationCurrent, latest, verifyAndFinish]);

  const handleCancel = useCallback(async () => {
    const cancelledGeneration = operationGenerationRef.current;
    cancelledGenerationRef.current = cancelledGeneration;
    operationGenerationRef.current = cancelledGeneration + 1;
    nativePollingRef.current = false;
    setPhase('idle');
    setProgress(0);
    setWritten(0);
    setSpeed(0);
    setTotal(0);
    setLocalUri(null);
    setDownloadMode(null);

    if (downloadMode === 'native' || nativeDownloadIdRef.current) {
      await clearPersistentDownload(true);
    }
    try {
      await resumableRef.current?.cancelAsync();
    } catch {
      // ignore
    }
    resumableRef.current = null;
  }, [clearPersistentDownload, downloadMode]);

  const handleInstall = useCallback(async () => {
    if (!localUri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (downloadMode === 'native' && nativeDownloadIdRef.current) {
        await openBackgroundDownloadInstaller(nativeDownloadIdRef.current);
      } else {
        const contentUri = await FileSystem.getContentUriAsync(localUri);
        await IntentLauncher.startActivityAsync(
          'android.intent.action.INSTALL_PACKAGE',
          {
            data: contentUri,
            flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
          },
        );
      }
      // Android takes over from here. If the user cancels the installer, they
      // simply return to the app — nothing is changed and no data is touched.
    } catch {
      Alert.alert(
        'Permission needed',
          'To install updates, allow this app to install unknown apps:\n\nSettings → Apps → Special app access → Install unknown apps → Avarpus → Allow.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () =>
              IntentLauncher.startActivityAsync(
                'android.settings.MANAGE_UNKNOWN_APP_SOURCES',
                { data: 'package:com.vmcelectronicerp.app' },
              ).catch(() => {}),
          },
        ],
      );
    }
  }, [downloadMode, localUri]);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const busyDownloading = phase === 'downloading' || phase === 'paused' || phase === 'verifying';

  const notes = releaseNoteLines(latest?.releaseNotes);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          App Update
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Current version */}
        <FlatCard animValue={anims[0]} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={[styles.iconWrap, { backgroundColor: colors.primary + '1A' }]}>
              <Feather name="smartphone" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                Current Version
              </Text>
              <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                v{currentVersion} (Build {currentBuild})
              </Text>
            </View>
          </View>
          {lastChecked && (
            <Text style={[styles.lastChecked, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Last checked: {lastChecked.toLocaleDateString()} {lastChecked.toLocaleTimeString()}
            </Text>
          )}
          <TouchableOpacity
            onPress={handleCheck}
            disabled={checking || busyDownloading}
            activeOpacity={0.8}
            style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: checking || busyDownloading ? 0.6 : 1 }]}
          >
            {checking ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Feather name="refresh-cw" size={16} color="#FFF" />
            )}
            <Text style={[styles.primaryBtnText, { fontFamily: 'Inter_600SemiBold' }]}>
              {checking ? 'Checking…' : 'Check for Updates'}
            </Text>
          </TouchableOpacity>
        </FlatCard>

        {/* Check error */}
        {checkError && (
          <FlatCard animValue={anims[1]} style={styles.card}>
            <View style={styles.rowBetween}>
              <Feather name="wifi-off" size={20} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive, fontFamily: 'Inter_400Regular', flex: 1, marginLeft: 10 }]}>
                {checkError}
              </Text>
            </View>
          </FlatCard>
        )}

        {/* Up to date */}
        {checked && !checkError && !isUpdateAvailable && (
          <FlatCard animValue={anims[1]} style={[styles.card, styles.centerCard]}>
            <View style={[styles.bigIcon, { backgroundColor: '#34D3991A' }]}>
              <Feather name="check-circle" size={30} color="#34D399" />
            </View>
            <Text style={[styles.upToDate, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              You&apos;re on the latest version.
            </Text>
            <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Current Version: {currentVersion}
            </Text>
          </FlatCard>
        )}

        {/* Update available */}
        {checked && isUpdateAvailable && latest && (
          <FlatCard animValue={anims[1]} style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={[styles.iconWrap, { backgroundColor: typeMeta.color + '1A' }]}>
                <Feather name="download-cloud" size={20} color={typeMeta.color} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                  New Update Available
                </Text>
                <View style={[styles.typeBadge, { backgroundColor: typeMeta.color + '1A' }]}>
                  <Text style={[styles.typeBadgeText, { color: typeMeta.color, fontFamily: 'Inter_600SemiBold' }]}>
                    {typeMeta.label}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.metaGrid}>
              <MetaRow label="Version" value={`v${latest.version} (Build ${latest.buildNumber})`} colors={colors} />
              <MetaRow label="Release Date" value={latest.releaseDate ?? '—'} colors={colors} />
              <MetaRow label="Size" value={formatBytes(latest.apkSize)} colors={colors} />
              {latest.minAndroidVersion ? (
                <MetaRow label="Requires Android" value={latest.minAndroidVersion + '+'} colors={colors} />
              ) : null}
            </View>

            {/* What's new */}
            {notes.length > 0 && (
              <View style={[styles.notesBox, { borderColor: colors.border }]}>
                <Text style={[styles.notesTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  What&apos;s New in This Update
                </Text>
                {notes.map((group, gi) => (
                  <View key={gi} style={{ gap: 4 }}>
                    {group.category && (
                      <Text style={[styles.noteCategory, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                        {group.category}
                      </Text>
                    )}
                    {group.items.map((item, ii) => (
                      <View key={ii} style={styles.noteRow}>
                        <View style={[styles.noteDot, { backgroundColor: colors.primary }]} />
                        <Text style={[styles.noteText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                          {item}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}

            {/* Download / progress / install */}
            {phase === 'idle' || phase === 'error' ? (
              <>
                {downloadError && (
                  <Text style={[styles.errorText, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>
                    {downloadError}
                  </Text>
                )}
                <TouchableOpacity
                  onPress={handleDownload}
                  disabled={downloadActionInFlight}
                  activeOpacity={0.8}
                  style={[
                    styles.primaryBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: downloadActionInFlight ? 0.6 : 1,
                    },
                  ]}
                >
                  {downloadActionInFlight ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Feather name="download" size={16} color="#FFF" />
                  )}
                  <Text style={[styles.primaryBtnText, { fontFamily: 'Inter_600SemiBold' }]}>
                    {downloadActionInFlight
                      ? 'Preparing Download...'
                      : phase === 'error'
                        ? 'Retry Download'
                        : 'Download Update'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}

            {(phase === 'downloading' || phase === 'paused') && (
              <View style={{ gap: 10 }}>
                <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                  <View
                    style={[styles.progressFill, { backgroundColor: colors.primary, width: `${Math.min(100, Math.round(progress * 100))}%` }]}
                  />
                </View>
                <View style={styles.rowBetween}>
                  <Text style={[styles.progressText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                    {Math.round(progress * 100)}%
                  </Text>
                  <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    {formatBytes(written)} / {formatBytes(total || latest.apkSize)}
                  </Text>
                </View>
                <View style={styles.rowBetween}>
                  <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                     {phase === 'paused'
                       ? downloadMode === 'native'
                         ? 'Waiting for network'
                         : 'Paused'
                       : `${formatBytes(speed)}/s`}
                  </Text>
                  <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    {formatBytes(Math.max(0, (total || latest.apkSize || 0) - written))} remaining
                  </Text>
                </View>
                 {downloadMode === 'native' && (
                   <View style={styles.verifyRow}>
                     <Feather name="smartphone" size={15} color={colors.primary} />
                     <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', flex: 1 }]}>
                       Android is downloading this update in the background. You can safely close the app.
                     </Text>
                   </View>
                 )}
                <View style={styles.btnRow}>
                   {downloadMode !== 'native' && (
                     phase === 'downloading' ? (
                       <TouchableOpacity onPress={handlePause} style={[styles.smallBtn, { borderColor: colors.border }]} activeOpacity={0.8}>
                         <Feather name="pause" size={15} color={colors.foreground} />
                         <Text style={[styles.smallBtnText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Pause</Text>
                       </TouchableOpacity>
                     ) : (
                       <TouchableOpacity onPress={handleResume} style={[styles.smallBtn, { borderColor: colors.border }]} activeOpacity={0.8}>
                         <Feather name="play" size={15} color={colors.foreground} />
                         <Text style={[styles.smallBtnText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Resume</Text>
                       </TouchableOpacity>
                     )
                   )}
                  <TouchableOpacity onPress={handleCancel} style={[styles.smallBtn, { borderColor: colors.destructive + '55' }]} activeOpacity={0.8}>
                    <Feather name="x" size={15} color={colors.destructive} />
                    <Text style={[styles.smallBtnText, { color: colors.destructive, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {phase === 'verifying' && (
              <View style={styles.verifyRow}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  Verifying update security (SHA-256)…
                </Text>
              </View>
            )}

            {phase === 'ready' && (
              <View style={{ gap: 10 }}>
                <View style={styles.verifyRow}>
                  <Feather name="shield" size={16} color="#34D399" />
                  <Text style={[styles.muted, { color: '#34D399', fontFamily: 'Inter_600SemiBold' }]}>
                    Update Downloaded Successfully — verified
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleInstall}
                  activeOpacity={0.8}
                  style={[styles.primaryBtn, { backgroundColor: '#34D399' }]}
                >
                  <Feather name="package" size={16} color="#FFF" />
                  <Text style={[styles.primaryBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Install Update</Text>
                </TouchableOpacity>
                <Text style={[styles.installHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  Your data is completely safe — this is a normal in-place update. All records, settings and your
                  login stay exactly as they are.
                </Text>
              </View>
            )}
          </FlatCard>
        )}

        {/* Changelog */}
        {checked && !checkError && (
          <FlatCard animValue={anims[2]} style={styles.card}>
            <TouchableOpacity onPress={loadChangelog} style={styles.rowBetween} activeOpacity={0.7}>
              <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                View Full Changelog
              </Text>
              <Feather name={changelogOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
            {changelogOpen && (
              <View style={{ gap: 14, marginTop: 6 }}>
                {changelog === null ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : changelog.length === 0 ? (
                  <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    No previous releases.
                  </Text>
                ) : (
                  changelog.map((rel) => {
                    const relNotes = releaseNoteLines(rel.releaseNotes);
                    return (
                      <View key={rel.id} style={[styles.changelogItem, { borderColor: colors.border }]}>
                        <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                          v{rel.version} (Build {rel.buildNumber})
                        </Text>
                        <Text style={[styles.muted, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                          {rel.releaseDate ?? ''}
                        </Text>
                        {relNotes.map((g, gi) => (
                          <View key={gi} style={{ gap: 3, marginTop: 4 }}>
                            {g.category && (
                              <Text style={[styles.noteCategory, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                                {g.category}
                              </Text>
                            )}
                            {g.items.map((item, ii) => (
                              <View key={ii} style={styles.noteRow}>
                                <View style={[styles.noteDot, { backgroundColor: colors.primary }]} />
                                <Text style={[styles.noteText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                                  {item}
                                </Text>
                              </View>
                            ))}
                          </View>
                        ))}
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </FlatCard>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

function MetaRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={styles.metaRow}>
      <Text style={[styles.metaLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 16 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22 },
  scroll: { padding: 16, gap: 14 },
  card: { padding: 16, gap: 14 },
  centerCard: { alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bigIcon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15 },
  muted: { fontSize: 12.5 },
  lastChecked: { fontSize: 12 },
  upToDate: { fontSize: 17, textAlign: 'center' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 14 },
  primaryBtnText: { color: '#FFF', fontSize: 14.5 },
  typeBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, marginTop: 4 },
  typeBadgeText: { fontSize: 11 },
  metaGrid: { gap: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaLabel: { fontSize: 12.5 },
  metaValue: { fontSize: 13 },
  notesBox: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  notesTitle: { fontSize: 14 },
  noteCategory: { fontSize: 12, marginTop: 4 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  noteDot: { width: 5, height: 5, borderRadius: 3, marginTop: 6 },
  noteText: { fontSize: 12.5, flex: 1, lineHeight: 18 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
  progressText: { fontSize: 14 },
  btnRow: { flexDirection: 'row', gap: 10 },
  smallBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 11, borderRadius: 12, borderWidth: 1 },
  smallBtnText: { fontSize: 13 },
  verifyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { fontSize: 12.5, lineHeight: 18 },
  installHint: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  changelogItem: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 2 },
});
