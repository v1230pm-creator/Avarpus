import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, View, useColorScheme } from 'react-native';
import colors from '@/constants/colors';
import { BrandMark } from '@/components/ui/BrandMark';

/**
 * Covers the whole UI with a branded opaque overlay whenever the app is not
 * in the `active` state, so the OS app switcher snapshot (taken while the app
 * is `inactive`/`background`) never shows sensitive business data.
 *
 * The overlay appears on `inactive` too — on iOS the switcher snapshot is
 * captured during `inactive`, before `background` fires, so waiting for
 * `background` would be too late. It is removed the moment the app becomes
 * `active` again; if the background grace period expired, the lock screen
 * takes over via the existing re-lock flow.
 */
export function PrivacyShield() {
  const [obscured, setObscured] = useState(AppState.currentState !== 'active');
  const scheme = useColorScheme();
  const palette = colors[scheme === 'dark' ? 'dark' : 'light'];

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setObscured(state !== 'active');
    });
    return () => sub.remove();
  }, []);

  if (!obscured) return null;

  return (
    <View
      style={[styles.overlay, { backgroundColor: palette.background }]}
      pointerEvents="auto"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <BrandMark size={160} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
