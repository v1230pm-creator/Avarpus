import React, { useCallback, useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { isLockEnabled, setUnlocked } from '@/utils/appLock';
import { getInactivityTimeoutMinutes } from '@/utils/sessionPrefs';

const CHECK_INTERVAL_MS = 30 * 1000;

/**
 * Wraps the authenticated area of the app. Tracks user touch activity and,
 * after the configured inactivity period, either locks the app to the
 * PIN/biometric screen (when a lock is set up) or signs the user out.
 */
export function InactivityGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const lastActivityRef = useRef(Date.now());
  const firedRef = useRef(false);

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const handleTimeout = useCallback(async () => {
    if (firedRef.current) return;
    firedRef.current = true;
    try {
      let lockEnabled = true; // fail closed: unknown lock state → lock screen
      try {
        lockEnabled = await isLockEnabled();
      } catch {}
      if (lockEnabled) {
        setUnlocked(false);
        router.replace('/(auth)/biometric');
      } else {
        await logout();
        router.replace('/(auth)');
      }
    } finally {
      // Allow the guard to fire again for the next session
      firedRef.current = false;
      lastActivityRef.current = Date.now();
    }
  }, [logout, router]);

  const checkIdle = useCallback(async () => {
    if (!isAuthenticated) return;
    const minutes = await getInactivityTimeoutMinutes();
    if (minutes <= 0) return;
    const idleMs = Date.now() - lastActivityRef.current;
    if (idleMs >= minutes * 60 * 1000) {
      await handleTimeout();
    }
  }, [isAuthenticated, handleTimeout]);

  // Periodic check while the app is in the foreground
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      checkIdle();
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isAuthenticated, checkIdle]);

  // Check immediately when the app returns to the foreground; time spent in
  // the background counts as inactivity.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkIdle();
      }
    });
    return () => sub.remove();
  }, [checkIdle]);

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        recordActivity();
        return false;
      }}
    >
      {children}
    </View>
  );
}
