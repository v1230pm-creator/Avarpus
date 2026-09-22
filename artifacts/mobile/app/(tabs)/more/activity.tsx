import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, space } from '@/constants/spacing';
import { FadeInView, FlatCard } from '@/components/ui/Glass';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { formatDate } from '@/utils/helpers';
import { useActivityFeed, ActivityFeedType } from '@workspace/api-client-react';

export default function ActivityFeedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [filterType, setFilterType] = useState<ActivityFeedType | undefined>(undefined);
  const [page, setPage] = useState(1);
  const limit = 50;

  const { data, isLoading, refetch } = useActivityFeed({
    page,
    limit,
    type: filterType,
  });

  const activities = data?.activity || [];

  const renderItem = ({ item }: { item: any }) => {
    const isLogin = item.type === 'login';
    const icon = isLogin ? 'log-in' : 'tool';
    const color = isLogin ? colors.info : colors.primary;

    return (
      <TouchableOpacity
        disabled={!item.repairId}
        onPress={() => item.repairId && router.push(`/(tabs)/repairs/${item.repairId}`)}
      >
        <FlatCard style={{ marginBottom: 12, padding: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color + '15', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
              <Feather name={icon as any} size={16} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={{ ...font.bodyStrong, color: colors.foreground, flex: 1, marginRight: space.sm }}>
                  {item.action}
                </Text>
                <Text style={{ ...font.caption, color: colors.mutedForeground }}>
                  {formatDate(item.createdAt)}
                </Text>
              </View>
              <Text style={{ ...font.captionStrong, color: colors.mutedForeground, marginTop: space.xs }}>
                by {item.userName} ({item.userRole})
              </Text>
              {item.repairId && (
                <Text style={{ ...font.captionStrong, color: colors.primary, marginTop: space.sm }}>
                  View Repair
                </Text>
              )}
            </View>
          </View>
        </FlatCard>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[{ flex: 1, backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? insets.top + 67 : insets.top + 16 }]}>

      <View style={{ paddingHorizontal: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border }}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={{ ...font.title, color: colors.foreground }}>Activity Log</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, marginBottom: 16 }}>
        <TouchableOpacity onPress={() => setFilterType(undefined)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: filterType === undefined ? colors.primary : colors.card, borderWidth: 1, borderColor: filterType === undefined ? colors.primary : colors.border }}>
          <Text style={{ color: filterType === undefined ? colors.primaryForeground : colors.foreground, ...font.captionStrong }}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFilterType(ActivityFeedType.repair)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: filterType === ActivityFeedType.repair ? colors.primary : colors.card, borderWidth: 1, borderColor: filterType === ActivityFeedType.repair ? colors.primary : colors.border }}>
          <Text style={{ color: filterType === ActivityFeedType.repair ? colors.primaryForeground : colors.foreground, ...font.captionStrong }}>Repairs</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFilterType(ActivityFeedType.login)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: filterType === ActivityFeedType.login ? colors.primary : colors.card, borderWidth: 1, borderColor: filterType === ActivityFeedType.login ? colors.primary : colors.border }}>
          <Text style={{ color: filterType === ActivityFeedType.login ? colors.primaryForeground : colors.foreground, ...font.captionStrong }}>Logins</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <AvarpusSpinner size={20} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={activities}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={{ textAlign: 'center', marginTop: 40, color: colors.mutedForeground }}>No activity found.</Text>
          }
        />
      )}
    </View>
  );
}
