import React from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FlatCard } from '@/components/ui/Glass';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { useNotificationsList, notificationsMarkRead, getNotificationsListQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getNotificationRoute } from '@/utils/notificationNavigation';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

// ── Notifications ───────────────────────────────────────────────────────────
// In-app notification inbox: new repairs, status changes, payments, approval
// requests and decisions. Rows are created server-side; this screen polls.

const TYPE_ICON: Record<string, { icon: any; tone: 'primary' | 'success' | 'warning' | 'destructive' | 'mutedForeground' }> = {
  repair_created: { icon: 'tool', tone: 'primary' },
  repair_status: { icon: 'refresh-cw', tone: 'success' },
  repair_assigned: { icon: 'user-check', tone: 'primary' },
  payment_recorded: { icon: 'credit-card', tone: 'warning' },
  approval_requested: { icon: 'clock', tone: 'destructive' },
  approval_decided: { icon: 'check-circle', tone: 'success' },
  chat_message: { icon: 'message-circle', tone: 'primary' },
  chat_report_reviewed: { icon: 'shield', tone: 'mutedForeground' },
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useNotificationsList({ query: { refetchInterval: 30000 } } as any);
  const notifications = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const markAllRead = async () => {
    try {
      await notificationsMarkRead({});
      await queryClient.invalidateQueries({ queryKey: getNotificationsListQueryKey() });
    } catch {
      // best-effort
    }
  };

  const openItem = async (n: (typeof notifications)[number]) => {
    if (!n.read) {
      try {
        await notificationsMarkRead({ ids: [n.id] });
        queryClient.invalidateQueries({ queryKey: getNotificationsListQueryKey() });
      } catch {
        // best-effort
      }
    }
    const route = getNotificationRoute(n.data);
    if (route) router.push(route as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }} activeOpacity={0.7}>
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
        {unread > 0 && (
          <TouchableOpacity onPress={markAllRead} activeOpacity={0.7} style={{ marginLeft: 'auto' }}>
            <Text style={{ color: colors.primary, ...font.smallStrong }}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: layout.screenPadding, paddingTop: space.md, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={() => refetch()} tintColor={colors.primary} />}
      >
        {isLoading ? (
          <AvarpusSpinner size={20} style={{ marginTop: 40 }} />
        ) : notifications.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Feather name="bell-off" size={32} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, marginTop: space.md, ...font.captionStrong }}>
              No notifications yet
            </Text>
          </View>
        ) : (
          <FlatCard style={{ paddingVertical: 4 }}>
            {notifications.map((n, idx) => {
              const meta = TYPE_ICON[n.type] ?? { icon: 'bell', tone: 'primary' as const };
              const iconColor = colors[meta.tone];
              return (
                <TouchableOpacity
                  key={n.id}
                  onPress={() => openItem(n)}
                  activeOpacity={0.7}
                  style={[styles.row, idx < notifications.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                >
                   <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
                     <Feather name={meta.icon} size={size.inlineIcon} color={iconColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[n.read ? font.captionStrong : font.labelStrong, { color: colors.foreground }]}>
                      {n.title}
                    </Text>
                    {!!n.body && (
                      <Text style={{ color: colors.mutedForeground, ...font.caption, marginTop: 2 }} numberOfLines={2}>
                        {n.body}
                      </Text>
                    )}
                    <Text style={{ color: colors.mutedForeground, ...font.caption, marginTop: space.xs }}>
                      {timeAgo(n.createdAt)}
                    </Text>
                  </View>
                   {!n.read && <View style={[styles.unreadDot, { backgroundColor: colors.notification }]} />}
                </TouchableOpacity>
              );
            })}
          </FlatCard>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: layout.screenPadding, paddingBottom: space.md },
  headerTitle: { ...font.title },
  row: { minHeight: 64, flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: layout.rowPaddingVertical, alignItems: 'flex-start' },
  iconWrap: { width: size.avatarSm, height: size.avatarSm, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
});
