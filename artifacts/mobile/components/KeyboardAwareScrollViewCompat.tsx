import { Platform, ScrollView, ScrollViewProps } from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  // Android clips (detaches) subviews scrolled out of the viewport; when the
  // keyboard opens and the layout shifts, a focused TextInput can get clipped,
  // lose focus, and instantly dismiss the keyboard. Never clip form content.
  removeClippedSubviews = false,
  ...props
}: Props) {
  if (Platform.OS === 'web') {
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
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      removeClippedSubviews={removeClippedSubviews}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
