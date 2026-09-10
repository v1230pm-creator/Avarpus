import React from 'react';
import { act, render } from '@testing-library/react-native';

const mockHideAsync = jest.fn<Promise<void>, []>(() => Promise.resolve());
const mockReducedMotion = { value: false };
let mockImageAutoLoads = true;
// Simulates an exit fade whose completion callback is never delivered.
let mockSuppressTimingCallback = false;

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    Image: ({ onLoad, onError, ...props }: { onLoad?: () => void; onError?: () => void }) => {
      const notified = React.useRef(false);
      React.useEffect(() => {
        if (!mockImageAutoLoads || notified.current) return;
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
    if (callback && !mockSuppressTimingCallback) {
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
    mockImageAutoLoads = true;
    mockSuppressTimingCallback = false;
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

  it('hands off from the native splash immediately, without waiting on image readiness', async () => {
    mockImageAutoLoads = false;
    const onFinish = jest.fn();
    render(<SplashIntro onFinish={onFinish} loadingReady />);

    // Opening must never be gated on a decorative asset decoding.
    expect(mockHideAsync).toHaveBeenCalledTimes(1);

    // Two passes: the minimum-visible timer resolves in the first, and the
    // exit fade it schedules resolves in the second.
    await act(async () => {
      jest.advanceTimersByTime(400);
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(1100);
      await Promise.resolve();
    });

    expect(mockHideAsync).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('does not complete or update state when unmounted during the exit fade', async () => {
    const onFinish = jest.fn();
    const view = render(<SplashIntro onFinish={onFinish} loadingReady />);

    await act(async () => {
      await Promise.resolve();
    });
    // Past the minimum visible window, so the exit fade has started, but not
    // far enough for the fade to have settled.
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    view.unmount();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('holds the splash while startup work is still unresolved', async () => {
    const onFinish = jest.fn();
    render(<SplashIntro onFinish={onFinish} loadingReady={false} />);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    // Not ready yet: the splash must keep holding rather than exposing a
    // half-initialised app.
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('still releases the user into the app when the fade callback never fires', async () => {
    mockSuppressTimingCallback = true;
    const onFinish = jest.fn();
    render(<SplashIntro onFinish={onFinish} loadingReady />);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(onFinish).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('keeps the exit watchdog armed across re-renders during the fade', async () => {
    mockSuppressTimingCallback = true;
    const firstOnFinish = jest.fn();
    const secondOnFinish = jest.fn();
    const view = render(<SplashIntro onFinish={firstOnFinish} loadingReady />);

    // Start the exit fade, then re-render with a fresh callback identity, the
    // way an inline arrow prop does on every parent render.
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    view.rerender(<SplashIntro onFinish={secondOnFinish} loadingReady />);

    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    expect(secondOnFinish).toHaveBeenCalledTimes(1);
    expect(firstOnFinish).not.toHaveBeenCalled();

    // A late completion callback must not complete the splash a second time.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(secondOnFinish).toHaveBeenCalledTimes(1);
  });
});