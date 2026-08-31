import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getStatusesListQueryKey,
  statusesCreate,
  statusesDelete,
  statusesUploadUrl,
  statusesView,
  useStatusesList,
  type StatusGroup,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { Avatar } from '@/components/ui/Avatar';
import { StatusViewer } from '@/components/status/StatusViewer';
import { KEYS, storage } from '@/utils/storage';

type PendingMedia = {
  uri: string;
  name: string;
  size: number;
  contentType: string;
  kind: 'image' | 'video';
};

function timeLabel(value: string): string {
  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return date.toLocaleDateString();
}

function errorText(error: unknown): string {
  const message = (error as { data?: { message?: string } })?.data?.message;
  if (message) return message;
  return error instanceof Error ? error.message : 'Please try again.';
}

export default function StatusScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const statusQuery = useStatusesList({
    query: {
      queryKey: getStatusesListQueryKey(),
      staleTime: 15_000,
      refetchInterval: 30_000,
      refetchOnMount: 'always',
    },
  });
  const [token, setToken] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [textStatus, setTextStatus] = useState('');
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    storage.get<string>(KEYS.AUTH_TOKEN).then(setToken).catch(() => setToken(null));
  }, []);

  const groups = statusQuery.data?.groups ?? [];
  const ownGroup = groups.find((group) => group.userId === user?.id) ?? null;
  const contactGroups = groups.filter((group) => group.userId !== user?.id);
  const recentGroups = contactGroups.filter((group) => group.hasUnviewed);
  const viewedGroups = contactGroups.filter((group) => !group.hasUnviewed);
  const selectedGroup = useMemo(
    () => groups.find((group) => group.userId === selectedUserId) ?? null,
    [groups, selectedUserId],
  );

  const notify = (title: string, message: string) => {
    if (Platform.OS === 'web') window.alert(`${title}\n${message}`);
    else Alert.alert(title, message);
  };

  const resetComposer = () => {
    setTextStatus('');
    setPendingMedia(null);
    setComposerOpen(false);
  };

  const openTextComposer = () => {
    setPendingMedia(null);
    setComposerOpen(true);
  };

  const readMedia = async (asset: ImagePicker.ImagePickerAsset): Promise<PendingMedia> => {
    const fileInfo = await FileSystem.getInfoAsync(asset.uri);
    const size = asset.fileSize ?? (fileInfo.exists ? fileInfo.size ?? 0 : 0);
    const isVideo = asset.type === 'video';
    const contentType = asset.mimeType
      ?? (isVideo ? 'video/mp4' : 'image/jpeg');
    const extension = isVideo ? 'mp4' : 'jpg';
    return {
      uri: asset.uri,
      name: asset.fileName ?? `status-${Date.now()}.${extension}`,
      size,
      contentType,
      kind: isVideo ? 'video' : 'image',
    };
  };

  const selectMedia = async (source: 'camera' | 'gallery') => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          notify('Camera permission needed', 'Allow camera access to capture a status.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        quality: 0.9,
        videoMaxDuration: 30,
      };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) return;
      const media = await readMedia(result.assets[0]);
      if (media.size <= 0) {
        notify('Could not read media', 'Choose another photo or video.');
        return;
      }
      setPendingMedia(media);
      setComposerOpen(true);
    } catch (error) {
      notify('Could not open media', errorText(error));
    }
  };

  const publish = async () => {
    if (!pendingMedia && !textStatus.trim()) return;
    setPublishing(true);
    try {
      if (pendingMedia) {
        const upload = await statusesUploadUrl({
          name: pendingMedia.name,
          size: pendingMedia.size,
          contentType: pendingMedia.contentType,
        });
        if (Platform.OS === 'web') {
          const localResponse = await fetch(pendingMedia.uri);
          const bytes = await localResponse.blob();
          const response = await fetch(upload.uploadURL, {
            method: 'PUT',
            headers: { 'Content-Type': pendingMedia.contentType },
            body: bytes,
          });
          if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status})`);
        } else {
          const response = await FileSystem.createUploadTask(
            upload.uploadURL,
            pendingMedia.uri,
            {
              httpMethod: 'PUT',
              headers: { 'Content-Type': pendingMedia.contentType },
              uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            },
          ).uploadAsync();
          if (!response || response.status < 200 || response.status >= 300) {
            throw new Error(`Upload failed (HTTP ${response?.status ?? 'unknown'})`);
          }
        }
        await statusesCreate({
          kind: pendingMedia.kind,
          objectPath: upload.objectPath,
          mimeType: pendingMedia.contentType,
          sizeBytes: pendingMedia.size,
          audience: 'contacts',
        });
      } else {
        await statusesCreate({
          kind: 'text',
          body: textStatus.trim(),
          audience: 'contacts',
        });
      }
      resetComposer();
      await queryClient.invalidateQueries({ queryKey: getStatusesListQueryKey() });
    } catch (error) {
      notify('Could not publish status', errorText(error));
    } finally {
      setPublishing(false);
    }
  };

  const markViewed = useCallback((id: string) => {
    void statusesView(id)
      .then(() => queryClient.invalidateQueries({ queryKey: getStatusesListQueryKey() }))
      .catch(() => {});
  }, [queryClient]);

  const deleteStatus = useCallback(async (id: string) => {
    await statusesDelete(id);
    await queryClient.invalidateQueries({ queryKey: getStatusesListQueryKey() });
  }, [queryClient]);

  const openGroup = (group: StatusGroup) => setSelectedUserId(group.userId);

  const renderStatusRow = (group: StatusGroup) => (
    <TouchableOpacity
      key={group.userId}
      onPress={() => openGroup(group)}
      style={styles.statusRow}
      activeOpacity={0.72}
      accessibilityLabel={`Open ${group.name}'s status`}
      testID={`status-group-${group.userId}`}
    >
      <View
        style={[
          styles.statusRing,
          {
            borderColor: group.hasUnviewed ? colors.success : colors.border,
            borderWidth: group.hasUnviewed ? 3 : 2,
          },
        ]}
      >
        <Avatar name={group.name} url={group.profilePhoto} size={48} />
      </View>
      <View style={[styles.rowText, { borderBottomColor: colors.border }]}>
        <Text numberOfLines={1} style={[styles.rowName, { color: colors.foreground }]}>
          {group.name}
        </Text>
        <Text style={[styles.rowTime, { color: colors.mutedForeground }]}>
          {timeLabel(group.latestAt)} · {group.items.length} update{group.items.length === 1 ? '' : 's'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Updates</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => void selectMedia('camera')}
            style={[styles.iconButton, { backgroundColor: colors.surfaceSecondary }]}
            accessibilityLabel="Capture status"
            testID="status-camera"
          >
            <Feather name="camera" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/more/settings')}
            style={styles.iconButton}
            accessibilityLabel="Open settings"
            testID="status-settings-menu"
          >
            <Feather name="more-vertical" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={statusQuery.isRefetching && !statusQuery.isLoading}
            onRefresh={() => void statusQuery.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Status</Text>
        <TouchableOpacity
          onPress={() => ownGroup ? openGroup(ownGroup) : openTextComposer()}
          onLongPress={openTextComposer}
          style={styles.statusRow}
          activeOpacity={0.72}
          testID="add-status"
        >
          <View style={styles.addAvatar}>
            <Avatar name={user?.name ?? 'You'} url={user?.profilePhoto} size={54} />
            <TouchableOpacity
              onPress={openTextComposer}
              style={[styles.addBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}
              accessibilityLabel="Add status"
            >
              <Feather name="plus" size={15} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.rowName, { color: colors.foreground }]}>My status</Text>
            <Text style={[styles.rowTime, { color: colors.mutedForeground }]}>
              {ownGroup ? 'Tap to view · Hold to add another' : 'Tap to add status update'}
            </Text>
          </View>
        </TouchableOpacity>

        {statusQuery.isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.stateText, { color: colors.mutedForeground }]}>Loading updates…</Text>
          </View>
        ) : statusQuery.isError ? (
          <TouchableOpacity style={styles.stateBox} onPress={() => void statusQuery.refetch()}>
            <Feather name="wifi-off" size={28} color={colors.mutedForeground} />
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>Couldn’t load updates</Text>
            <Text style={[styles.stateText, { color: colors.primary }]}>Tap to try again</Text>
          </TouchableOpacity>
        ) : contactGroups.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.successLight }]}>
              <Feather name="clock" size={26} color={colors.success} />
            </View>
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>No recent updates</Text>
            <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
              New 24-hour updates from your Avarpus contacts will appear here.
            </Text>
          </View>
        ) : (
          <>
            {recentGroups.length > 0 && (
              <View style={styles.groupSection}>
                <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Recent updates</Text>
                {recentGroups.map(renderStatusRow)}
              </View>
            )}
            {viewedGroups.length > 0 && (
              <View style={styles.groupSection}>
                <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Viewed updates</Text>
                {viewedGroups.map(renderStatusRow)}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={[styles.floatingActions, { bottom: Math.max(insets.bottom, 10) + 8 }]}>
        <TouchableOpacity
          onPress={openTextComposer}
          style={[styles.smallFab, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
          accessibilityLabel="Create text status"
        >
          <Feather name="edit-2" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => void selectMedia('camera')}
          style={[styles.fab, { backgroundColor: colors.success }]}
          accessibilityLabel="Create camera status"
        >
          <Feather name="camera" size={23} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <Modal
        visible={composerOpen}
        transparent
        animationType="slide"
        onRequestClose={publishing ? undefined : resetComposer}
      >
        <View style={styles.composerBackdrop}>
          <View style={[styles.composer, { backgroundColor: colors.card }]}>
            <View style={styles.composerHeader}>
              <TouchableOpacity onPress={resetComposer} disabled={publishing} style={styles.iconButton}>
                <Feather name="x" size={24} color={colors.foreground} />
              </TouchableOpacity>
              <Text style={[styles.composerTitle, { color: colors.foreground }]}>New status</Text>
              <TouchableOpacity
                onPress={publish}
                disabled={publishing || (!pendingMedia && !textStatus.trim())}
                testID="publish-status"
                style={[
                  styles.publishButton,
                  { backgroundColor: colors.primary },
                  (publishing || (!pendingMedia && !textStatus.trim())) && { opacity: 0.45 },
                ]}
              >
                {publishing
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Feather name="send" size={19} color="#FFFFFF" />}
              </TouchableOpacity>
            </View>

            {pendingMedia ? (
              <View style={[styles.mediaChoice, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <View style={[styles.mediaIcon, { backgroundColor: colors.accent }]}>
                  <Feather name={pendingMedia.kind === 'video' ? 'video' : 'image'} size={28} color={colors.primary} />
                </View>
                <Text numberOfLines={1} style={[styles.mediaName, { color: colors.foreground }]}>{pendingMedia.name}</Text>
                <Text style={[styles.mediaMeta, { color: colors.mutedForeground }]}>
                  {(pendingMedia.size / 1024 / 1024).toFixed(1)} MB · {pendingMedia.kind}
                </Text>
                <TouchableOpacity onPress={() => setPendingMedia(null)} style={styles.removeMedia}>
                  <Feather name="trash-2" size={18} color={colors.destructive} />
                </TouchableOpacity>
              </View>
            ) : (
              <TextInput
                value={textStatus}
                onChangeText={setTextStatus}
                placeholder="Type a status"
                placeholderTextColor="rgba(255,255,255,0.7)"
                multiline
                maxLength={7000}
                autoFocus
                textAlignVertical="center"
                style={styles.textComposer}
              />
            )}

            <View style={[styles.composerTools, { borderTopColor: colors.border }]}>
              <TouchableOpacity onPress={openTextComposer} style={styles.toolButton}>
                <Feather name="type" size={22} color={colors.foreground} />
                <Text style={[styles.toolLabel, { color: colors.foreground }]}>Text</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void selectMedia('gallery')} style={styles.toolButton}>
                <Feather name="image" size={22} color={colors.foreground} />
                <Text style={[styles.toolLabel, { color: colors.foreground }]}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void selectMedia('camera')} style={styles.toolButton}>
                <Feather name="camera" size={22} color={colors.foreground} />
                <Text style={[styles.toolLabel, { color: colors.foreground }]}>Camera</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <StatusViewer
        visible={!!selectedGroup}
        group={selectedGroup}
        currentUserId={user?.id ?? null}
        token={token}
        onClose={() => setSelectedUserId(null)}
        onViewed={markViewed}
        onDelete={deleteStatus}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 74,
    paddingHorizontal: 18,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.8 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 140 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginTop: 8, marginBottom: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', minHeight: 72, gap: 12 },
  addAvatar: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center' },
  addBadge: { position: 'absolute', right: 1, bottom: 0, width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  statusRing: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minHeight: 72, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  rowName: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  rowTime: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  groupSection: { marginTop: 20 },
  groupLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: 5 },
  stateBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 54, gap: 10 },
  stateTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, textAlign: 'center' },
  stateText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 286 },
  emptyCard: { alignItems: 'center', marginTop: 24, padding: 28, borderRadius: 20, borderWidth: 1 },
  emptyIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  floatingActions: { position: 'absolute', right: 18, alignItems: 'center', gap: 12 },
  smallFab: { width: 46, height: 46, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  fab: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', elevation: 5 },
  composerBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  composer: { borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden', paddingBottom: Platform.OS === 'web' ? 34 : 20 },
  composerHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  composerTitle: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 18, marginLeft: 6 },
  publishButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  textComposer: { minHeight: 260, backgroundColor: '#165D8C', color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 28, lineHeight: 37, textAlign: 'center', padding: 30 },
  mediaChoice: { minHeight: 260, marginHorizontal: 18, borderWidth: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center', padding: 28 },
  mediaIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  mediaName: { fontFamily: 'Inter_600SemiBold', fontSize: 15, maxWidth: '86%' },
  mediaMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 5, textTransform: 'capitalize' },
  removeMedia: { position: 'absolute', right: 14, top: 14, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  composerTools: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, marginTop: 18, paddingTop: 14, paddingHorizontal: 20 },
  toolButton: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 52 },
  toolLabel: { fontFamily: 'Inter_500Medium', fontSize: 12 },
});