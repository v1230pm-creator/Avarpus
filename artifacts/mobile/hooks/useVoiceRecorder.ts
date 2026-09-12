import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  useAudioRecorder,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
  type RecordingStatus,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';

/**
 * Voice-note recorder with WhatsApp-style pause / preview / resume.
 *
 * expo-audio cannot play back a recording that is merely paused (the native
 * file is not finalised until stop()), so "pause" here really stops the
 * current segment. Segments are recorded as raw AAC ADTS streams, which can
 * be concatenated byte-for-byte into one valid stream — that is what makes
 * resume-after-preview possible without a native muxer. After every pause
 * the committed audio is a single finalised, playable file.
 *
 * Web records WebM through MediaRecorder; WebM segments cannot be joined, so
 * resume is unavailable there (pause → preview → send / delete only).
 *
 * Rendering note: this hook deliberately does NOT subscribe to the live
 * recorder status. Doing so would re-render the whole chat screen every tick
 * while recording; the panel component subscribes on its own instead. Only
 * coarse state (phase, committed audio, errors) lives here.
 */

export type VoiceRecorderPhase =
  | 'idle'
  | 'requesting' // permission prompt / audio session setup in flight
  | 'recording'
  | 'paused' // committed audio is finalised and previewable
  | 'busy'; // pausing / resuming / finishing / discarding

export interface VoiceRecording {
  uri: string;
  name: string;
  size: number;
  contentType: string;
  durationMs: number;
}

interface UseVoiceRecorderOptions {
  maxDurationMs: number;
  /** Recordings shorter than this are discarded by finish(). */
  minDurationMs?: number;
}

const IS_WEB = Platform.OS === 'web';
const CONTENT_TYPE = IS_WEB ? 'audio/webm' : 'audio/aac';
const EXTENSION = IS_WEB ? '.webm' : '.aac';

// Mono voice profile. `aac_adts` (Android) and a `.aac` path (iOS AVAudioRecorder
// picks the container from the extension) both produce headerless ADTS frames.
const VOICE_NOTE_OPTIONS: RecordingOptions = {
  extension: EXTENSION,
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
  android: {
    outputFormat: 'aac_adts',
    audioEncoder: 'aac',
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

async function fileSize(uri: string): Promise<number> {
  if (IS_WEB) {
    const blob = await (await fetch(uri)).blob();
    return blob.size;
  }
  return new File(uri).size ?? 0;
}

/** Best-effort disposal of a recorder-owned temp file (or web blob URL). */
export function deleteVoiceTempFile(uri: string | null | undefined) {
  if (!uri) return;
  if (IS_WEB) {
    if (uri.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(uri);
      } catch {
        // Already revoked.
      }
    }
    return;
  }
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Cache files — the OS reclaims them if we cannot.
  }
}

/** Concatenate ADTS segments into one new cache file and remove the parts. */
async function concatSegments(uris: string[]): Promise<string> {
  const chunks: Uint8Array[] = [];
  for (const uri of uris) chunks.push(await new File(uri).bytes());
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  const out = new File(Paths.cache, `voice-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${EXTENSION}`);
  out.write(merged);
  for (const uri of uris) deleteVoiceTempFile(uri);
  return out.uri;
}

export function useVoiceRecorder({ maxDurationMs, minDurationMs = 500 }: UseVoiceRecorderOptions) {
  // The native recorder reports every stop (ours or its own forDuration cap)
  // through this listener; the handler is swapped per render via a ref.
  const statusListenerRef = useRef<(status: RecordingStatus) => void>(() => undefined);
  const recorder = useAudioRecorder(VOICE_NOTE_OPTIONS, (status) => statusListenerRef.current(status));

  const [phase, setPhaseState] = useState<VoiceRecorderPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [committedMs, setCommittedMs] = useState(0);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  // Refs are the authoritative state machine: transitions are written
  // synchronously so concurrent callers (tap + native cap, double taps)
  // cannot both claim the same transition.
  const phaseRef = useRef<VoiceRecorderPhase>('idle');
  const setPhase = useCallback((next: VoiceRecorderPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const committedUriRef = useRef<string | null>(null);
  const committedMsRef = useRef(0);
  const audioModeActiveRef = useRef(false);
  // Wall-clock start of the live segment: the fallback length when the native
  // status has already been reset (cap fired, interruption) by the time we read it.
  const segmentStartedAtRef = useRef(0);
  // Bumped by discard/unmount so an in-flight start/resume that was awaiting
  // the OS (permission prompt, session setup) cannot begin capturing later.
  const generationRef = useRef(0);

  /** Synchronous read of the live segment length straight from the native side. */
  const liveDurationMs = useCallback((): number => {
    try {
      const d = recorder.getStatus().durationMillis;
      return Number.isFinite(d) && d > 0 ? d : 0;
    } catch {
      return 0;
    }
  }, [recorder]);

  const enterRecordingAudioMode = useCallback(async () => {
    audioModeActiveRef.current = true;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  }, []);

  /**
   * Restore the playback session. Only marked restored once the OS accepted
   * it; otherwise the flag stays set and every later transition (pause,
   * delete, send, unmount) retries, so the recording route cannot stay
   * active silently.
   */
  const resetAudioMode = useCallback(async () => {
    if (!audioModeActiveRef.current) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        audioModeActiveRef.current = false;
        return;
      } catch {
        // Retry once, then leave the flag set for the next path.
      }
    }
  }, []);

  /**
   * Best-effort release of whatever the native recorder holds, including the
   * file of the segment that was live (never a committed file).
   */
  const releaseRecorder = useCallback(async () => {
    // Android exposes the path before stop() and may clear it during; web
    // only creates the blob URL inside stop(). Capture both sides.
    const liveUris = new Set<string>();
    try {
      if (recorder.uri) liveUris.add(recorder.uri);
      await recorder.stop();
    } catch {
      // Already released.
    }
    try {
      if (recorder.uri) liveUris.add(recorder.uri);
    } catch {
      // Recorder object already disposed.
    }
    for (const uri of liveUris) {
      if (uri !== committedUriRef.current) deleteVoiceTempFile(uri);
    }
    await resetAudioMode();
  }, [recorder, resetAudioMode]);

  /**
   * Prepare + start a new segment, capped natively at the remaining budget
   * so the file itself can never exceed the limit. expo-audio requires an
   * explicit prepare; on Android record() silently no-ops on an unprepared
   * recorder. A recorder left prepared by an aborted attempt is released first.
   */
  const startSegment = useCallback(async () => {
    const remainingMs = maxDurationMs - committedMsRef.current;
    if (remainingMs <= 0) throw new Error('Maximum voice note length reached.');
    try {
      await recorder.prepareToRecordAsync();
    } catch (prepareErr: any) {
      if (!/already been prepared/i.test(prepareErr?.message ?? '')) throw prepareErr;
      const staleUri = recorder.uri || null;
      await recorder.stop().catch(() => undefined);
      if (staleUri && staleUri !== committedUriRef.current) deleteVoiceTempFile(staleUri);
      await recorder.prepareToRecordAsync();
    }
    segmentStartedAtRef.current = Date.now();
    recorder.record({ forDuration: remainingMs / 1000 });
  }, [maxDurationMs, recorder]);

  /**
   * Length of the live segment, never above the remaining budget. Prefers the
   * native clock; falls back to wall-clock when the native status was already
   * reset (the cap or an interruption stopped it first).
   */
  const settledSegmentMs = useCallback((): number => {
    const remainingMs = Math.max(0, maxDurationMs - committedMsRef.current);
    const native = liveDurationMs();
    const wall = segmentStartedAtRef.current > 0 ? Math.max(0, Date.now() - segmentStartedAtRef.current) : 0;
    return Math.min(remainingMs, native > 0 ? native : wall);
  }, [liveDurationMs, maxDurationMs]);

  /** Stop the live segment; returns its finalised file and duration. */
  const stopSegment = useCallback(async (): Promise<{ uri: string; durationMs: number }> => {
    // Read length and path before stop(): Android clears the uri while the
    // native file is finalised and the status resets on stop.
    const durationMs = settledSegmentMs();
    const uriBefore = recorder.uri || null;
    await recorder.stop();
    const uri = recorder.uri || uriBefore;
    if (!uri) throw new Error('Recording file unavailable after stop.');
    return { uri, durationMs };
  }, [recorder, settledSegmentMs]);

  /** Fold a finished segment into the committed audio (single playable file). */
  const commitSegment = useCallback(async (segment: { uri: string; durationMs: number }) => {
    let uri = segment.uri;
    if (committedUriRef.current) {
      if (IS_WEB) {
        deleteVoiceTempFile(segment.uri);
        throw new Error('Resuming a paused recording is not supported on web.');
      }
      try {
        uri = await concatSegments([committedUriRef.current, segment.uri]);
      } catch (mergeErr) {
        deleteVoiceTempFile(segment.uri);
        throw mergeErr;
      }
    }
    committedUriRef.current = uri;
    committedMsRef.current += segment.durationMs;
    setCommittedMs(committedMsRef.current);
    setPreviewUri(uri);
  }, []);

  const clearCommitted = useCallback(() => {
    deleteVoiceTempFile(committedUriRef.current);
    committedUriRef.current = null;
    committedMsRef.current = 0;
    setCommittedMs(0);
    setPreviewUri(null);
  }, []);

  /** Shared failure exit: nothing survives, session restored, error shown. */
  const failToIdle = useCallback(
    async (err: unknown, fallback: string) => {
      await releaseRecorder();
      clearCommitted();
      setError((err as any)?.message ?? fallback);
      setPhase('idle');
    },
    [clearCommitted, releaseRecorder, setPhase],
  );

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;
    const gen = generationRef.current;
    const stale = () => gen !== generationRef.current;
    setError(null);
    setPermissionDenied(false);
    setPhase('requesting');
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (stale()) return;
      if (!granted) {
        setPermissionDenied(true);
        setPhase('idle');
        return;
      }
      clearCommitted();
      await enterRecordingAudioMode();
      if (stale()) {
        await releaseRecorder();
        return;
      }
      await startSegment();
      if (stale()) {
        await releaseRecorder();
        return;
      }
      setPhase('recording');
    } catch (err) {
      if (stale()) {
        await releaseRecorder();
        return;
      }
      await failToIdle(err, 'Could not start recording.');
    }
  }, [clearCommitted, enterRecordingAudioMode, failToIdle, releaseRecorder, setPhase, startSegment]);

  /** Recording → paused, given the finished live segment. */
  const settleSegment = useCallback(
    async (segment: { uri: string; durationMs: number }) => {
      await commitSegment(segment);
      // Leave recording mode so the preview plays through the loudspeaker.
      await resetAudioMode();
      setPhase('paused');
    },
    [commitSegment, resetAudioMode, setPhase],
  );

  const pause = useCallback(async () => {
    if (phaseRef.current !== 'recording') return;
    setPhase('busy');
    try {
      await settleSegment(await stopSegment());
    } catch (err) {
      await failToIdle(err, 'Recording failed.');
    }
  }, [failToIdle, setPhase, settleSegment, stopSegment]);

  // The native forDuration cap (or a native failure) ended the live segment
  // on its own. Our own stops flip the phase to `busy` before calling stop(),
  // so a finish event seen while still `recording` can only be the native one.
  statusListenerRef.current = (status) => {
    if (!status.isFinished || phaseRef.current !== 'recording') return;
    setPhase('busy');
    void (async () => {
      if (status.hasError) {
        await failToIdle(new Error(status.error ?? 'Recording stopped unexpectedly.'), 'Recording stopped unexpectedly.');
        return;
      }
      const uri = status.url || recorder.uri || null;
      if (!uri) {
        await failToIdle(new Error('Recording file unavailable after stop.'), 'Recording failed.');
        return;
      }
      try {
        // Native status is already reset here, so the length comes from the
        // segment clock (capped at the budget the native timer enforced).
        await settleSegment({ uri, durationMs: settledSegmentMs() });
      } catch (err) {
        await failToIdle(err, 'Recording failed.');
      }
    })();
  };

  const resume = useCallback(async () => {
    if (phaseRef.current !== 'paused') return;
    if (IS_WEB) {
      setError('Resuming is not available on web — send or delete this recording.');
      return;
    }
    if (committedMsRef.current >= maxDurationMs) {
      setError('Maximum voice note length reached.');
      return;
    }
    const gen = generationRef.current;
    setPhase('busy');
    try {
      await enterRecordingAudioMode();
      if (gen !== generationRef.current) {
        await releaseRecorder();
        return;
      }
      await startSegment();
      if (gen !== generationRef.current) {
        await releaseRecorder();
        return;
      }
      setPhase('recording');
    } catch (err: any) {
      await releaseRecorder();
      if (gen !== generationRef.current) return;
      setError(err?.message ?? 'Could not resume recording.');
      // The committed audio is intact — stay paused so it can still be sent.
      setPhase('paused');
    }
  }, [enterRecordingAudioMode, maxDurationMs, releaseRecorder, setPhase, startSegment]);

  const discard = useCallback(async () => {
    const from = phaseRef.current;
    if (from === 'idle' || from === 'busy') return;
    generationRef.current += 1;
    setPhase('busy');
    if (from === 'recording' || from === 'requesting') {
      await releaseRecorder();
    } else {
      // Paused: retries a session restore that may have failed at pause time.
      await resetAudioMode();
    }
    clearCommitted();
    setError(null);
    setPhase('idle');
  }, [clearCommitted, releaseRecorder, resetAudioMode, setPhase]);

  /**
   * Finalise and hand over the recording. Returns null (and resets) when the
   * note is too short or nothing was captured. Ownership of the file passes
   * to the caller, who must dispose of it with deleteVoiceTempFile().
   */
  const finish = useCallback(async (): Promise<VoiceRecording | null> => {
    const from = phaseRef.current;
    if (from !== 'recording' && from !== 'paused') return null;
    setPhase('busy');
    try {
      if (from === 'recording') {
        await commitSegment(await stopSegment());
      }
      await resetAudioMode();
      const uri = committedUriRef.current;
      const durationMs = Math.min(committedMsRef.current, maxDurationMs);
      if (!uri || durationMs < minDurationMs) {
        clearCommitted();
        setError('Recording too short — hold on a little longer before sending.');
        setPhase('idle');
        return null;
      }
      const size = await fileSize(uri);
      // Hand the file over without deleting it.
      committedUriRef.current = null;
      committedMsRef.current = 0;
      setCommittedMs(0);
      setPreviewUri(null);
      setPhase('idle');
      return {
        uri,
        name: `voice-note-${Date.now()}${EXTENSION}`,
        size,
        contentType: CONTENT_TYPE,
        durationMs: Math.max(1, Math.round(durationMs)),
      };
    } catch (err) {
      await failToIdle(err, 'Recording failed.');
      return null;
    }
  }, [clearCommitted, commitSegment, failToIdle, maxDurationMs, minDurationMs, resetAudioMode, setPhase, stopSegment]);

  // Unmount: invalidate in-flight starts, release the native recorder,
  // restore the session, drop temp files.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      if (audioModeActiveRef.current || phaseRef.current !== 'idle') {
        void releaseRecorder();
      }
      deleteVoiceTempFile(committedUriRef.current);
      committedUriRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(
    () => ({
      recorder,
      phase,
      isActive: phase !== 'idle',
      maxDurationMs,
      committedMs,
      previewUri,
      error,
      permissionDenied,
      canResume: !IS_WEB,
      clearError: () => setError(null),
      clearPermissionDenied: () => setPermissionDenied(false),
      start,
      pause,
      resume,
      discard,
      finish,
    }),
    [recorder, phase, maxDurationMs, committedMs, previewUri, error, permissionDenied, start, pause, resume, discard, finish],
  );
}
