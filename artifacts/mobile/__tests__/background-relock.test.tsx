/**
 * Returning from the background after the grace period must re-lock the app;
 * brief interruptions (permission dialogs, quick app switches) must not.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/utils/secureStorage', () => ({
  __esModule: true,
  secureGetItem: jest.fn(async () => null),
  secureSetItem: jest.fn(async () => {}),
  secureDeleteItem: jest.fn(async () => {}),
}));

import React from 'react';
import { AppState, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { BackgroundRelock } from '@/components/BackgroundRelock';
import {
  BACKGROUND_RELOCK_GRACE_MS,
  isUnlocked,
  setUnlocked,
  shouldRelockAfterBackground,
} from '@/utils/appLock';

describe('shouldRelockAfterBackground', () => {
  it('does not relock when the app never entered background', () => {
    expect(shouldRelockAfterBackground(null, 999_999_999)).toBe(false);
  });

  it('does not relock within the grace period', () => {
    expect(shouldRelockAfterBackground(1_000, 1_000 + BACKGROUND_RELOCK_GRACE_MS - 1)).toBe(false);
  });

  it('relocks once the grace period has elapsed', () => {
    expect(shouldRelockAfterBackground(1_000, 1_000 + BACKGROUND_RELOCK_GRACE_MS)).toBe(true);
    expect(shouldRelockAfterBackground(1_000, 1_000 + BACKGROUND_RELOCK_GRACE_MS * 10)).toBe(true);
  });
});

describe('BackgroundRelock', () => {
  let appStateHandler: ((state: string) => void) | null = null;
  let addListenerSpy: jest.SpyInstance;
  let nowSpy: jest.SpyInstance;
  let now = 1_000_000;

  beforeEach(() => {
    now = 1_000_000;
    appStateHandler = null;
    addListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type: any, handler: any) => {
        appStateHandler = handler;
        return { remove: jest.fn() } as any;
      });
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    setUnlocked(true);
  });

  afterEach(() => {
    addListenerSpy.mockRestore();
    nowSpy.mockRestore();
    setUnlocked(false);
  });

  function mount() {
    render(
      <BackgroundRelock>
        <Text>child</Text>
      </BackgroundRelock>,
    );
    expect(appStateHandler).not.toBeNull();
  }

  it('re-locks after backgrounding beyond the grace period', () => {
    mount();
    appStateHandler!('background');
    now += BACKGROUND_RELOCK_GRACE_MS + 1_000;
    appStateHandler!('active');
    expect(isUnlocked()).toBe(false);
  });

  it('stays unlocked after a brief background stint', () => {
    mount();
    appStateHandler!('background');
    now += 2_000; // well under the grace period
    appStateHandler!('active');
    expect(isUnlocked()).toBe(true);
  });

  it('ignores inactive blips (e.g. permission dialogs) entirely', () => {
    mount();
    appStateHandler!('inactive');
    now += BACKGROUND_RELOCK_GRACE_MS * 10;
    appStateHandler!('active');
    expect(isUnlocked()).toBe(true);
  });

  it('measures from when the app first entered background', () => {
    mount();
    appStateHandler!('background');
    now += BACKGROUND_RELOCK_GRACE_MS - 5_000;
    // iOS can report inactive between background and active; timer keeps running.
    appStateHandler!('inactive');
    now += 5_000;
    appStateHandler!('active');
    expect(isUnlocked()).toBe(false);
  });
});
