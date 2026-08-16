/* eslint-disable no-undef */
// react-native-keyboard-controller has no native module under Jest.
// Map its KeyboardAwareScrollView to a plain ScrollView so form screens
// render their children normally in tests.
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react');
  const { ScrollView } = require('react-native');
  return {
    KeyboardAwareScrollView: React.forwardRef((props, ref) =>
      React.createElement(ScrollView, { ...props, ref }),
    ),
    KeyboardProvider: ({ children }) => children,
    KeyboardAvoidingView: React.forwardRef((props, ref) =>
      React.createElement(require('react-native').View, { ...props, ref }),
    ),
    useKeyboardHandler: jest.fn(),
    useKeyboardContext: jest.fn(() => ({})),
    KeyboardController: { setInputMode: jest.fn(), setDefaultMode: jest.fn(), dismiss: jest.fn() },
    KeyboardEvents: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
    useKeyboardAnimation: jest.fn(() => ({ height: { value: 0 }, progress: { value: 0 } })),
    useReanimatedKeyboardAnimation: jest.fn(() => ({ height: { value: 0 }, progress: { value: 0 } })),
    AndroidSoftInputModes: { SOFT_INPUT_ADJUST_RESIZE: 16 },
  };
});
