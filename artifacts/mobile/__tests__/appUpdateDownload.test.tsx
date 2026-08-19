import {
  downloadFailureMessage,
  isPersistedDownloadForBuild,
  parseStoredBackgroundDownload,
  restoredStateForSnapshot,
  type PersistedAppUpdateDownload,
} from '@/utils/appUpdateDownload';

describe('persistent app update download state', () => {
  it('restores pending and running downloads without restarting them', () => {
    expect(restoredStateForSnapshot({
      downloadId: '42',
      status: 'running',
      bytesDownloaded: 500,
      totalBytes: 1000,
      localUri: null,
      reason: null,
    })).toEqual({ phase: 'downloading', error: null });
  });

  it('moves successful downloads to verification', () => {
    expect(restoredStateForSnapshot({
      downloadId: '42',
      status: 'successful',
      bytesDownloaded: 1000,
      totalBytes: 1000,
      localUri: 'file:///update.apk',
      reason: null,
    })).toEqual({ phase: 'verifying', error: null });
  });

  it('provides a specific storage error', () => {
    expect(downloadFailureMessage(1006)).toMatch(/storage space/i);
  });

  it('only reuses a persisted download for the same build', () => {
    const record = {
      downloadId: '42',
      update: { buildNumber: 17 },
      startedAt: '2026-08-19T10:00:00.000Z',
    } as PersistedAppUpdateDownload;
    expect(isPersistedDownloadForBuild(record, 17)).toBe(true);
    expect(isPersistedDownloadForBuild(record, 18)).toBe(false);
  });

  it('recovers a native-persisted download with complete integrity metadata', () => {
    const parsed = parseStoredBackgroundDownload({
      downloadId: '42',
      identity: `17:${'a'.repeat(64)}`,
      metadataJson: JSON.stringify({
        update: {
          id: 'release-17',
          version: '1.0.4',
          buildNumber: 17,
          apkUrl: '/app-updates/release-17/apk',
          apkSize: 1024,
          checksum: 'a'.repeat(64),
        },
        startedAt: '2026-08-19T10:00:00.000Z',
      }),
    });
    expect(parsed?.downloadId).toBe('42');
    expect(parsed?.update.buildNumber).toBe(17);
  });

  it('rejects native recovery metadata without a valid checksum', () => {
    expect(parseStoredBackgroundDownload({
      downloadId: '42',
      identity: '17:missing',
      metadataJson: JSON.stringify({
        update: {
          buildNumber: 17,
          apkUrl: '/app-updates/release-17/apk',
          apkSize: 1024,
          checksum: null,
        },
      }),
    })).toBeNull();
  });
});