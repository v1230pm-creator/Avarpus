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

// expo-video and expo-intent-launcher touch native modules at import time;
// the chat room screen imports both, so every suite that mounts it needs
// these inert defaults. Focused suites override them with jest.mock as needed.
jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useVideoPlayer: (source, setup) => {
      const player = React.useMemo(
        () => ({ loop: false, play: jest.fn(), pause: jest.fn() }),
        [],
      );
      React.useEffect(() => {
        setup?.(player);
      }, [player, source]);
      return player;
    },
    VideoView: (props) => React.createElement(View, { ...props, testID: 'video-view' }),
  };
});
jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: jest.fn().mockResolvedValue({ resultCode: 0 }),
}));
// The device chat store is exercised through its in-memory implementation in
// tests; the native SQLite binding must never be opened under Jest. Rejecting
// here makes screens fall back to network-only rendering (the same path the
// app takes when the store cannot be opened on a device).
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockRejectedValue(new Error('expo-sqlite is not available under Jest')),
  deleteDatabaseAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }),
}));
// AsyncStorage has no native module under Jest; the chat store bookkeeping
// (which databases exist per account) reaches it from app-wide code such as
// the tab layout. Suites that need specific stored values override this mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
