/**
 * Focused tests for the LiveKit call screen foundation.
 *
 * Covers:
 * - Token request uses the correct room ID
 * - 503 unavailable state and retry flow
 * - Loading state while token is pending
 * - Web fallback component (LiveKitCall.web.tsx) contract
 * - Hang-up / back navigation
 * - E2EE-disabled copy presence
 * - No fake calls when token request fails
 *
 * Native module imports are avoided by mocking at the platform component
 * boundary (@livekit/react-native) and at the component import boundary.
 */
import React from 'react';
import { Platform } from 'react-native';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

// ── Platform mock helper ───────────────────────────────────────────────────

function setNativePlatform() {
  Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
}
function setWebPlatform() {
  Object.defineProperty(Platform, 'OS', { get: () => 'web', configurable: true });
}

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    useRouter: jest.fn(() => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() })),
    useLocalSearchParams: jest.fn(() => ({ id: 'room-abc', mode: 'audio', name: 'Alice' })),
    Redirect: ({ href }: { href: string }) => React.createElement(Text, null, `Redirect:${href}`),
    Slot: () => React.createElement(Text, null, 'Slot'),
  };
});

jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(() => ({ user: { id: 'u1', name: 'Me', role: 'dealer_owner' }, canAccess: () => true })),
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#F8FAFC',
    foreground: '#111827',
    card: '#FFFFFF',
    border: '#E2E8F0',
    primary: '#2F80ED',
    mutedForeground: '#64748B',
    backgroundSecondary: '#F1F5F9',
    accent: '#EAF2FF',
    destructive: '#EF4444',
    success: '#22C55E',
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Feather: ({ name }: { name: string }) => React.createElement(Text, null, `icon:${name}`),
  };
});

// Mock the platform-split LiveKitCall component so we don't import native modules
jest.mock('@/components/chat/LiveKitCall', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    LiveKitCall: ({
      serverUrl,
      token,
      mode,
      remoteName,
      onHangup,
    }: {
      serverUrl: string;
      token: string;
      mode: string;
      remoteName: string;
      onHangup: () => void;
    }) =>
      React.createElement(
        View,
        { testID: 'livekit-call-component' },
        React.createElement(Text, { testID: 'livekit-serverUrl' }, serverUrl),
        React.createElement(Text, { testID: 'livekit-token' }, token),
        React.createElement(Text, { testID: 'livekit-mode' }, mode),
        React.createElement(Text, { testID: 'livekit-remoteName' }, remoteName),
        React.createElement(
          TouchableOpacity,
          { testID: 'livekit-hangup', onPress: onHangup, accessibilityLabel: 'Hang up' },
          React.createElement(Text, null, 'Hang up'),
        ),
        React.createElement(
          Text,
          { testID: 'e2ee-disabled-note' },
          'End-to-end encryption is not enabled',
        ),
      ),
  };
});

// API client
const mockUseChatCallToken = jest.fn();

jest.mock('@workspace/api-client-react', () => ({
  useChatCallToken: (...args: any[]) => mockUseChatCallToken(...args),
}));

// ── Subject ────────────────────────────────────────────────────────────────

import CallScreen from '../app/(tabs)/customers/chat/call/[id]';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMutateFn(
  result: { success?: any; error?: any },
): jest.Mock {
  return jest.fn((_vars: any, cbs: any) => {
    if (result.success !== undefined) {
      cbs?.onSuccess?.(result.success);
    } else if (result.error !== undefined) {
      cbs?.onError?.(result.error);
    }
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CallScreen – token request', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setNativePlatform();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'room-abc',
      mode: 'audio',
      name: 'Alice',
    });
  });

  it('requests a token with the correct room ID from the route', async () => {
    const mutateFn = makeMutateFn({ success: { url: 'wss://lk.example.com', token: 'tok123', roomName: 'room-abc', expiresIn: 300 } });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => {
      expect(mutateFn).toHaveBeenCalledWith(
        { roomId: 'room-abc' },
        expect.anything(),
      );
    });
  });

  it('renders the LiveKit call component on successful token response', async () => {
    const mutateFn = makeMutateFn({
      success: {
        url: 'wss://lk.example.com',
        token: 'tok-xyz',
        roomName: 'room-abc',
        expiresIn: 300,
      },
    });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('livekit-call-component')).toBeTruthy();
      expect(screen.getByTestId('livekit-serverUrl').props.children).toBe('wss://lk.example.com');
      expect(screen.getByTestId('livekit-token').props.children).toBe('tok-xyz');
      expect(screen.getByTestId('livekit-mode').props.children).toBe('audio');
      expect(screen.getByTestId('livekit-remoteName').props.children).toBe('Alice');
    });
  });

  it('passes mode=video when route param is video', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'room-vid',
      mode: 'video',
      name: 'Bob',
    });
    const mutateFn = makeMutateFn({
      success: { url: 'wss://lk.example.com', token: 'tok-vid', roomName: 'room-vid', expiresIn: 300 },
    });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('livekit-mode').props.children).toBe('video');
    });
  });
});

describe('CallScreen – 503 unavailable state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setNativePlatform();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'room-abc',
      mode: 'audio',
      name: 'Alice',
    });
  });

  it('shows 503 service unavailable error UI', async () => {
    const mutateFn = makeMutateFn({
      error: { status: 503, data: { message: 'LiveKit service is down' } },
    });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('call-error-screen')).toBeTruthy();
      expect(screen.getByTestId('call-error-title').props.children).toBe('Service unavailable');
    });
  });

  it('shows the Retry button on 503', async () => {
    const mutateFn = makeMutateFn({ error: { status: 503 } });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('retry-button')).toBeTruthy();
    });
  });

  it('does NOT show the Retry button on non-503 errors', async () => {
    const mutateFn = makeMutateFn({ error: { status: 401, message: 'Unauthorized' } });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('call-error-screen')).toBeTruthy();
      expect(screen.queryByTestId('retry-button')).toBeNull();
    });
  });

  it('does NOT render the LiveKit call component when token request fails (fail-closed)', async () => {
    const mutateFn = makeMutateFn({ error: { status: 503 } });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => {
      expect(screen.queryByTestId('livekit-call-component')).toBeNull();
    });
  });
});

describe('CallScreen – retry flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setNativePlatform();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'room-abc',
      mode: 'audio',
      name: 'Alice',
    });
  });

  it('re-requests the token when Retry is pressed', async () => {
    let callCount = 0;
    const mutateFn = jest.fn((_vars: any, cbs: any) => {
      callCount++;
      if (callCount === 1) {
        // First call: 503
        cbs?.onError?.({ status: 503 });
      } else {
        // Subsequent calls: success
        cbs?.onSuccess?.({
          url: 'wss://lk.example.com',
          token: 'retry-token',
          roomName: 'room-abc',
          expiresIn: 300,
        });
      }
    });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    // Initial failure
    await waitFor(() => expect(screen.getByTestId('retry-button')).toBeTruthy());

    // Tap retry
    fireEvent.press(screen.getByTestId('retry-button'));

    // Token should be re-requested and call component should appear
    await waitFor(() => {
      expect(mutateFn).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('livekit-call-component')).toBeTruthy();
    });
  });
});

describe('CallScreen – hangup / back navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setNativePlatform();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'room-abc',
      mode: 'audio',
      name: 'Alice',
    });
  });

  it('calls router.back() when hang-up is pressed on the call component', async () => {
    const mockBack = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ back: mockBack });

    const mutateFn = makeMutateFn({
      success: { url: 'wss://lk.example.com', token: 'tok', roomName: 'r', expiresIn: 300 },
    });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => expect(screen.getByTestId('livekit-hangup')).toBeTruthy());

    fireEvent.press(screen.getByTestId('livekit-hangup'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('calls router.back() when Go back is pressed on the error screen', async () => {
    const mockBack = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ back: mockBack });

    const mutateFn = makeMutateFn({ error: { status: 500, message: 'Server error' } });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => expect(screen.getByTestId('back-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('back-button'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('CallScreen – E2EE disabled copy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'room-abc',
      mode: 'audio',
      name: 'Alice',
    });
  });

  it('shows E2EE-disabled note on the active call screen (native)', async () => {
    setNativePlatform();

    const mutateFn = makeMutateFn({
      success: { url: 'wss://lk.example.com', token: 'tok', roomName: 'r', expiresIn: 300 },
    });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => {
      const note = screen.getByTestId('e2ee-disabled-note');
      expect(note).toBeTruthy();
      expect(note.props.children).toBe('End-to-end encryption is not enabled');
    });
  });

  it('shows E2EE-disabled note on the error screen', async () => {
    setNativePlatform();

    const mutateFn = makeMutateFn({ error: { status: 503 } });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('e2ee-disabled-note')).toBeTruthy();
    });
  });
});

describe('CallScreen – web fallback', () => {
  afterEach(() => {
    // restore
    setNativePlatform();
  });

  it('renders the unsupported-runtime fallback on web without requesting a token', () => {
    setWebPlatform();
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'room-web',
      mode: 'audio',
      name: 'Alice',
    });

    const mutateFn = jest.fn();
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    expect(screen.getByTestId('livekit-web-fallback')).toBeTruthy();
    expect(mutateFn).not.toHaveBeenCalled();
    // No token request should have been made (web short-circuits before useEffect)
    // Note: useEffect still runs but Platform.OS check makes the component
    // render the web branch before any async call completes.
    // On web the component is rendered synchronously so we can check immediately.
  });

  it('web fallback renders E2EE-disabled note', () => {
    setWebPlatform();
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'room-web',
      mode: 'audio',
      name: 'Alice',
    });
    mockUseChatCallToken.mockReturnValue({ mutate: jest.fn(), isPending: false });

    render(<CallScreen />);

    expect(screen.getByTestId('e2ee-disabled-note')).toBeTruthy();
  });
});

describe('LiveKitCall.web.tsx – standalone component contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setWebPlatform();
  });

  afterEach(() => {
    setNativePlatform();
  });

  // We test the actual web component (not the mock used in CallScreen tests)
  // by importing it directly.
  it('renders the web fallback with E2EE-disabled note and Go back button', () => {
    // Un-mock for this describe block by importing directly
    const { LiveKitCall: LiveKitCallWeb } =
      jest.requireActual('../components/chat/LiveKitCall.web');

    const onHangup = jest.fn();
    render(
      <LiveKitCallWeb
        serverUrl=""
        token=""
        mode="audio"
        remoteName="Remote"
        onHangup={onHangup}
      />,
    );

    expect(screen.getByTestId('livekit-web-fallback')).toBeTruthy();
    expect(screen.getByTestId('e2ee-disabled-note')).toBeTruthy();
    const note = screen.getByTestId('e2ee-disabled-note');
    expect(note.props.children).toContain('End-to-end encryption is not enabled');
    expect(screen.getByTestId('web-back-button')).toBeTruthy();
    expect(screen.getByLabelText('Go back')).toBeTruthy();
  });

  it('calls onHangup when Go back is pressed in web fallback', () => {
    const { LiveKitCall: LiveKitCallWeb } =
      jest.requireActual('../components/chat/LiveKitCall.web');

    const onHangup = jest.fn();
    render(
      <LiveKitCallWeb
        serverUrl=""
        token=""
        mode="audio"
        remoteName="Remote"
        onHangup={onHangup}
      />,
    );

    fireEvent.press(screen.getByTestId('web-back-button'));
    expect(onHangup).toHaveBeenCalledTimes(1);
  });

  it('web fallback does NOT render a call UI or stream (calls require installed app)', () => {
    const { LiveKitCall: LiveKitCallWeb } =
      jest.requireActual('../components/chat/LiveKitCall.web');

    const onHangup = jest.fn();
    render(
      <LiveKitCallWeb
        serverUrl=""
        token=""
        mode="audio"
        remoteName="Remote"
        onHangup={onHangup}
      />,
    );

    // Should mention the installed app requirement
    expect(screen.getByText(/require.*installed app/i)).toBeTruthy();
    // Should not render any call controls
    expect(screen.queryByTestId('call-controls')).toBeNull();
    expect(screen.queryByTestId('hangup-button')).toBeNull();
  });
});

describe('CallScreen – loading state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setNativePlatform();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'room-abc',
      mode: 'audio',
      name: 'Alice',
    });
  });

  it('shows loading indicator while token is being fetched', () => {
    // mutate never calls callbacks (simulates in-flight request)
    const mutateFn = jest.fn(); // no callbacks called
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: true });

    render(<CallScreen />);

    // The loading state (idle → loading in useEffect) should render
    expect(screen.getByTestId('call-loading-screen')).toBeTruthy();
  });
});

describe('CallScreen – missing config / empty URL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setNativePlatform();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: 'room-abc',
      mode: 'audio',
      name: 'Alice',
    });
  });

  it('shows config error when server returns empty url', async () => {
    const mutateFn = makeMutateFn({
      success: { url: '', token: '', roomName: '', expiresIn: 0 },
    });
    mockUseChatCallToken.mockReturnValue({ mutate: mutateFn, isPending: false });

    render(<CallScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('call-error-screen')).toBeTruthy();
      expect(screen.getByTestId('call-error-body').props.children).toContain(
        'Call service is not configured',
      );
    });
  });
});
