import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { StatusGroup, StatusViewer as Viewer } from '@workspace/api-client-react';
import { statusesViewersList } from '@workspace/api-client-react';
import { Avatar } from '@/components/ui/Avatar';
import { StatusMedia } from './StatusMedia';

const IMAGE_DURATION_MS = 7_000;
const VIDEO_DURATION_MS = 15_000;

function ageLabel(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export function StatusViewer({
  visible,
  group,
  currentUserId,
  token,
  onClose,
  onViewed,
  onDelete,
}: {
  visible: boolean;
  group: StatusGroup | null;
  currentUserId: string | null;
  token: string | null;
  onClose: () => void;
  onViewed: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const firstUnviewed = useMemo(() => {
    if (!group) return 0;
    const index = group.items.findIndex((item) => !item.viewed);
    return index >= 0 ? index : 0;
  }, [group]);
  const [index, setIndex] = useState(firstUnviewed);
  const [progress, setProgress] = useState(0);
  const [viewers, setViewers] = useState<Viewer[] | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setIndex(firstUnviewed);
    setProgress(0);
    setViewers(null);
  }, [group?.userId, visible]);

  const item = group?.items[index] ?? null;
  const own = !!item && item.authorId === currentUserId;

  useEffect(() => {
    if (!visible || !item) return;
    onViewed(item.id);
    setProgress(0);
    const duration = item.kind === 'video' ? VIDEO_DURATION_MS : IMAGE_DURATION_MS;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const next = Math.min(1, (Date.now() - startedAt) / duration);
      setProgress(next);
      if (next >= 1) {
        clearInterval(timer);
        if (group && index < group.items.length - 1) {
          setIndex((current) => current + 1);
        } else {
          onClose();
        }
      }
    }, 100);
    return () => clearInterval(timer);
  }, [group?.userId, group?.items.length, index, item?.id, onClose, onViewed, visible]);

  if (!group || !item) return null;

  const previous = () => {
    if (index > 0) setIndex(index - 1);
    else onClose();
  };
  const next = () => {
    if (index < group.items.length - 1) setIndex(index + 1);
    else onClose();
  };
  const showViewers = async () => {
    if (!own) return;
    setViewerLoading(true);
    try {
      const response = await statusesViewersList(item.id);
      setViewers(response.viewers);
    } finally {
      setViewerLoading(false);
    }
  };
  const deleteCurrent = async () => {
    setDeleting(true);
    try {
      await onDelete(item.id);
      if (group.items.length <= 1) onClose();
      else if (index >= group.items.length - 1) setIndex(index - 1);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.viewer}>
        <View style={styles.media}>
          <StatusMedia item={item} token={token} autoPlay />
        </View>

        <View style={[styles.topOverlay, { paddingTop: Platform.OS === 'web' ? 26 : 14 }]}>
          <View style={styles.progressRow}>
            {group.items.map((status, statusIndex) => (
              <View key={status.id} style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: statusIndex < index
                        ? '100%'
                        : statusIndex === index
                          ? `${progress * 100}%`
                          : '0%',
                    },
                  ]}
                />
              </View>
            ))}
          </View>
          <View style={styles.identityRow}>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityLabel="Close status">
              <Feather name="arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Avatar name={group.name} url={group.profilePhoto} size={38} />
            <View style={styles.identityText}>
              <Text numberOfLines={1} style={styles.name}>{own ? 'My status' : group.name}</Text>
              <Text style={styles.time}>{ageLabel(item.createdAt)}</Text>
            </View>
            {own && (
              <TouchableOpacity
                onPress={deleteCurrent}
                disabled={deleting}
                style={styles.actionButton}
                accessibilityLabel="Delete status"
              >
                {deleting
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Feather name="trash-2" size={20} color="#FFFFFF" />}
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Pressable onPress={previous} style={[styles.tapZone, styles.leftZone]} accessibilityLabel="Previous status" />
        <Pressable onPress={next} style={[styles.tapZone, styles.rightZone]} accessibilityLabel="Next status" />

        {own && (
          <TouchableOpacity onPress={showViewers} style={styles.viewerButton} accessibilityLabel="Show status viewers">
            <Feather name="eye" size={20} color="#FFFFFF" />
            <Text style={styles.viewerCount}>{item.viewerCount}</Text>
          </TouchableOpacity>
        )}

        <Modal
          visible={viewers !== null || viewerLoading}
          transparent
          animationType="slide"
          onRequestClose={() => setViewers(null)}
        >
          <Pressable style={styles.sheetBackdrop} onPress={() => setViewers(null)}>
            <Pressable style={styles.viewerSheet} onPress={() => {}}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Viewed by {item.viewerCount}</Text>
              {viewerLoading ? (
                <ActivityIndicator color="#0F62FE" style={{ marginTop: 28 }} />
              ) : viewers?.length ? (
                <ScrollView>
                  {viewers.map((viewer) => (
                    <View key={viewer.userId} style={styles.viewerRow}>
                      <Avatar name={viewer.name} url={viewer.profilePhoto} size={44} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.viewerName}>{viewer.name}</Text>
                        <Text style={styles.viewerTime}>Viewed {ageLabel(viewer.viewedAt)} ago</Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <View style={styles.noViewers}>
                  <Feather name="eye-off" size={30} color="#8792A2" />
                  <Text style={styles.noViewersText}>No views yet</Text>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: '#05080D' },
  media: { ...StyleSheet.absoluteFill },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingBottom: 22,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  progressRow: { flexDirection: 'row', gap: 3, marginBottom: 10 },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.35)' },
  progressFill: { height: '100%', backgroundColor: '#FFFFFF' },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  closeButton: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  identityText: { flex: 1 },
  name: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  time: { color: 'rgba(255,255,255,0.75)', fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  actionButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  tapZone: { position: 'absolute', top: 105, bottom: 80, width: '34%' },
  leftZone: { left: 0 },
  rightZone: { right: 0 },
  viewerButton: {
    position: 'absolute',
    bottom: 28,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minWidth: 62,
    justifyContent: 'center',
    paddingHorizontal: 16,
    height: 42,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  viewerCount: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  viewerSheet: {
    maxHeight: '58%',
    minHeight: 220,
    paddingHorizontal: 18,
    paddingBottom: 30,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#FFFFFF',
  },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#D6DCE5', alignSelf: 'center', marginTop: 10, marginBottom: 18 },
  sheetTitle: { color: '#111827', fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 8 },
  viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  viewerName: { color: '#111827', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  viewerTime: { color: '#6B7280', fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
  noViewers: { alignItems: 'center', justifyContent: 'center', paddingTop: 42, gap: 10 },
  noViewersText: { color: '#6B7280', fontFamily: 'Inter_500Medium', fontSize: 14 },
});