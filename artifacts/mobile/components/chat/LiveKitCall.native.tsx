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
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
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
  const insets = useSafeAreaInsets();
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
    <View style={[styles.outer, { backgroundColor: mode === 'video' ? '#000' : colors.background }]} testID="call-active">
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
              style={[styles.remoteVideoStyle, styles.videoPlaceholder, { backgroundColor: colors.background }]}
              testID="remote-video-placeholder"
            >
              <Feather name="user" size={64} color={colors.mutedForeground} />
              <Text style={[styles.placeholderName, { color: colors.foreground }]} numberOfLines={1}>
                {remoteNames}
              </Text>
            </View>
          )}

          {/* Local video — pip corner */}
          {localVideoTracks.length > 0 && isCameraEnabled && (
            <View style={[styles.localVideoContainer, { borderColor: colors.border, backgroundColor: colors.background }]}>
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
        <View style={[styles.audioScreen, { backgroundColor: colors.background }]} testID="audio-screen">
          <View style={[styles.audioAvatar, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
            <Feather name="user" size={56} color={colors.primary} />
          </View>
          <Text style={[styles.audioRemoteName, { color: colors.foreground }]} numberOfLines={1}>
            {remoteNames}
          </Text>
          <Text style={[styles.audioStatus, { color: colors.mutedForeground }]}>
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
        <View style={[styles.loadingOverlay, { backgroundColor: colors.background }]} testID="call-loading">
          <AvarpusSpinner size={40} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Connecting…</Text>
        </View>
      )}

      {/* E2EE note */}
      <View
        style={[styles.e2eeBanner, { bottom: Math.max(insets.bottom, 20) + 72 }]}
        testID="e2ee-disabled-note"
      >
        <View style={[styles.e2eePill, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="shield" size={12} color={colors.mutedForeground} />
          <Text
            style={[styles.e2eeText, { color: colors.mutedForeground }]}
            accessibilityLabel="End-to-end encryption is not enabled"
          >
            End-to-end encryption is not enabled
          </Text>
        </View>
      </View>

      {/* Controls */}
      <View
        style={[styles.controls, { bottom: Math.max(insets.bottom, 20) }]}
        testID="call-controls"
      >
        {/* Mute */}
        <TouchableOpacity
          style={[
            styles.controlButton,
            { backgroundColor: colors.card, borderColor: colors.border },
            !isMicrophoneEnabled && { backgroundColor: colors.destructive, borderColor: colors.destructive }
          ]}
          onPress={handleToggleMute}
          accessibilityLabel={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
          testID="mute-button"
        >
          <Feather
            name={isMicrophoneEnabled ? 'mic' : 'mic-off'}
            size={22}
            color={!isMicrophoneEnabled ? '#fff' : colors.foreground}
          />
        </TouchableOpacity>

        {/* Camera toggle (video mode only) */}
        {mode === 'video' && (
          <TouchableOpacity
            style={[
              styles.controlButton,
              { backgroundColor: colors.card, borderColor: colors.border },
              !isCameraEnabled && { backgroundColor: colors.destructive, borderColor: colors.destructive }
            ]}
            onPress={handleToggleCamera}
            accessibilityLabel={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            testID="camera-button"
          >
            <Feather
              name={isCameraEnabled ? 'video' : 'video-off'}
              size={22}
              color={!isCameraEnabled ? '#fff' : colors.foreground}
            />
          </TouchableOpacity>
        )}

        {/* Switch camera (video mode, non-web only) */}
        {mode === 'video' && Platform.OS !== 'web' && (
          <TouchableOpacity
            style={[styles.controlButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleSwitchCamera}
            accessibilityLabel="Switch camera"
            testID="switch-camera-button"
          >
            <Feather name="refresh-cw" size={22} color={colors.foreground} />
          </TouchableOpacity>
        )}

        {/* Speaker toggle (Android only — iOS uses system route picker) */}
        {Platform.OS === 'android' && (
          <TouchableOpacity
            style={[
              styles.controlButton,
              { backgroundColor: colors.card, borderColor: colors.border },
              speakerOn && { backgroundColor: colors.primary, borderColor: colors.primary }
            ]}
            onPress={handleToggleSpeaker}
            accessibilityLabel={speakerOn ? 'Switch to earpiece' : 'Switch to speaker'}
            testID="speaker-button"
          >
            <Feather
              name={speakerOn ? 'volume-2' : 'volume-1'}
              size={22}
              color={speakerOn ? '#fff' : colors.foreground}
            />
          </TouchableOpacity>
        )}

        {/* Hang up */}
        <TouchableOpacity
          style={[styles.hangupButton, { backgroundColor: colors.destructive }]}
          onPress={handleHangup}
          disabled={isHangingUp}
          accessibilityLabel="Hang up"
          accessibilityState={{ disabled: isHangingUp }}
          testID="hangup-button"
        >
          <Feather name="phone-off" size={24} color="#fff" />
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
        <View style={[styles.e2eePill, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 24 }]}>
          <Feather name="shield" size={12} color={colors.mutedForeground} />
          <Text
            style={[styles.e2eeText, { color: colors.mutedForeground }]}
            testID="e2ee-disabled-note"
          >
            End-to-end encryption is not enabled
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.controlButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={navigateOnce}
          accessibilityLabel="Go back"
          testID="error-go-back"
        >
          <Feather name="arrow-left" size={24} color={colors.foreground} />
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
    gap: 12,
    padding: 24,
  },
  callErrorTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  callErrorBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  outer: {
    flex: 1,
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
  },
  placeholderName: {
    fontSize: 18,
    fontFamily: 'Inter_500Medium',
  },
  localVideoContainer: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 100,
    height: 140,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
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
    gap: 20,
  },
  audioAvatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioRemoteName: {
    fontSize: 22,
    fontFamily: 'Inter_600SemiBold',
  },
  audioStatus: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    zIndex: 20,
  },
  loadingText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  e2eeBanner: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 15,
  },
  e2eePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  e2eeText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    zIndex: 15,
  },
  controlButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonActive: {
    // handled dynamically now
  },
  hangupButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
