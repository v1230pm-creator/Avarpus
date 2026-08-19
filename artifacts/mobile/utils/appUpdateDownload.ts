import type { AppUpdate } from '@workspace/api-client-react';
import type {
  BackgroundDownloadSnapshot,
  StoredBackgroundDownload,
} from '@/modules/vmc-background-downloader';

export type PersistedAppUpdateDownload = {
  downloadId: string;
  update: AppUpdate;
  startedAt: string;
};

export type RestoredDownloadState =
  | { phase: 'downloading'; error: null }
  | { phase: 'paused'; error: null }
  | { phase: 'verifying'; error: null }
  | { phase: 'error'; error: string };

export function restoredStateForSnapshot(
  snapshot: BackgroundDownloadSnapshot,
): RestoredDownloadState {
  switch (snapshot.status) {
    case 'pending':
    case 'running':
      return { phase: 'downloading', error: null };
    case 'paused':
      return { phase: 'paused', error: null };
    case 'successful':
      return { phase: 'verifying', error: null };
    case 'failed':
      return {
        phase: 'error',
        error: downloadFailureMessage(snapshot.reason),
      };
    case 'missing':
    default:
      return {
        phase: 'error',
        error: 'The previous update download is no longer available. Please download it again.',
      };
  }
}

export function downloadFailureMessage(reason: number | null): string {
  // Android DownloadManager.ERROR_INSUFFICIENT_SPACE
  if (reason === 1006) {
    return 'Not enough storage space on this device. Free up some space and try again.';
  }
  // DownloadManager pause reasons caused by network availability are surfaced
  // as paused, not failed. All other terminal reasons are safe to retry.
  return 'Download failed. Please check your connection and try again.';
}

export function isPersistedDownloadForBuild(
  value: PersistedAppUpdateDownload | null,
  buildNumber: number,
): boolean {
  return !!value &&
    typeof value.downloadId === 'string' &&
    value.downloadId.length > 0 &&
    value.update?.buildNumber === buildNumber;
}

export function parseStoredBackgroundDownload(
  stored: StoredBackgroundDownload | null,
): PersistedAppUpdateDownload | null {
  if (!stored?.downloadId || !stored.metadataJson) return null;
  try {
    const metadata = JSON.parse(stored.metadataJson) as {
      update?: AppUpdate;
      startedAt?: string;
    };
    const update = metadata.update;
    if (
      !update ||
      !Number.isInteger(update.buildNumber) ||
      update.buildNumber <= 0 ||
      typeof update.apkUrl !== 'string' ||
      !update.apkUrl ||
      typeof update.apkSize !== 'number' ||
      update.apkSize <= 0 ||
      typeof update.checksum !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(update.checksum)
    ) {
      return null;
    }
    return {
      downloadId: stored.downloadId,
      update,
      startedAt:
        typeof metadata.startedAt === 'string'
          ? metadata.startedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}