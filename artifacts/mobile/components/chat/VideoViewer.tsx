import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatMessage } from '@workspace/api-client-react';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { chatMediaUri, formatRelativeTime } from './messageActions';

interface VideoViewerProps {
  visible: boolean;
  message: ChatMessage | null;
  token: string | null;
  senderLabel: string;
  onClose: () => void;
  onForward: (message: ChatMessage) => void;
  /** Download the clip and hand it to the OS (save / share). Reject to show an error. */
  onDownload: (message: ChatMessage) => Promise<void>;
}

type DownloadState = 'idle' | 'saving' | 'done' | 'error';

/**
 * Full-screen video player for chat clips. The bytes come from the
 * authenticated media endpoint, so the player source carries the bearer
 * token; native controls handle scrubbing/fullscreen.
 */
export function VideoViewer({
  visible,
  message,
  token,
  senderLabel,
  onClose,
  onForward,
  onDownload,
}: VideoViewerProps) {
  const insets = useSafeAreaInsets();
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');

  const source = useMemo(
    () =>
      visible && message
        ? {
            uri: chatMediaUri(message.roomId, message.id),
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          }
        : null,
    [message, token, visible],
  );
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    if (source) instance.play();
  });

  useEffect(() => {
    setDownloadState('idle');
    if (!visible) player.pause();
  }, [message?.id, player, visible]);

  if (!message) return null;

  const handleDownload = async () => {
    if (downloadState === 'saving') return;
    setDownloadState('saving');
    try {
      await onDownload(message);
      setDownloadState('done');
    } catch {
      setDownloadState('error');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onClose}
      testID="video-viewer"
    >
      {Platform.OS !== 'web' && <StatusBar barStyle="light-content" backgroundColor="#000" />}
      <View style={styles.root}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls
          allowsPictureInPicture={false}
        />
        <View style={[styles.header, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <TouchableOpacity onPress={onClose} style={styles.iconButton} accessibilityLabel="Close video">
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {senderLabel}
            </Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {formatRelativeTime(message.createdAt)} · {message.body}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => onForward(message)}
            style={styles.iconButton}
            accessibilityLabel="Forward video"
          >
            <Feather name="corner-up-right" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void handleDownload()}
            style={styles.iconButton}
            accessibilityLabel={downloadState === 'done' ? 'Video saved' : 'Save video'}
            disabled={downloadState === 'saving'}
          >
            {downloadState === 'saving' ? (
              <AvarpusSpinner size={18} />
            ) : (
              <Feather
                name={downloadState === 'done' ? 'check' : downloadState === 'error' ? 'alert-circle' : 'download'}
                size={20}
                color="#fff"
              />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  headerCopy: { flex: 1, paddingHorizontal: 4 },
  headerTitle: { color: '#fff', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  headerSubtitle: { color: 'rgba(255,255,255,0.72)', fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
});
