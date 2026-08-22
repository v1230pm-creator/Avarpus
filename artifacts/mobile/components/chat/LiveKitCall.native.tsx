/**
 * Native LiveKit call screen component.
 *
 * - Registers WebRTC globals once on module load.
 * - Starts AudioSession on mount and stops it on unmount.
 * - Connects with LiveKitRoom using server-issued serverUrl + token.
 * - Publishes audio always; publishes camera only for mode=video.
 * - Remote participant audio is handled automatically by the LiveKit SDK on native.
 * - Renders local + remote camera VideoTrack views (video mode).
 * - Controls: mute/unmute, camera on/off (video only), speaker toggle (Android),
 *   switch camera (video only), hang-up.
 * - E2EE is NOT enabled and a prominent note confirms this.
 * - Cleans up audio session on unmount or hang-up.
 *
 * LiveKit APIs used:
 *   - registerGlobals()          — @livekit/react-native
 *   - AudioSession.startAudioSession() / stopAudioSession() / getAudioOutputs() / selectAudioOutput()
 *   - LiveKitRoom                — @livekit/react-native
 *   - VideoTrack                 — @livekit/react-native
 *   - useLocalParticipant        — @livekit/react-native (from @livekit/components-react)
 *   - useRemoteParticipants      — @livekit/react-native
 *   - useTracks                  — @livekit/react-native
 *   - useConnectionState         — @livekit/react-native
 *   - useRoomContext             — @livekit/react-native (Room instance for explicit disconnect)
 *   - room.disconnect()          — livekit-client (awaited on manual hang-up)
 *   - isTrackReference           — @livekit/react-native (from @livekit/components-react)
 *   - Track.Source.Camera        — livekit-client
 *   - ConnectionState            — livekit-client
 *   - localParticipant.setMicrophoneEnabled()
 *   - localParticipant.setCameraEnabled()
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  LiveKitRoom,
  VideoTrack,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
  useConnectionState,
  useRoomContext,
  AudioSession,
  registerGlobals,
  isTrackReference,
} from '@livekit/react-native';
import type { TrackReference } from '@livekit/react-native';
import { Track, ConnectionState } from 'livekit-client';
import { useColors } from '@/hooks/useColors';
import type { LiveKitCallProps } from './LiveKitCallTypes';

/**
 * Shared navigation coordination refs, passed from the outer LiveKitCall
 * component down to CallControls (which lives inside the room context).
 *
 * - suppressNavRef: when true, teardown-triggered onDisconnected MUST NOT
 *   navigate. Set BEFORE anything that unmounts LiveKitRoom (error, manual
 *   hang-up, unmount) so the disconnect that follows is treated as intentional.
 * - navigatedRef: one-shot guard. navigateOnce() flips this and calls onHangup
 *   at most once for the lifetime of the component.
 */
interface NavCoordination {
  suppressNavRef: React.MutableRefObject<boolean>;
  navigatedRef: React.MutableRefObject<boolean>;
  navigateOnce: () => void;
}

// ── Register WebRTC globals once ────────────────────────────────────────────
let globalsRegistered = false;
function ensureGlobalsRegistered() {
  if (!globalsRegistered) {
    registerGlobals();
    globalsRegistered = true;
  }
}

// ── Inner call UI (rendered inside LiveKitRoom context) ─────────────────────

interface CallUIProps {
  mode: 'audio' | 'video';
  remoteName: string;
  nav: NavCoordination;
}

function CallControls({ mode, remoteName, nav }: CallUIProps) {
  const colors = useColors();
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const connectionState = useConnectionState();
  const remoteParticipants = useRemoteParticipants();
  const [speakerOn, setSpeakerOn] = useState(false);
  const [isHangingUp, setIsHangingUp] = useState(false);
  // Synchronous guard: state updates do not flush between two rapid presses,
  // so a ref is required to make the double-tap protection reliable.
  const hangingUpRef = useRef(false);

  // Tracks for video rendering — filter to actual track references (not placeholders)
  const allLocalTracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: false }],
    { onlySubscribed: false },
  );
  const localVideoTracks: TrackReference[] = allLocalTracks
    .filter(isTrackReference)
    .filter((track) => track.participant.isLocal);

  const allRemoteTracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: false },
  ]);
  const remoteVideoTracks: TrackReference[] = allRemoteTracks
    .filter(isTrackReference)
    .filter((track) => !track.participant.isLocal);

  const isConnecting =
    connectionState === ConnectionState.Connecting ||
    connectionState === ConnectionState.Reconnecting ||
    connectionState === ConnectionState.SignalReconnecting;
  const isConnected = connectionState === ConnectionState.Connected;
  const isDisconnected = connectionState === ConnectionState.Disconnected;

  // ── Mute / unmute microphone ──────────────────────────────────────────────
  const handleToggleMute = useCallback(async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (_) {
      // ignore track errors
    }
  }, [localParticipant, isMicrophoneEnabled]);

  // ── Camera on / off ───────────────────────────────────────────────────────
  const handleToggleCamera = useCallback(async () => {
    if (!localParticipant || mode !== 'video') return;
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (_) {
      // ignore track errors
    }
  }, [localParticipant, isCameraEnabled, mode]);

  // ── Switch camera (front / back) ──────────────────────────────────────────
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const handleSwitchCamera = useCallback(async () => {
    if (!localParticipant || mode !== 'video') return;
    try {
      const newFacing = isFrontCamera ? 'environment' : 'user';
      await localParticipant.setCameraEnabled(true, { facingMode: newFacing });
      setIsFrontCamera(!isFrontCamera);
    } catch (_) {
      // ignore errors if device only has one camera
    }
  }, [localParticipant, isFrontCamera, mode]);

  // ── Speaker toggle ────────────────────────────────────────────────────────
  const handleToggleSpeaker = useCallback(async () => {
    try {
      const outputs = await AudioSession.getAudioOutputs();
      const hasRouting =
        Platform.OS === 'android'
          ? outputs.includes('speaker') || outputs.includes('earpiece')
          : outputs.includes('default') || outputs.includes('force_speaker');
      if (!hasRouting) return;
      const nextSpeaker = !speakerOn;
      if (Platform.OS === 'android') {
        await AudioSession.selectAudioOutput(nextSpeaker ? 'speaker' : 'earpiece');
      } else if (Platform.OS === 'ios') {
        await AudioSession.selectAudioOutput(nextSpeaker ? 'force_speaker' : 'default');
      }
      setSpeakerOn(nextSpeaker);
    } catch (_) {
      // ignore — device might not support routing
    }
  }, [speakerOn]);

  // ── Manual hang-up ────────────────────────────────────────────────────────
  // Suppress teardown navigation BEFORE disconnecting so the onDisconnected
  // fired by room.disconnect() does not navigate. Explicitly await the
  // disconnect, then navigate exactly once in finally. onDisconnected during
  // this intentional close is swallowed via suppressNavRef.
  const handleHangup = useCallback(async () => {
    if (hangingUpRef.current) return;
    hangingUpRef.current = true;
    setIsHangingUp(true);
    nav.suppressNavRef.current = true;
    try {
      if (room) {
        await room.disconnect();
      }
    } catch (_) {
      // ignore disconnect errors — we navigate regardless
    } finally {
      nav.navigateOnce();
    }
  }, [isHangingUp, nav, room]);

  // ── Remote participant display names / placeholder ────────────────────────
  const remoteNames =
    remoteParticipants.length > 0
      ? remoteParticipants
          .map((p) => p.name || p.identity || 'Participant')
          .join(', ')
      : remoteName;

  return (
    <View style={styles.outer} testID="call-active">
      {/* Video views (video mode only) */}
      {mode === 'video' && (
        <>
          {/* Remote video — full screen background */}
          {remoteVideoTracks.length > 0 ? (
            <VideoTrack
              trackRef={remoteVideoTracks[0]}
              style={styles.remoteVideoStyle}
              objectFit="cover"
            />
          ) : (
            <View
              style={[styles.remoteVideoStyle, styles.videoPlaceholder]}
              testID="remote-video-placeholder"
            >
              <Feather name="user" size={64} color="rgba(255,255,255,0.4)" />
              <Text style={styles.placeholderName} numberOfLines={1}>
                {remoteNames}
              </Text>
            </View>
          )}

          {/* Local video — pip corner */}
          {localVideoTracks.length > 0 && isCameraEnabled && (
            <View style={styles.localVideoContainer}>
              <VideoTrack
                trackRef={localVideoTracks[0]}
                style={styles.localVideoInner}
                objectFit="cover"
                mirror
                zOrder={1}
              />
            </View>
          )}
        </>
      )}

      {/* Audio-only avatar screen */}
      {mode === 'audio' && (
        <View style={styles.audioScreen} testID="audio-screen">
          <View style={styles.audioAvatar}>
            <Feather name="user" size={72} color="rgba(255,255,255,0.8)" />
          </View>
          <Text style={styles.audioRemoteName} numberOfLines={1}>
            {remoteNames}
          </Text>
          <Text style={styles.audioStatus}>
            {isConnecting
              ? 'Connecting…'
              : isConnected
              ? 'Voice call in progress'
              : isDisconnected
              ? 'Disconnected'
              : ''}
          </Text>
        </View>
      )}

      {/* Loading overlay */}
      {isConnecting && (
        <View style={styles.loadingOverlay} testID="call-loading">
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.loadingText}>Connecting…</Text>
        </View>
      )}

      {/* E2EE note */}
      <View style={styles.e2eeBanner} testID="e2ee-disabled-note">
        <Feather name="shield" size={12} color="rgba(255,255,255,0.5)" />
        <Text
          style={styles.e2eeText}
          accessibilityLabel="End-to-end encryption is not enabled"
        >
          End-to-end encryption is not enabled
        </Text>
      </View>

      {/* Controls */}
      <View style={styles.controls} testID="call-controls">
        {/* Mute */}
        <TouchableOpacity
          style={[styles.controlButton, !isMicrophoneEnabled && styles.controlButtonActive]}
          onPress={handleToggleMute}
          accessibilityLabel={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
          testID="mute-button"
        >
          <Feather
            name={isMicrophoneEnabled ? 'mic' : 'mic-off'}
            size={24}
            color="#fff"
          />
        </TouchableOpacity>

        {/* Camera toggle (video mode only) */}
        {mode === 'video' && (
          <TouchableOpacity
            style={[styles.controlButton, !isCameraEnabled && styles.controlButtonActive]}
            onPress={handleToggleCamera}
            accessibilityLabel={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            testID="camera-button"
          >
            <Feather
              name={isCameraEnabled ? 'video' : 'video-off'}
              size={24}
              color="#fff"
            />
          </TouchableOpacity>
        )}

        {/* Switch camera (video mode, non-web only) */}
        {mode === 'video' && Platform.OS !== 'web' && (
          <TouchableOpacity
            style={styles.controlButton}
            onPress={handleSwitchCamera}
            accessibilityLabel="Switch camera"
            testID="switch-camera-button"
          >
            <Feather name="refresh-cw" size={24} color="#fff" />
          </TouchableOpacity>
        )}

        {/* Speaker toggle (Android only — iOS uses system route picker) */}
        {Platform.OS === 'android' && (
          <TouchableOpacity
            style={[styles.controlButton, speakerOn && styles.controlButtonActive]}
            onPress={handleToggleSpeaker}
            accessibilityLabel={speakerOn ? 'Switch to earpiece' : 'Switch to speaker'}
            testID="speaker-button"
          >
            <Feather
              name={speakerOn ? 'volume-2' : 'volume-1'}
              size={24}
              color="#fff"
            />
          </TouchableOpacity>
        )}

        {/* Hang up */}
        <TouchableOpacity
          style={styles.hangupButton}
          onPress={handleHangup}
          disabled={isHangingUp}
          accessibilityLabel="Hang up"
          accessibilityState={{ disabled: isHangingUp }}
          testID="hangup-button"
        >
          <Feather name="phone-off" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main exported component ─────────────────────────────────────────────────

export function LiveKitCall({
  serverUrl,
  token,
  mode,
  remoteName,
  onHangup,
}: LiveKitCallProps) {
  const colors = useColors();
  const [roomError, setRoomError] = useState<string | null>(null);

  // ── Navigation coordination refs ───────────────────────────────────────
  // suppressNavRef: teardown-triggered onDisconnected must not navigate.
  // navigatedRef: one-shot guard so we navigate back at most once.
  const suppressNavRef = useRef(false);
  const navigatedRef = useRef(false);
  // Latest onHangup, so navigateOnce never fires a stale callback.
  const onHangupRef = useRef(onHangup);
  onHangupRef.current = onHangup;

  const navigateOnce = useCallback(() => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    onHangupRef.current();
  }, []);

  const nav: NavCoordination = { suppressNavRef, navigatedRef, navigateOnce };

  useEffect(() => {
    ensureGlobalsRegistered();
    AudioSession.startAudioSession().catch(() => {
      // ignore if already started
    });

    return () => {
      // Unmount (incl. back gesture): suppress any teardown navigation and
      // mark as already-navigated so no second navigation can fire. Audio
      // session cleanup always runs.
      suppressNavRef.current = true;
      navigatedRef.current = true;
      AudioSession.stopAudioSession().catch(() => {});
    };
  }, []);

  // ── SDK error handler ──────────────────────────────────────────────────
  // Set suppression BEFORE roomError so that unmounting LiveKitRoom (which
  // fires onDisconnected during its teardown) cannot navigate. The error UI
  // stays visible; only its explicit Go back navigates, exactly once.
  const handleError = useCallback((err: Error) => {
    suppressNavRef.current = true;
    setRoomError(err?.message || 'Unable to connect to the call service.');
  }, []);

  // ── SDK disconnect handler ─────────────────────────────────────────────
  // Fired on: intentional room.disconnect() (manual hang-up — suppressed),
  // teardown after an error (suppressed), unmount (suppressed), and genuine
  // remote/server disconnect (NOT suppressed → navigate exactly once).
  const handleDisconnect = useCallback(() => {
    if (suppressNavRef.current) return;
    navigateOnce();
  }, [navigateOnce]);

  if (roomError) {
    return (
      <View
        style={[styles.callErrorScreen, { backgroundColor: colors.background }]}
        testID="call-error"
      >
        <Feather name="alert-circle" size={40} color={colors.destructive} />
        <Text style={[styles.callErrorTitle, { color: colors.foreground }]}>
          Call connection failed
        </Text>
        <Text style={[styles.callErrorBody, { color: colors.mutedForeground }]}>
          {roomError}
        </Text>
        <Text
          style={[styles.callErrorBody, { color: colors.mutedForeground }]}
          testID="e2ee-disabled-note"
        >
          End-to-end encryption is not enabled
        </Text>
        <TouchableOpacity
          style={styles.hangupButton}
          onPress={navigateOnce}
          accessibilityLabel="Go back"
          testID="error-go-back"
        >
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect
      audio
      video={mode === 'video'}
      onDisconnected={handleDisconnect}
      onError={handleError}
    >
      <CallControls mode={mode} remoteName={remoteName} nav={nav} />
    </LiveKitRoom>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  callErrorScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 28,
  },
  callErrorTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  callErrorBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
    textAlign: 'center',
  },
  outer: {
    flex: 1,
    backgroundColor: '#000',
  },
  remoteVideoStyle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  videoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#1A1A2E',
  },
  placeholderName: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
  },
  localVideoContainer: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 100,
    height: 140,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    zIndex: 10,
  },
  localVideoInner: {
    width: '100%',
    height: '100%',
  },
  audioScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    gap: 16,
  },
  audioAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioRemoteName: {
    color: '#fff',
    fontSize: 22,
    fontFamily: 'Inter_600SemiBold',
  },
  audioStatus: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    zIndex: 20,
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  },
  e2eeBanner: {
    position: 'absolute',
    bottom: 130,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    zIndex: 15,
  },
  e2eeText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  controls: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    zIndex: 15,
  },
  controlButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonActive: {
    backgroundColor: 'rgba(239,68,68,0.7)',
  },
  hangupButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
