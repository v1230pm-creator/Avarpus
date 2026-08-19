import { requireOptionalNativeModule } from 'expo';

export type BackgroundDownloadStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'successful'
  | 'failed'
  | 'missing';

export type BackgroundDownloadSnapshot = {
  downloadId: string;
  status: BackgroundDownloadStatus;
  bytesDownloaded: number;
  totalBytes: number;
  localUri: string | null;
  reason: number | null;
};

type EnqueueOptions = {
  url: string;
  fileName: string;
  headers: Record<string, string>;
  title: string;
  description: string;
  identity: string;
  metadataJson: string;
};

export type StoredBackgroundDownload = {
  downloadId: string;
  identity: string;
  metadataJson: string;
};

type VmcBackgroundDownloaderNativeModule = {
  enqueueAsync(options: EnqueueOptions): Promise<{
    downloadId: string;
    reused: boolean;
  }>;
  getStatusAsync(downloadId: string): Promise<BackgroundDownloadSnapshot>;
  getStoredDownloadAsync(): Promise<StoredBackgroundDownload | null>;
  cancelAsync(downloadId: string): Promise<boolean>;
  openInstallerAsync(downloadId: string): Promise<boolean>;
};

const nativeModule =
  requireOptionalNativeModule<VmcBackgroundDownloaderNativeModule>(
    'VmcBackgroundDownloader',
  );

export function isBackgroundDownloaderAvailable(): boolean {
  return nativeModule !== null;
}

export async function enqueueBackgroundDownload(
  options: EnqueueOptions,
): Promise<{ downloadId: string; reused: boolean }> {
  if (!nativeModule) {
    throw new Error('Background downloader is unavailable in this build');
  }
  return nativeModule.enqueueAsync(options);
}

export async function getStoredBackgroundDownload(): Promise<
  StoredBackgroundDownload | null
> {
  if (!nativeModule) return null;
  return nativeModule.getStoredDownloadAsync();
}

export async function getBackgroundDownloadStatus(
  downloadId: string,
): Promise<BackgroundDownloadSnapshot> {
  if (!nativeModule) {
    throw new Error('Background downloader is unavailable in this build');
  }
  return nativeModule.getStatusAsync(downloadId);
}

export async function cancelBackgroundDownload(
  downloadId: string,
): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.cancelAsync(downloadId);
}

export async function openBackgroundDownloadInstaller(
  downloadId: string,
): Promise<boolean> {
  if (!nativeModule) {
    throw new Error('Background downloader is unavailable in this build');
  }
  return nativeModule.openInstallerAsync(downloadId);
}