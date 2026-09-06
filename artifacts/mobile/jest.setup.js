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

// SDK 57's Reanimated 4 mock imports the native Worklets initializer. Focused
// component tests only need deterministic values and animated host components.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { Animated } = require('react-native');
  const identityAnimation = (value, _config, callback) => {
    if (callback) callback(true);
    return value;
  };
  return {
    __esModule: true,
    default: Animated,
    cancelAnimation: jest.fn(),
    Easing: {
      cubic: jest.fn(),
      linear: jest.fn((value) => value),
      inOut: jest.fn((value) => value),
      out: jest.fn((value) => value),
      in: jest.fn((value) => value),
      quad: jest.fn(),
      sin: jest.fn(),
    },
    interpolate: (_value, _input, output) => output[0],
    runOnJS: (callback) => callback,
    useAnimatedProps: (factory) => factory(),
    useAnimatedStyle: (factory) => factory(),
    useReducedMotion: () => false,
    useSharedValue: (initialValue) => {
      const ref = React.useRef({ value: initialValue });
      return ref.current;
    },
    withDelay: (_delay, animation) => animation,
    withRepeat: (animation) => animation,
    withSequence: (...animations) => animations[animations.length - 1],
    withSpring: identityAnimation,
    withTiming: identityAnimation,
  };
});

// Components may call the hook directly without mounting the app-level
// provider in focused unit tests.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaConsumer: ({ children }) =>
      children({ top: 0, right: 0, bottom: 0, left: 0 }),
    SafeAreaView: React.forwardRef((props, ref) =>
      React.createElement(View, { ...props, ref }),
    ),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
  };
});
