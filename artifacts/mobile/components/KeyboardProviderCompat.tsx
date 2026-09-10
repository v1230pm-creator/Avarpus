import React from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';

type Props = {
  children: React.ReactNode;
};

const NativeKeyboardProvider: React.ComponentType<Props> | null =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient
    ? null
    : require('react-native-keyboard-controller').KeyboardProvider;

export function KeyboardProviderCompat({ children }: Props) {
  if (!NativeKeyboardProvider) return <>{children}</>;
  return <NativeKeyboardProvider>{children}</NativeKeyboardProvider>;
}