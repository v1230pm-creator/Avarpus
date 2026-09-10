import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform, ScrollView, ScrollViewProps } from 'react-native';
import type { KeyboardAwareScrollViewProps } from 'react-native-keyboard-controller';

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

const NativeKeyboardAwareScrollView:
  | React.ComponentType<Props>
  | null =
  Platform.OS !== 'web' &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
    ? require('react-native-keyboard-controller').KeyboardAwareScrollView
    : null;

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  // Android clips (detaches) subviews scrolled out of the viewport; when the
  // keyboard opens and the layout shifts, a focused TextInput can get clipped,
  // lose focus, and instantly dismiss the keyboard. Never clip form content.
  removeClippedSubviews = false,
  ...props
}: Props) {
  if (!NativeKeyboardAwareScrollView) {
    return (
      <ScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        removeClippedSubviews={removeClippedSubviews}
        {...props}
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <NativeKeyboardAwareScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      removeClippedSubviews={removeClippedSubviews}
      {...props}
    >
      {children}
    </NativeKeyboardAwareScrollView>
  );
}
