import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import { AVARPUS_BLUE } from '@/constants/brand';

/**
 * Startup splash.
 *
 * Deliberately minimal: the native splash and this screen share one flat
 * background colour, so opening the app reads as a single uninterrupted
 * surface instead of a sequence of loading screens.
 *
 * The splash never blocks on decorative work. It shows the brand mark, waits
 * only for `loadingReady` (auth/lock resolution) plus a short minimum so the
 * mark cannot flicker, then fades the mark out and hands off.
 *
 * Only the mark and footer fade. The background stays fully opaque until the
 * component unmounts, so the navigator surface underneath can never flash
 * through mid-transition.
 */

export const SPLASH_BACKGROUND = AVARPUS_BLUE;

const MARK_FADE_IN_MS = 180;
const MIN_VISIBLE_MS = 380;
const FADE_OUT_MS = 220;
const FADE_WATCHDOG_GRACE_MS = 240;

export function SplashIntro({
  onFinish,
  loadingReady,
}: {
  onFinish: () => void;
  loadingReady: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [isFinished, setIsFinished] = useState(false);
  const [minVisibleElapsed, setMinVisibleElapsed] = useState(false);

  const mountedRef = useRef(true);
  const nativeSplashHidden = useRef(false);
  const exitStarted = useRef(false);
  const finished = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contentOpacity = useSharedValue(reducedMotion ? 1 : 0);

  const finish = useCallback(() => {
    if (!mountedRef.current || finished.current) return;
    finished.current = true;
    setIsFinished(true);
    onFinish();
  }, [onFinish]);

  // The watchdog and the animation callback both complete the splash, and
  // either may fire after `onFinish`'s identity changes. Routing both through
  // a ref keeps them pointing at the current callback without making the
  // watchdog's lifetime depend on render churn.
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    };
  }, []);

  // Hand off from the native splash immediately. Both surfaces use the same
  // background colour, so there is no visible seam while JS takes over.
  useEffect(() => {
    if (nativeSplashHidden.current) return;
    nativeSplashHidden.current = true;
    if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
      SplashScreen.setOptions({ duration: 0, fade: false });
    }
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    contentOpacity.value = withTiming(1, {
      duration: MARK_FADE_IN_MS,
      easing: Easing.out(Easing.quad),
    });
  }, [contentOpacity, reducedMotion]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (mountedRef.current) setMinVisibleElapsed(true);
    }, MIN_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loadingReady || !minVisibleElapsed) return;
    if (exitStarted.current) return;
    exitStarted.current = true;

    if (reducedMotion) {
      finishRef.current();
      return;
    }

    contentOpacity.value = withTiming(
      0,
      { duration: FADE_OUT_MS, easing: Easing.in(Easing.quad) },
      (completed) => {
        'worklet';
        if (completed) runOnJS(finishRef.current)();
      },
    );

    // The fade callback is the normal completion path. If it is ever dropped
    // (interrupted animation, worklet never settling), this bounded fallback
    // still releases the user into the app. `finish` is idempotent, so
    // whichever path lands first wins. The timer is intentionally cleared only
    // on unmount, so a re-render mid-fade cannot leave the exit unprotected.
    if (!watchdogRef.current) {
      watchdogRef.current = setTimeout(
        () => finishRef.current(),
        FADE_OUT_MS + FADE_WATCHDOG_GRACE_MS,
      );
    }
  }, [contentOpacity, loadingReady, minVisibleElapsed, reducedMotion]);

  const contentStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));

  if (isFinished) return null;

  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel="Opening Avarpus"
    >
      <StatusBar
        barStyle="light-content"
        backgroundColor={SPLASH_BACKGROUND}
        translucent={false}
      />

      <Animated.View style={[styles.markWrap, contentStyle]}>
        <Image
          source={require('@/assets/images/avarpus-splash-mark.png')}
          style={styles.mark}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
          accessibilityLabel="Avarpus"
        />
      </Animated.View>

      <Animated.View style={[styles.footer, contentStyle]}>
        <Text style={styles.tagline}>SECURE · PRIVATE · CONNECTED</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: SPLASH_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 9999,
  },
  markWrap: {
    width: 132,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: '100%',
    height: '100%',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 56,
    alignItems: 'center',
  },
  tagline: {
    color: '#FFFFFF',
    opacity: 0.82,
    fontSize: 13,
    letterSpacing: 2.4,
  },
});
