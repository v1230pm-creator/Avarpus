import React, { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { isUnlocked, setUnlocked, shouldRelockAfterBackground } from '@/utils/appLock';

/**
 * Re-locks the app when it returns from the background after more than the
 * grace period ({@link shouldRelockAfterBackground}).
 *
 * Only the `background` state starts the timer — iOS reports `inactive` for
 * brief interruptions (permission dialogs, control center, app switcher
 * peeks), which must not force a re-unlock.
 *
 * It only flips the in-memory unlock flag; the (tabs) layout subscribes to
 * lock-state changes, re-reads the lock configuration fail-closed, and
 * redirects to the device-authentication screen when app lock is enabled.
 */
export function BackgroundRelock({ children }: { children: React.ReactNode }) {
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background') {
        if (backgroundedAtRef.current == null) {
          backgroundedAtRef.current = Date.now();
        }
      } else if (state === 'active') {
        const backgroundedAt = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (isUnlocked() && shouldRelockAfterBackground(backgroundedAt, Date.now())) {
          setUnlocked(false);
        }
      }
      // `inactive` is ignored on purpose: it fires for brief interruptions
      // that should not count toward the background grace period.
    });
    return () => sub.remove();
  }, []);

  return <>{children}</>;
}
