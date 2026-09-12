import React from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { FlatCard } from '@/components/ui/Glass';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import {
  chatMyReportList,
  getChatMyReportListQueryKey,
  type ChatMyReport,
} from '@workspace/api-client-react';

// ── Safety reports ──────────────────────────────────────────────────────────
// What this person reported and how far it has got. Progress is deliberately
// two words wide: reviewers are still looking, or they have finished. What
// happened to the other account is never shown here, and never will be.

const REASON_LABELS: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  scam: 'Scam',
  inappropriate: 'Inappropriate content',
  other: 'Other',
};

const STATE_LABELS: Record<string, string> = {
  in_review: 'Waiting on review',
  closed: 'Review finished',
};

function filedOn(iso: string): string {
  const filed = new Date(iso);
  if (Number.isNaN(filed.getTime())) return '';
  return filed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function MyReportsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const {
    data,
    isLoading,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isError,
  } = useInfiniteQuery({
    queryKey: getChatMyReportListQueryKey(),
    queryFn: ({ pageParam }) =>
      chatMyReportList(pageParam ? { cursor: pageParam } : undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const reports: ChatMyReport[] = (data?.pages ?? []).flatMap((page) => page.reports);
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          Safety Reports
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 12, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading && !isFetchingNextPage}
            onRefresh={() => refetch()}
            tintColor={colors.primary}
          />
        }
      >
        {isLoading ? (
          <AvarpusSpinner size={20} style={{ marginTop: 40 }} />
        ) : isError ? (
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Feather name="wifi-off" size={32} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, marginTop: 12, fontSize: 14, fontFamily: 'Inter_500Medium' }}>
              Could not load your reports
            </Text>
            <TouchableOpacity onPress={() => refetch()} activeOpacity={0.7} style={{ marginTop: 12 }}>
              <Text style={{ color: colors.primary, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : reports.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Feather name="flag" size={32} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, marginTop: 12, fontSize: 14, fontFamily: 'Inter_500Medium' }}>
              You have not reported any chats
            </Text>
            <Text
              style={{ color: colors.mutedForeground, marginTop: 6, fontSize: 12, textAlign: 'center', fontFamily: 'Inter_400Regular', paddingHorizontal: 32 }}
            >
              Reports you send from a conversation appear here with their progress.
            </Text>
          </View>
        ) : (
          <>
            <Text style={[styles.intro, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              We can’t share what happens to another person’s account, only whether your report has
              been reviewed.
            </Text>
            <FlatCard style={{ paddingVertical: 4 }}>
              {reports.map((report, idx) => {
                const closed = report.state === 'closed';
                const tone = closed ? '#34D399' : '#F2B84B';
                return (
                  <View
                    key={report.id}
                    style={[
                      styles.row,
                      idx < reports.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.border,
                      },
                    ]}
                  >
                    <View style={[styles.iconWrap, { backgroundColor: tone + '1A' }]}>
                      <Feather name={closed ? 'check-circle' : 'clock'} size={18} color={tone} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>
                        {report.room.name ?? 'Reported conversation'}
                      </Text>
                      <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 2, fontFamily: 'Inter_400Regular' }}>
                        {REASON_LABELS[report.reason] ?? report.reason}
                      </Text>
                      {!!report.details && (
                        <Text
                          style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4, fontFamily: 'Inter_400Regular' }}
                          numberOfLines={3}
                        >
                          “{report.details}”
                        </Text>
                      )}
                      <View style={styles.metaRow}>
                        <View style={[styles.statePill, { backgroundColor: tone + '1A' }]}>
                          <Text style={{ color: tone, fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>
                            {STATE_LABELS[report.state] ?? STATE_LABELS.in_review}
                          </Text>
                        </View>
                        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: 'Inter_400Regular' }}>
                          Reported {filedOn(report.createdAt)}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </FlatCard>
            {hasNextPage && (
              <TouchableOpacity
                onPress={() => fetchNextPage()}
                activeOpacity={0.7}
                disabled={isFetchingNextPage}
                style={styles.more}
              >
                {isFetchingNextPage ? (
                  <AvarpusSpinner size={20} />
                ) : (
                  <Text style={{ color: colors.primary, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
                    Show older reports
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  headerTitle: { fontSize: 20 },
  intro: { fontSize: 12, lineHeight: 17, paddingHorizontal: 4, paddingBottom: 10 },
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'flex-start' },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  statePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  more: { alignItems: 'center', paddingVertical: 16 },
});
