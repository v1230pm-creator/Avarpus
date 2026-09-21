import { describe, expect, it } from 'vitest';

import { resolveObjectStorageProvider } from './objectStorage';

describe('resolveObjectStorageProvider', () => {
  it('defaults to the Replit sidecar when nothing is configured', () => {
    expect(resolveObjectStorageProvider({})).toBe('replit');
  });

  it('selects gcs when a service-account key file is configured', () => {
    expect(
      resolveObjectStorageProvider({ GCS_SERVICE_ACCOUNT_KEY_FILE: '/etc/avarpus/gcs.json' }),
    ).toBe('gcs');
  });

  it('honours an explicit provider override', () => {
    expect(
      resolveObjectStorageProvider({
        OBJECT_STORAGE_PROVIDER: 'replit',
        GCS_SERVICE_ACCOUNT_KEY_FILE: '/etc/avarpus/gcs.json',
      }),
    ).toBe('replit');
    expect(resolveObjectStorageProvider({ OBJECT_STORAGE_PROVIDER: 'GCS' })).toBe('gcs');
  });

  it('rejects unknown providers instead of silently falling back', () => {
    expect(() => resolveObjectStorageProvider({ OBJECT_STORAGE_PROVIDER: 's3' })).toThrow(
      /OBJECT_STORAGE_PROVIDER/,
    );
  });
});
