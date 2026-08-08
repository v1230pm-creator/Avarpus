import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ScreenGlow, FadeInView, GlassCard } from '@/components/ui/Glass';
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
        <GlassCard style={{ marginBottom: 12, padding: 16 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color + '15', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
              <Feather name={icon as any} size={16} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold', flex: 1, marginRight: 8 }}>
                  {item.action}
                </Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                  {formatDate(item.createdAt)}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginTop: 4 }}>
                by {item.userName} ({item.userRole})
              </Text>
              {item.repairId && (
                <Text style={{ fontSize: 12, color: colors.primary, fontFamily: 'Inter_600SemiBold', marginTop: 6 }}>
                  View Repair
                </Text>
              )}
            </View>
          </View>
        </GlassCard>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[{ flex: 1, backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? insets.top + 67 : insets.top + 16 }]}>
      <ScreenGlow />
      <View style={{ paddingHorizontal: 20, marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border }}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={{ fontSize: 24, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>Activity Log</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 16 }}>
        <TouchableOpacity onPress={() => setFilterType(undefined)} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: filterType === undefined ? colors.primary : colors.card, borderWidth: 1, borderColor: filterType === undefined ? colors.primary : colors.border }}>
          <Text style={{ color: filterType === undefined ? '#FFF' : colors.foreground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFilterType(ActivityFeedType.repair)} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: filterType === ActivityFeedType.repair ? colors.primary : colors.card, borderWidth: 1, borderColor: filterType === ActivityFeedType.repair ? colors.primary : colors.border }}>
          <Text style={{ color: filterType === ActivityFeedType.repair ? '#FFF' : colors.foreground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>Repairs</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFilterType(ActivityFeedType.login)} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: filterType === ActivityFeedType.login ? colors.primary : colors.card, borderWidth: 1, borderColor: filterType === ActivityFeedType.login ? colors.primary : colors.border }}>
          <Text style={{ color: filterType === ActivityFeedType.login ? '#FFF' : colors.foreground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>Logins</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={activities}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={{ textAlign: 'center', marginTop: 40, color: colors.mutedForeground }}>No activity found.</Text>
          }
        />
      )}
    </View>
  );
}
