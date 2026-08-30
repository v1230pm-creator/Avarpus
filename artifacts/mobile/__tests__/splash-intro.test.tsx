import React from 'react';
import { act, render } from '@testing-library/react-native';

const mockHideAsync = jest.fn<Promise<void>, []>(() => Promise.resolve());
const mockReducedMotion = { value: false };

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    Image: ({ onLoad, onError, ...props }: { onLoad?: () => void; onError?: () => void }) => {
      const notified = React.useRef(false);
      React.useEffect(() => {
        if (notified.current) return;
        notified.current = true;
        (onLoad ?? onError)?.();
      }, [onError, onLoad]);
      return <View {...props} />;
    },
  };
});

jest.mock('expo-splash-screen', () => ({
  setOptions: jest.fn(),
  hideAsync: (...args: []) => mockHideAsync(...args),
}));

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View, Text } = require('react-native');

  const passthrough = (Component: React.ComponentType<any>) => Component;
  const timing = (value: number, config?: { duration?: number }, callback?: (finished: boolean) => void) => {
    if (callback) {
      setTimeout(() => callback(true), config?.duration ?? 0);
    }
    return value;
  };

  return {
    __esModule: true,
    default: {
      View,
      Text,
      createAnimatedComponent: passthrough,
    },
    cancelAnimation: jest.fn(),
    Easing: {
      cubic: jest.fn(),
      inOut: jest.fn((value: unknown) => value),
      out: jest.fn((value: unknown) => value),
      in: jest.fn((value: unknown) => value),
      quad: jest.fn(),
      sin: jest.fn(),
    },
    runOnJS: (callback: () => void) => callback,
    useAnimatedProps: () => ({}),
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => mockReducedMotion.value,
    useSharedValue: (initialValue: number) => {
      const ref = React.useRef({ value: initialValue });
      return ref.current;
    },
    withDelay: (_delay: number, animation: number) => animation,
    withSequence: (...animations: number[]) => animations[animations.length - 1],
    withTiming: timing,
  };
});

import { SplashIntro } from '@/components/ui/SplashIntro';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('SplashIntro lifecycle safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    mockHideAsync.mockResolvedValue(undefined);
    mockReducedMotion.value = false;
  });

  it('does not reveal the splash after native hiding resolves on an unmounted screen', async () => {
    const pendingHide = deferred<void>();
    mockHideAsync.mockReturnValue(pendingHide.promise);
    const onFinish = jest.fn();
    const view = render(<SplashIntro onFinish={onFinish} loadingReady />);

    expect(mockHideAsync).toHaveBeenCalledTimes(1);
    view.unmount();

    await act(async () => {
      pendingHide.resolve(undefined);
      await pendingHide.promise;
    });
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('completes healthy readiness once even if more animation time elapses', async () => {
    const onFinish = jest.fn();
    render(<SplashIntro onFinish={onFinish} loadingReady />);

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(720);
    });
    await act(async () => {
      jest.advanceTimersByTime(420);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('does not complete or update state when unmounted during the final dot animation', async () => {
    const onFinish = jest.fn();
    const view = render(<SplashIntro onFinish={onFinish} loadingReady />);

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(720);
    });
    view.unmount();

    await act(async () => {
      jest.advanceTimersByTime(420);
    });
    expect(onFinish).not.toHaveBeenCalled();
  });
});