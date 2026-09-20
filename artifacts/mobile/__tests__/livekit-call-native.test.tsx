/**
 * Focused tests for the LiveKitCall.native.tsx disconnect/navigation state
 * machine. @livekit/react-native is fully mocked so no native modules load.
 *
 * Covers the release-blocking race conditions:
 *  - SDK onError → error UI stays visible and NO auto-navigation happens
 *    (teardown onDisconnected must be suppressed).
 *  - Error "Go back" navigates exactly once.
 *  - Manual hang-up: explicitly disconnects the Room and navigates exactly
 *    once, even though room.disconnect() also fires onDisconnected.
 *  - Genuine remote disconnect (not intentional / error / unmount) navigates
 *    back exactly once.
 *  - Unmount does not trigger a second navigation; audio session is stopped.
 *  - Controls, platform split, and E2EE-disabled copy are preserved.
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

// ── Platform: native ────────────────────────────────────────────────────────
Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });

// ── Capture handlers passed into LiveKitRoom so tests can drive the SDK ──────
interface RoomHandlers {
  onDisconnected?: () => void;
  onError?: (err: Error) => void;
}
const captured: { handlers: RoomHandlers } = { handlers: {} };

// Controllable Room instance returned by useRoomContext.
const mockRoomDisconnect = jest.fn<Promise<void>, [boolean?]>();
const mockRoom = {
  disconnect: mockRoomDisconnect,
};

// AudioSession spies
const mockStartAudioSession = jest.fn(() => Promise.resolve());
const mockStopAudioSession = jest.fn(() => Promise.resolve());

jest.mock('@livekit/react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    registerGlobals: jest.fn(),
    isTrackReference: () => true,
    AudioSession: {
      startAudioSession: () => mockStartAudioSession(),
      stopAudioSession: () => mockStopAudioSession(),
      getAudioOutputs: jest.fn(() => Promise.resolve(['speaker', 'earpiece'])),
      selectAudioOutput: jest.fn(() => Promise.resolve()),
    },
    LiveKitRoom: ({ children, onDisconnected, onError }: any) => {
      captured.handlers.onDisconnected = onDisconnected;
      captured.handlers.onError = onError;
      return React.createElement(View, { testID: 'livekit-room' }, children);
    },
    VideoTrack: () => React.createElement(View, { testID: 'video-track' }),
    useRoomContext: () => mockRoom,
    useLocalParticipant: () => ({
      localParticipant: {
        setMicrophoneEnabled: jest.fn(() => Promise.resolve()),
        setCameraEnabled: jest.fn(() => Promise.resolve()),
      },
      isMicrophoneEnabled: true,
      isCameraEnabled: true,
    }),
    useRemoteParticipants: () => [],
    useConnectionState: () => 'connected',
    useTracks: () => [],
  };
});

jest.mock('livekit-client', () => ({
  Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
  ConnectionState: {
    Disconnected: 'disconnected',
    Connecting: 'connecting',
    Connected: 'connected',
    Reconnecting: 'reconnecting',
    SignalReconnecting: 'signalReconnecting',
  },
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
    destructive: '#EF4444',
  }),
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Feather: ({ name }: { name: string }) => React.createElement(Text, null, `icon:${name}`),
  };
});

// Avatar reaches the API client (bearer storage) for entity paths; the call
// UI only needs a stand-in that shows the remote party's name and photo.
jest.mock('@/components/ui/Avatar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Avatar: ({ name, url }: { name: string; url?: string | null }) =>
      React.createElement(Text, { testID: 'remote-avatar' }, `Avatar:${name}${url ? `:${url}` : ''}`),
  };
});

// ── Subject (native component imported directly) ─────────────────────────────
import { LiveKitCall } from '../components/chat/LiveKitCall.native';

function renderCall(overrides?: { onHangup?: () => void; mode?: 'audio' | 'video'; remotePhoto?: string | null }) {
  const onHangup = overrides?.onHangup ?? jest.fn();
  const utils = render(
    <LiveKitCall
      serverUrl="wss://lk.example.com"
      token="tok-123"
      mode={overrides?.mode ?? 'audio'}
      remotePhoto={overrides?.remotePhoto}
      remoteName="Alice"
      onHangup={onHangup}
    />,
  );
  return { ...utils, onHangup };
}

beforeEach(() => {
  jest.clearAllMocks();
  captured.handlers = {};
  mockRoomDisconnect.mockResolvedValue(undefined);
});

// ── SDK error → error UI stays, no auto navigation ───────────────────────────

describe('LiveKitCall.native – SDK error', () => {
  it('shows the error UI and does NOT auto-navigate even when teardown fires onDisconnected', () => {
    const onHangup = jest.fn();
    renderCall({ onHangup });

    // Fire an SDK error; the component sets suppression BEFORE roomError.
    act(() => {
      captured.handlers.onError?.(new Error('ICE failed'));
    });

    // Error UI is visible.
    expect(screen.getByTestId('call-error')).toBeTruthy();
    expect(screen.getByText('ICE failed')).toBeTruthy();

    // Simulate LiveKitRoom teardown firing onDisconnected as it unmounts.
    act(() => {
      captured.handlers.onDisconnected?.();
    });

    // No navigation should have occurred — error UI stays interactive.
    expect(onHangup).not.toHaveBeenCalled();
    expect(screen.getByTestId('call-error')).toBeTruthy();
  });

  it('error UI shows the E2EE-disabled note', () => {
    renderCall();
    act(() => {
      captured.handlers.onError?.(new Error('boom'));
    });
    const note = screen.getByTestId('e2ee-disabled-note');
    expect(note.props.children).toBe('End-to-end encryption is not enabled');
  });

  it('error "Go back" navigates exactly once', () => {
    const onHangup = jest.fn();
    renderCall({ onHangup });

    act(() => {
      captured.handlers.onError?.(new Error('boom'));
    });

    const back = screen.getByTestId('error-go-back');
    fireEvent.press(back);
    fireEvent.press(back); // second press must be a no-op

    expect(onHangup).toHaveBeenCalledTimes(1);
  });
});

// ── Manual hang-up → disconnect + navigate once ──────────────────────────────

describe('LiveKitCall.native – manual hang-up', () => {
  it('explicitly disconnects the room and navigates exactly once despite onDisconnected', async () => {
    const onHangup = jest.fn();
    renderCall({ onHangup });

    // Simulate the room firing onDisconnected during the intentional close.
    mockRoomDisconnect.mockImplementation(async () => {
      captured.handlers.onDisconnected?.();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('hangup-button'));
    });

    expect(mockRoomDisconnect).toHaveBeenCalledTimes(1);
    expect(onHangup).toHaveBeenCalledTimes(1);
  });

  it('navigates once even if room.disconnect() rejects', async () => {
    const onHangup = jest.fn();
    renderCall({ onHangup });

    mockRoomDisconnect.mockRejectedValue(new Error('already closed'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('hangup-button'));
    });

    expect(onHangup).toHaveBeenCalledTimes(1);
  });

  it('rapid double-tap on hang-up disconnects and navigates only once', async () => {
    const onHangup = jest.fn();
    renderCall({ onHangup });

    await act(async () => {
      fireEvent.press(screen.getByTestId('hangup-button'));
      fireEvent.press(screen.getByTestId('hangup-button'));
    });

    expect(mockRoomDisconnect).toHaveBeenCalledTimes(1);
    expect(onHangup).toHaveBeenCalledTimes(1);
  });
});

// ── Genuine remote disconnect → navigate once ────────────────────────────────

describe('LiveKitCall.native – genuine remote disconnect', () => {
  it('navigates back exactly once when the remote/server disconnects', () => {
    const onHangup = jest.fn();
    renderCall({ onHangup });

    // No suppression set → this is a genuine remote disconnect.
    act(() => {
      captured.handlers.onDisconnected?.();
    });

    expect(onHangup).toHaveBeenCalledTimes(1);

    // A stray duplicate event must not navigate again.
    act(() => {
      captured.handlers.onDisconnected?.();
    });
    expect(onHangup).toHaveBeenCalledTimes(1);
  });
});

// ── Unmount / back gesture → no second navigation, audio cleaned up ──────────

describe('LiveKitCall.native – unmount', () => {
  it('starts audio session on mount and stops it on unmount', () => {
    const { unmount } = renderCall();
    expect(mockStartAudioSession).toHaveBeenCalledTimes(1);

    unmount();
    expect(mockStopAudioSession).toHaveBeenCalledTimes(1);
  });

  it('unmount (back gesture) does not trigger navigation', () => {
    const onHangup = jest.fn();
    const { unmount } = renderCall({ onHangup });

    unmount();

    // Even if a teardown onDisconnected leaks after unmount, no navigation.
    act(() => {
      captured.handlers.onDisconnected?.();
    });
    expect(onHangup).not.toHaveBeenCalled();
  });
});

// ── Preserved controls / platform split / E2EE copy ──────────────────────────

describe('LiveKitCall.native – preserved UI', () => {
  it('renders mute, speaker (android), hang-up controls and E2EE note in audio mode', () => {
    renderCall({ mode: 'audio' });

    expect(screen.getByTestId('mute-button')).toBeTruthy();
    expect(screen.getByTestId('speaker-button')).toBeTruthy(); // android platform
    expect(screen.getByTestId('hangup-button')).toBeTruthy();
    expect(screen.getByTestId('e2ee-disabled-note')).toBeTruthy();
    // audio mode should not show camera controls
    expect(screen.queryByTestId('camera-button')).toBeNull();
    expect(screen.queryByTestId('switch-camera-button')).toBeNull();
  });

  it('renders camera + switch-camera controls in video mode', () => {
    renderCall({ mode: 'video' });

    expect(screen.getByTestId('camera-button')).toBeTruthy();
    expect(screen.getByTestId('switch-camera-button')).toBeTruthy();
    expect(screen.getByTestId('mute-button')).toBeTruthy();
    expect(screen.getByTestId('hangup-button')).toBeTruthy();
  });

  it('shows the remote party profile photo on audio and video call screens', () => {
    const audio = renderCall({ mode: 'audio', remotePhoto: '/objects/uploads/p/photo.jpg' });
    expect(screen.getByText('Avatar:Alice:/objects/uploads/p/photo.jpg')).toBeTruthy();
    audio.unmount();

    renderCall({ mode: 'video', remotePhoto: '/objects/uploads/p/photo.jpg' });
    expect(screen.getByTestId('remote-video-placeholder')).toBeTruthy();
    expect(screen.getByText('Avatar:Alice:/objects/uploads/p/photo.jpg')).toBeTruthy();
  });

  it('shows the E2EE-disabled copy on the active call screen', () => {
    renderCall();
    const note = screen.getByTestId('e2ee-disabled-note');
    // active-call note lives in a nested Text with the accessibility label
    expect(screen.getByLabelText('End-to-end encryption is not enabled')).toBeTruthy();
    expect(note).toBeTruthy();
  });
});
