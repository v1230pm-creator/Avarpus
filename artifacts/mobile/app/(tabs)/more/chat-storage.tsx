import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { font } from '@/constants/typography';
import { layout, radius, size, space, hitSlop } from '@/constants/spacing';
import { useChatStore } from '@/context/ChatStoreContext';
import { useLocalRooms } from '@/hooks/useLocalChat';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import {
  AUTO_DOWNLOAD_KINDS,
  AUTO_DOWNLOAD_RULES,
  clearRoomMedia,
  type AutoDownloadKind,
  type AutoDownloadRule,
} from '@/utils/chatMedia';
import type { RoomMediaUsage } from '@/utils/chatStore';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Chat storage: what the device keeps for each conversation (photos, videos,
 * voice notes, documents live in app-private storage, not the server) and
 * the auto-download rules that decide what is fetched without a tap.
 */
export default function ChatStorageScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { store, media, mediaFiles, autoDownload, setAutoDownload, ready } = useChatStore();
  const rooms = useLocalRooms(!!store);
  const { confirm } = useConfirmDialog();
  const [usage, setUsage] = useState<RoomMediaUsage[] | null>(null);
  const [clearingRoomId, setClearingRoomId] = useState<string | null>(null);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const refreshUsage = useCallback(() => {
    if (!store) {
      setUsage([]);
      return;
    }
    store
      .mediaUsageByRoom()
      .then(setUsage)
      .catch(() => setUsage([]));
  }, [store]);

  useEffect(() => {
    refreshUsage();
    if (!store) return;
    return store.subscribe(() => refreshUsage());
  }, [store, refreshUsage]);

  const roomName = useMemo(() => {
    const map = new Map<string, string>();
    for (const room of rooms.data ?? []) map.set(room.id, room.name);
    return map;
  }, [rooms.data]);

  const total = useMemo(
    () => (usage ?? []).reduce((acc, row) => ({ bytes: acc.bytes + row.bytes, files: acc.files + row.files }), { bytes: 0, files: 0 }),
    [usage],
  );

  const handleClearRoom = useCallback(
    (row: RoomMediaUsage) => {
      if (!store) return;
      const name = roomName.get(row.roomId) ?? 'this chat';
      confirm({
        title: `Clear media from ${name}?`,
        message: `${row.files} ${row.files === 1 ? 'file' : 'files'} (${formatBytes(row.bytes)}) will be removed from this device. Messages stay; media that is still on the server can be downloaded again.`,
        caption: null,
        icon: 'trash-2',
        actions: [
          {
            label: 'Clear media',
            icon: 'trash-2',
            onPress: async () => {
              setClearingRoomId(row.roomId);
              try {
                await clearRoomMedia(store, mediaFiles, row.roomId, media);
              } finally {
                setClearingRoomId(null);
                refreshUsage();
              }
            },
          },
        ],
      });
    },
    [confirm, media, mediaFiles, refreshUsage, roomName, store],
  );

  const setRule = useCallback(
    (kind: AutoDownloadKind, rule: AutoDownloadRule) => {
      void setAutoDownload({ ...autoDownload, [kind]: rule });
    },
    [autoDownload, setAutoDownload],
  );

  const sortedUsage = useMemo(() => [...(usage ?? [])].sort((a, b) => b.bytes - a.bytes), [usage]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Storage and data</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Media auto-download</Text>
        <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
          Attachments are kept on this phone, not on the server. Choose what downloads by itself; everything else
          downloads when you tap it.
        </Text>
        {AUTO_DOWNLOAD_KINDS.map((kind) => (
          <View key={kind.key} style={styles.ruleRow} testID={`auto-download-${kind.key}`}>
            <View style={styles.ruleCopy}>
              <Text style={[styles.settingTitle, { color: colors.foreground }]}>{kind.label}</Text>
              <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>{kind.hint}</Text>
            </View>
            <View style={[styles.segment, { borderColor: colors.border }]}>
              {AUTO_DOWNLOAD_RULES.map((rule) => {
                const active = autoDownload[kind.key] === rule.value;
                return (
                  <TouchableOpacity hitSlop={hitSlop.chip}
                    key={rule.value}
                    onPress={() => setRule(kind.key, rule.value)}
                    style={[styles.segmentItem, active && { backgroundColor: colors.primary }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${kind.label}: ${rule.label}`}
                    testID={`auto-download-${kind.key}-${rule.value}`}
                  >
                    <Text style={[styles.segmentText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                      {rule.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Chat media on this device</Text>
        <View style={styles.totalRow}>
          <Text style={[styles.totalValue, { color: colors.foreground }]} testID="chat-storage-total">
            {formatBytes(total.bytes)}
          </Text>
          <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>
            {total.files} {total.files === 1 ? 'file' : 'files'} across {sortedUsage.length}{' '}
            {sortedUsage.length === 1 ? 'chat' : 'chats'}
          </Text>
        </View>

        {!ready || usage === null ? (
          <View style={styles.centered}>
            <AvarpusSpinner size={22} />
          </View>
        ) : !store ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Chat media is not stored on this device.
          </Text>
        ) : sortedUsage.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No chat media on this device yet.</Text>
        ) : (
          sortedUsage.map((row) => (
            <View key={row.roomId} style={styles.roomRow} testID={`chat-storage-room-${row.roomId}`}>
              <View style={styles.ruleCopy}>
                <Text style={[styles.settingTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {roomName.get(row.roomId) ?? 'Chat'}
                </Text>
                <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>
                  {formatBytes(row.bytes)} · {row.files} {row.files === 1 ? 'file' : 'files'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleClearRoom(row)}
                disabled={clearingRoomId !== null}
                style={[styles.clearButton, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={`Clear media from ${roomName.get(row.roomId) ?? 'chat'}`}
                testID={`chat-storage-clear-${row.roomId}`}
              >
                {clearingRoomId === row.roomId ? (
                  <AvarpusSpinner size={14} />
                ) : (
                  <Text style={[styles.clearText, { color: colors.destructive }]}>Clear</Text>
                )}
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.headerHeight,
    paddingHorizontal: space.sm,
    borderBottomWidth: 1,
  },
  backButton: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title, marginLeft: space.sm },
  sectionLabel: {
    marginTop: space.xxl,
    marginBottom: 4,
    paddingHorizontal: layout.screenPadding,
    ...font.overline,
  },
  sectionHint: {
    paddingHorizontal: layout.screenPadding,
    marginBottom: 8,
    ...font.body,
  },
  ruleRow: { paddingVertical: space.md, paddingHorizontal: layout.screenPadding, gap: space.sm },
  ruleCopy: { flex: 1, paddingRight: 14 },
  settingTitle: { ...font.bodyStrong },
  settingSubtitle: { ...font.caption },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  segmentItem: { flex: 1, minHeight: size.chip, justifyContent: 'center', alignItems: 'center' },
  segmentText: { ...font.smallStrong },
  sectionDivider: { marginTop: 10, borderTopWidth: 1 },
  totalRow: { paddingHorizontal: layout.screenPadding, paddingVertical: space.sm, gap: 2 },
  totalValue: { ...font.title },
  roomRow: {
    minHeight: layout.headerHeight,
    paddingVertical: space.sm,
    paddingHorizontal: layout.screenPadding,
    flexDirection: 'row',
    alignItems: 'center',
  },
  clearButton: {
    minWidth: 64,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  clearText: { ...font.captionStrong },
  centered: { paddingVertical: 24, alignItems: 'center' },
  emptyText: { paddingHorizontal: layout.screenPadding, paddingVertical: space.lg, ...font.caption },
});
