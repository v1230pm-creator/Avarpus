import React from 'react';
import { Platform, View, ViewProps } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

type Props = ViewProps & { behavior?: 'padding' | 'height' | 'position' };

/**
 * Keyboard-avoiding container for Modal content. Uses the
 * react-native-keyboard-controller KeyboardAvoidingView on native (works
 * reliably on both iOS and Android) and a plain View on web where the
 * on-screen keyboard doesn't overlap the viewport.
 */
export function KeyboardAvoidingCompat({ children, behavior = 'padding', ...props }: Props) {
  if (Platform.OS === 'web') {
    return <View {...props}>{children}</View>;
  }
  return (
    <KeyboardAvoidingView behavior={behavior} {...props}>
      {children}
    </KeyboardAvoidingView>
  );
}
