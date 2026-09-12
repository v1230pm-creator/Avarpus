import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatMessage } from '@workspace/api-client-react';
import { chatMediaUri, formatRelativeTime } from './messageActions';

export type ImageViewerDownloadState = 'idle' | 'saving' | 'done' | 'error';

interface ImageViewerProps {
  visible: boolean;
  message: ChatMessage | null;
  roomId: string;
  token: string | null;
  /** "You" for the viewer's own photo, otherwise the sender's display name. */
  senderLabel: string;
  onClose: () => void;
  /** Send `text` as a reply quoting the photo. Resolves when the send was queued. */
  onReply: (message: ChatMessage, text: string) => void;
  onForward: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  /** Save the photo to the device gallery. Reject to show the error state. */
  onDownload: (message: ChatMessage) => Promise<void>;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 280;

function distance(touches: readonly { pageX: number; pageY: number }[]): number {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/**
 * Full-screen photo viewer. All chat chrome is hidden behind the modal; the
 * header/footer toggle on tap, pinch (or double-tap) zooms, and the footer
 * "Reply" input sends a text message quoting the photo.
 */
export function ImageViewer({
  visible,
  message,
  roomId,
  token,
  senderLabel,
  onClose,
  onReply,
  onForward,
  onDelete,
  onDownload,
}: ImageViewerProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [chromeVisible, setChromeVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [downloadState, setDownloadState] = useState<ImageViewerDownloadState>('idle');
  const [imageLoading, setImageLoading] = useState(true);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  // ── Zoom / pan (core Animated + PanResponder; no native gesture deps) ──
  const scale = useRef(new Animated.Value(1)).current;
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const pinchLiveScale = useRef(1);
  const lastTapAt = useRef(0);
  const gestureMoved = useRef(false);

  // Reset per-photo state whenever a different message is opened.
  useEffect(() => {
    setChromeVisible(true);
    setMenuOpen(false);
    setReplyText('');
    setDownloadState('idle');
    setImageLoading(true);
    setNaturalSize(null);
    scale.setValue(1);
    translate.setValue({ x: 0, y: 0 });
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id, visible]);

  // The photo is letterboxed ("contain") inside the viewport, so panning
  // limits come from the fitted image size, not the screen — otherwise a
  // wide photo can be dragged into black space vertically.
  const fitted = useMemo(() => {
    if (!naturalSize || naturalSize.width <= 0 || naturalSize.height <= 0) {
      return { width, height };
    }
    const ratio = Math.min(width / naturalSize.width, height / naturalSize.height);
    return { width: naturalSize.width * ratio, height: naturalSize.height * ratio };
  }, [naturalSize, width, height]);

  const clampOffset = useCallback(
    (x: number, y: number, s: number) => {
      const maxX = Math.max(0, (fitted.width * s - width) / 2);
      const maxY = Math.max(0, (fitted.height * s - height) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, x)),
        y: Math.min(maxY, Math.max(-maxY, y)),
      };
    },
    [fitted, width, height],
  );

  const animateTo = useCallback(
    (s: number, x: number, y: number) => {
      const clamped = clampOffset(x, y, s);
      scaleRef.current = s;
      offsetRef.current = clamped;
      Animated.parallel([
        Animated.spring(scale, { toValue: s, useNativeDriver: true, friction: 8 }),
        Animated.spring(translate, { toValue: clamped, useNativeDriver: true, friction: 8 }),
      ]).start();
    },
    [clampOffset, scale, translate],
  );

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapAt.current < DOUBLE_TAP_MS) {
      lastTapAt.current = 0;
      animateTo(scaleRef.current > 1 ? 1 : 2.5, 0, 0);
      return;
    }
    lastTapAt.current = now;
    setTimeout(() => {
      if (lastTapAt.current === now) {
        setChromeVisible((v) => !v);
        setMenuOpen(false);
      }
    }, DOUBLE_TAP_MS);
  }, [animateTo]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2 || g.numberActiveTouches === 2,
        onPanResponderGrant: () => {
          gestureMoved.current = false;
          pinchStartDistance.current = null;
        },
        onPanResponderMove: (e: GestureResponderEvent, g: PanResponderGestureState) => {
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) {
            gestureMoved.current = true;
            const d = distance(touches);
            if (pinchStartDistance.current === null) {
              pinchStartDistance.current = d;
              pinchStartScale.current = scaleRef.current;
              pinchLiveScale.current = scaleRef.current;
              return;
            }
            const next = Math.min(
              MAX_SCALE,
              Math.max(MIN_SCALE, (pinchStartScale.current * d) / pinchStartDistance.current),
            );
            pinchLiveScale.current = next;
            scale.setValue(next);
            return;
          }
          if (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2) gestureMoved.current = true;
          if (scaleRef.current > 1) {
            const clamped = clampOffset(offsetRef.current.x + g.dx, offsetRef.current.y + g.dy, scaleRef.current);
            translate.setValue(clamped);
          }
        },
        onPanResponderRelease: (_e, g) => {
          if (pinchStartDistance.current !== null) {
            // Commit the last scale applied during the pinch.
            const committed = pinchLiveScale.current;
            pinchStartDistance.current = null;
            animateTo(committed < 1.05 ? 1 : committed, offsetRef.current.x, offsetRef.current.y);
            return;
          }
          if (!gestureMoved.current) {
            handleTap();
            return;
          }
          if (scaleRef.current > 1) {
            offsetRef.current = clampOffset(offsetRef.current.x + g.dx, offsetRef.current.y + g.dy, scaleRef.current);
            translate.setValue(offsetRef.current);
          } else if (Math.abs(g.dy) > 120 && Math.abs(g.dx) < 80) {
            // Swipe down/up on an unzoomed photo dismisses the viewer.
            onClose();
          }
        },
      }),
    [animateTo, clampOffset, handleTap, onClose, scale, translate],
  );

  const handleDownload = useCallback(async () => {
    if (!message || downloadState === 'saving') return;
    setDownloadState('saving');
    try {
      await onDownload(message);
      setDownloadState('done');
    } catch {
      setDownloadState('error');
    }
  }, [downloadState, message, onDownload]);

  const handleSendReply = useCallback(() => {
    if (!message) return;
    const trimmed = replyText.trim();
    if (!trimmed) return;
    onReply(message, trimmed);
    setReplyText('');
    onClose();
  }, [message, onClose, onReply, replyText]);

  if (!message) return null;
  const uri = chatMediaUri(roomId, message.id);
  const timeLabel = formatRelativeTime(message.createdAt);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onClose}
      testID="image-viewer"
    >
      <View style={styles.root}>
        {Platform.OS !== 'web' && <StatusBar barStyle="light-content" backgroundColor="#000" />}
        <View style={styles.stage} {...panResponder.panHandlers} testID="image-viewer-stage">
          <Animated.View
            style={[
              styles.imageWrap,
              { width, height, transform: [{ translateX: translate.x }, { translateY: translate.y }, { scale }] },
            ]}
          >
            <Image
              source={{ uri, headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
              style={{ width, height }}
              contentFit="contain"
              onLoadStart={() => setImageLoading(true)}
              onLoad={(event) => {
                const source = event?.source;
                if (source?.width && source?.height) {
                  setNaturalSize({ width: source.width, height: source.height });
                }
              }}
              onLoadEnd={() => setImageLoading(false)}
              accessibilityLabel="Full-size photo"
              testID="image-viewer-photo"
            />
          </Animated.View>
          {imageLoading && (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ActivityIndicator color="#FFFFFF" />
            </View>
          )}
        </View>

        {chromeVisible && (
          <View style={[styles.header, { paddingTop: insets.top + 4 }]} testID="image-viewer-header">
            <TouchableOpacity onPress={onClose} style={styles.headerIcon} accessibilityLabel="Back" testID="image-viewer-back">
              <Feather name="arrow-left" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={styles.headerTitle}>
              <Text style={styles.headerName} numberOfLines={1}>{senderLabel}</Text>
              <Text style={styles.headerTime} numberOfLines={1}>{timeLabel}</Text>
            </View>
            <TouchableOpacity
              onPress={() => void handleDownload()}
              style={styles.headerIcon}
              accessibilityLabel={
                downloadState === 'done' ? 'Saved to gallery' : downloadState === 'saving' ? 'Saving…' : 'Save to gallery'
              }
              disabled={downloadState === 'saving'}
              testID="image-viewer-download"
            >
              {downloadState === 'saving' ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : downloadState === 'done' ? (
                <Feather name="check" size={22} color="#4ADE80" />
              ) : downloadState === 'error' ? (
                <Feather name="alert-circle" size={22} color="#F87171" />
              ) : (
                <Feather name="download" size={22} color="#FFFFFF" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onForward(message)}
              style={styles.headerIcon}
              accessibilityLabel="Forward"
              testID="image-viewer-forward"
            >
              <MaterialCommunityIcons name="share-all" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMenuOpen((v) => !v)}
              style={styles.headerIcon}
              accessibilityLabel="More options"
              testID="image-viewer-more"
            >
              <Feather name="more-vertical" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}

        {chromeVisible && menuOpen && (
          <View style={[styles.menu, { top: insets.top + 48 }]} testID="image-viewer-menu">
            <TouchableOpacity
              onPress={() => {
                setMenuOpen(false);
                onDelete(message);
              }}
              style={styles.menuItem}
              accessibilityLabel="Delete"
              testID="image-viewer-delete"
            >
              <Feather name="trash-2" size={18} color="#111827" />
              <Text style={styles.menuText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}

        {chromeVisible && (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 10) }]} testID="image-viewer-footer">
            {downloadState !== 'idle' && (
              <Text style={styles.downloadHint} testID="image-viewer-download-status">
                {downloadState === 'saving'
                  ? 'Saving to gallery…'
                  : downloadState === 'done'
                  ? 'Saved to gallery'
                  : 'Could not save this photo'}
              </Text>
            )}
            <View style={styles.replyRow}>
              <TextInput
                value={replyText}
                onChangeText={setReplyText}
                placeholder="Reply"
                placeholderTextColor="rgba(255,255,255,0.6)"
                style={styles.replyInput}
                returnKeyType="send"
                onSubmitEditing={handleSendReply}
                blurOnSubmit={false}
                testID="image-viewer-reply-input"
              />
              <TouchableOpacity
                onPress={handleSendReply}
                disabled={!replyText.trim()}
                style={[styles.replySend, { opacity: replyText.trim() ? 1 : 0.4 }]}
                accessibilityLabel="Send reply"
                testID="image-viewer-reply-send"
              >
                <Feather name="send" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  stage: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  imageWrap: { alignItems: 'center', justifyContent: 'center' },
  loadingOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, paddingHorizontal: 4 },
  headerName: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  headerTime: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  menu: {
    position: 'absolute',
    right: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 6,
    minWidth: 160,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  menuText: { color: '#111827', fontSize: 15, fontFamily: 'Inter_500Medium' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 8,
  },
  downloadHint: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  replyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  replyInput: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.14)',
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  replySend: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#006DA8',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
