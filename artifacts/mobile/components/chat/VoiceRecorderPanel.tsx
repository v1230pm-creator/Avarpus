import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, useAudioRecorderState, type AudioRecorder } from 'expo-audio';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import type { VoiceRecorderPhase } from '@/hooks/useVoiceRecorder';
import { font, fontFamily } from '@/constants/typography';

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_MIN_HEIGHT = 3;
const BAR_MAX_HEIGHT = 30;
/** Live status tick — timer + waveform sampling cadence. */
const LIVE_TICK_MS = 100;
/** Metering floor (dBFS) mapped to an empty bar; 0 dBFS is a full bar. */
const METER_FLOOR_DB = -50;
const MAX_LEVEL_SAMPLES = 600;

function normaliseMeter(db: number | undefined): number {
  if (db === undefined || !Number.isFinite(db)) return 0;
  const clamped = Math.max(METER_FLOOR_DB, Math.min(0, db));
  return (clamped - METER_FLOOR_DB) / -METER_FLOOR_DB;
}

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Live view: the newest samples, right-aligned, scrolling left as they arrive. */
function tailBars(levels: number[], count: number): number[] {
  if (count <= 0) return [];
  const tail = levels.slice(Math.max(0, levels.length - count));
  return tail.length < count ? [...new Array(count - tail.length).fill(0), ...tail] : tail;
}

/** Preview view: the whole note compressed into `count` averaged buckets. */
function bucketBars(levels: number[], count: number): number[] {
  if (count <= 0) return [];
  if (levels.length === 0) return new Array(count).fill(0);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * levels.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / count));
    let sum = 0;
    for (let j = from; j < to; j++) sum += levels[j];
    out.push(sum / (to - from));
  }
  return out;
}

function Waveform({
  levels,
  mode,
  progress,
  activeColor,
  inactiveColor,
}: {
  levels: number[];
  mode: 'live' | 'preview';
  progress: number;
  activeColor: string;
  inactiveColor: string;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  const count = Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP));
  const bars = useMemo(
    () => (mode === 'live' ? tailBars(levels, count) : bucketBars(levels, count)),
    [levels, mode, count],
  );
  const playedBars = mode === 'preview' ? Math.round(progress * count) : count;

  return (
    <View style={styles.waveform} onLayout={onLayout} accessibilityLabel="Recording waveform">
      {bars.map((level, i) => (
        <View
          key={i}
          style={{
            width: BAR_WIDTH,
            marginRight: i === bars.length - 1 ? 0 : BAR_GAP,
            height: BAR_MIN_HEIGHT + level * (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT),
            borderRadius: BAR_WIDTH / 2,
            backgroundColor: i < playedBars ? activeColor : inactiveColor,
          }}
        />
      ))}
    </View>
  );
}

/** Playback of the committed audio while paused. Remount per file via `key`. */
function PreviewRow({
  uri,
  durationMs,
  levels,
  colors,
}: {
  uri: string;
  durationMs: number;
  levels: number[];
  colors: any;
}) {
  const player = useAudioPlayer({ uri }, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const isPlaying = status.playing;
  const totalSec = status.duration > 0 ? status.duration : durationMs / 1000;
  const currentSec = status.currentTime ?? 0;
  const progress = status.didJustFinish ? 1 : totalSec > 0 ? Math.min(currentSec / totalSec, 1) : 0;

  const toggle = useCallback(() => {
    if (isPlaying) {
      player.pause();
      return;
    }
    if (status.didJustFinish || (totalSec > 0 && currentSec >= totalSec - 0.05)) {
      player.seekTo(0);
    }
    player.play();
  }, [isPlaying, player, status.didJustFinish, totalSec, currentSec]);

  return (
    <View style={styles.row}>
      <TouchableOpacity
        onPress={toggle}
        style={styles.previewPlay}
        accessibilityLabel={isPlaying ? 'Pause preview' : 'Play recording'}
        accessibilityRole="button"
      >
        <Feather name={isPlaying ? 'pause' : 'play'} size={26} color={colors.foreground} />
      </TouchableOpacity>
      <Waveform
        levels={levels}
        mode="preview"
        progress={progress}
        activeColor={colors.success ?? colors.primary}
        inactiveColor={colors.mutedForeground + '66'}
      />
      <Text
        style={[styles.clock, { color: colors.foreground, fontFamily: fontFamily.medium }]}
        accessibilityLabel="Recording length"
      >
        {formatClock(isPlaying || currentSec > 0 ? currentSec * 1000 : durationMs)}
      </Text>
    </View>
  );
}

export interface VoiceRecorderPanelProps {
  recorder: AudioRecorder;
  phase: VoiceRecorderPhase;
  /** Length of already-finalised audio (previous segments). */
  committedMs: number;
  maxDurationMs: number;
  previewUri: string | null;
  canResume: boolean;
  /** True while the finished note is being uploaded / sent. */
  isSending: boolean;
  colors: any;
  bottomInset: number;
  onPause: () => void;
  onResume: () => void;
  onDiscard: () => void;
  onSend: () => void;
}

/**
 * Subscribes to the live recorder status itself so the 100ms timer/waveform
 * ticks re-render only this panel, never the chat screen behind it.
 */
export function VoiceRecorderPanel({
  recorder,
  phase,
  committedMs,
  maxDurationMs,
  previewUri,
  canResume,
  isSending,
  colors,
  bottomInset,
  onPause,
  onResume,
  onDiscard,
  onSend,
}: VoiceRecorderPanelProps) {
  const isRecording = phase === 'recording';
  const isPaused = phase === 'paused';
  const busy = phase === 'busy' || phase === 'requesting' || isSending;

  const recorderState = useAudioRecorderState(recorder, LIVE_TICK_MS);
  const liveMs = isRecording ? recorderState.durationMillis : 0;
  const elapsedMs = Math.min(committedMs + liveMs, maxDurationMs);

  // Waveform samples survive pause/resume for the lifetime of the panel.
  const [levels, setLevels] = useState<number[]>([]);
  useEffect(() => {
    if (!isRecording) return;
    const level = normaliseMeter(recorderState.metering);
    setLevels((prev) => {
      const next = prev.length >= MAX_LEVEL_SAMPLES ? prev.slice(prev.length - MAX_LEVEL_SAMPLES + 1) : prev.slice();
      next.push(level);
      return next;
    });
    // Sample on every status tick (not only when the meter value changes) so
    // silence still advances the waveform.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, recorderState.durationMillis]);

  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isRecording) {
      blink.stopAnimation();
      blink.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.2, duration: 600, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isRecording, blink]);

  const pillLabel = isPaused ? 'Resume' : 'Pause';
  const pillDisabled = busy || (isPaused && !canResume);

  return (
    <View
      style={[styles.panel, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(bottomInset, 10) }]}
      accessibilityLabel="Voice note recorder"
    >
      {isPaused && previewUri ? (
        <PreviewRow key={previewUri} uri={previewUri} durationMs={elapsedMs} levels={levels} colors={colors} />
      ) : (
        <View style={styles.row}>
          <View style={styles.liveClock}>
            <Animated.View style={[styles.dot, { backgroundColor: colors.destructive, opacity: blink }]} />
            <Text
              style={[styles.clock, { color: colors.foreground, fontFamily: fontFamily.medium }]}
              accessibilityLabel="Recording elapsed time"
            >
              {formatClock(elapsedMs)}
            </Text>
          </View>
          <Waveform
            levels={levels}
            mode="live"
            progress={1}
            activeColor={colors.foreground}
            inactiveColor={colors.mutedForeground + '66'}
          />
        </View>
      )}

      <View style={styles.controls}>
        <TouchableOpacity
          onPress={onDiscard}
          disabled={busy}
          style={[styles.circle, { backgroundColor: colors.destructive + '22', opacity: busy ? 0.5 : 1 }]}
          accessibilityLabel="Delete recording"
          accessibilityRole="button"
        >
          <Feather name="trash-2" size={24} color={colors.destructive} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={isPaused ? onResume : onPause}
          disabled={pillDisabled}
          style={[
            styles.pill,
            {
              backgroundColor: isPaused ? (colors.success ?? colors.primary) + '22' : colors.card,
              borderColor: colors.border,
              opacity: pillDisabled ? 0.5 : 1,
            },
          ]}
          accessibilityLabel={isPaused ? 'Resume recording' : 'Pause recording'}
          accessibilityRole="button"
        >
          <Feather name={isPaused ? 'mic' : 'pause'} size={22} color={colors.foreground} />
          <Text style={[styles.pillText, { color: colors.foreground, fontFamily: fontFamily.medium }]}>{pillLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onSend}
          disabled={busy}
          style={[styles.circle, { backgroundColor: colors.success ?? colors.primary, opacity: busy ? 0.6 : 1 }]}
          accessibilityLabel="Send voice note"
          accessibilityRole="button"
        >
          {isSending ? (
            <AvarpusSpinner size={22} color={colors.successForeground ?? colors.primaryForeground} />
          ) : (
            <Feather
              name="send"
              size={24}
              color={colors.successForeground ?? colors.primaryForeground}
              style={{ transform: [{ translateX: -1 }, { translateY: 1 }] }}
            />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    paddingTop: 14,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
  },
  liveClock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  clock: { ...font.heading, minWidth: 56, textAlign: 'center', fontVariant: ['tabular-nums'] },
  waveform: {
    flex: 1,
    height: BAR_MAX_HEIGHT + 4,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  previewPlay: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  circle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flex: 1,
    height: 62,
    borderRadius: 31,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  pillText: { ...font.bodyStrong },
});
