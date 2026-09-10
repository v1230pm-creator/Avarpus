import React from 'react';
import {
  KeyboardAvoidingView as ReactNativeKeyboardAvoidingView,
  Platform,
  View,
  ViewProps,
} from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

type Props = ViewProps & { behavior?: 'padding' | 'height' | 'position' };

const NativeKeyboardAvoidingView:
  | React.ComponentType<Props>
  | null =
  Platform.OS !== 'web' &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
    ? require('react-native-keyboard-controller').KeyboardAvoidingView
    : null;

/**
 * Keyboard-avoiding container for Modal content. Uses the
 * native keyboard controller in custom builds, React Native's built-in
 * fallback in Expo Go, and a plain View on web.
 */
export function KeyboardAvoidingCompat({ children, behavior = 'padding', ...props }: Props) {
  if (Platform.OS === 'web') {
    return <View {...props}>{children}</View>;
  }
  if (!NativeKeyboardAvoidingView) {
    return (
      <ReactNativeKeyboardAvoidingView behavior={behavior} {...props}>
        {children}
      </ReactNativeKeyboardAvoidingView>
    );
  }
  return (
    <NativeKeyboardAvoidingView behavior={behavior} {...props}>
      {children}
    </NativeKeyboardAvoidingView>
  );
}
