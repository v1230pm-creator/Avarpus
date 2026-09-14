import React from 'react';
import { FlatList, Linking, Platform, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FlatCard } from '@/components/ui/FlatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState } from '@/components/ui/DataStates';
import { formatCurrency } from '@/utils/helpers';
import { useDealersSuppliersList, type SupplierLink } from '@workspace/api-client-react';

// Shops that file the signed-in person as one of THEIR dealers. Each card is
// one supplier relationship: the supplier's contact, my dealer code there and
// the live state of the devices I have sent in.
export default function SuppliersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const { data, isLoading, error, refetch, isFetching } = useDealersSuppliersList();
  const suppliers: SupplierLink[] = data?.suppliers ?? [];

  const openSupplier = (link: SupplierLink) => {
    router.push({
      pathname: '/(tabs)/repairs/supplier/[dealerId]',
      params: { dealerId: link.dealerId, name: link.supplier.businessName },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>My Suppliers</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Shops repairing devices you send in
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {isLoading && !data ? (
        <DataLoadingState />
      ) : error && !data ? (
        <DataErrorState onRetry={() => { void refetch(); }} />
      ) : (
        <FlatList
          data={suppliers}
          keyExtractor={(link) => link.dealerId}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 100, gap: 10 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isFetching && !!data} onRefresh={() => { void refetch(); }} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="truck"
              title="No supplier has listed you yet"
              description="When another Avarpus shop adds your mobile number as a dealer, their repairs for you appear here."
            />
          }
          renderItem={({ item }) => {
            const inProgress = item.stats.received + item.stats.repairing;
            return (
              <TouchableOpacity
                onPress={() => openSupplier(item)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Open repairs at ${item.supplier.businessName}`}
                testID={`supplier-card-${item.dealerId}`}
              >
                <FlatCard style={{ padding: 12, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={[styles.avatar, { backgroundColor: colors.primary + '1A' }]}>
                      <Feather name="tool" size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 15, color: colors.foreground, fontFamily: 'Inter_700Bold' }} numberOfLines={1}>
                        {item.supplier.businessName}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
                        {item.supplier.ownerName} · {item.supplier.ownerMobile}
                      </Text>
                    </View>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${item.supplier.businessName}`}
                      onPress={() => { void Linking.openURL(`tel:${item.supplier.ownerMobile}`); }}
                      style={[styles.callBtn, { backgroundColor: colors.success + '1A' }]}
                    >
                      <Feather name="phone-call" size={15} color={colors.success} />
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <View style={[styles.codeBadge, { backgroundColor: colors.primary + '15' }]}>
                      <Text style={{ fontSize: 10, color: colors.primary, fontFamily: 'Inter_700Bold' }}>{item.dealerCode}</Text>
                    </View>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
                      Listed as {item.dealerName}
                    </Text>
                  </View>

                  <View style={styles.statsRow}>
                    <Stat label="Total" value={String(item.stats.totalRepairs)} color={colors.primary} />
                    <Stat label="In progress" value={String(inProgress)} color={colors.warning} />
                    <Stat label="Ready" value={String(item.stats.ready)} color={colors.info} />
                    <Stat label="Delivered" value={String(item.stats.delivered)} color={colors.success} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>
                      Repair value {formatCurrency(item.stats.totalRepairValue)}
                    </Text>
                    <Text style={{ fontSize: 11, color: item.stats.pendingAmount > 0 ? colors.warning : colors.success, fontFamily: 'Inter_600SemiBold' }}>
                      {item.stats.pendingAmount > 0 ? `Pending ${formatCurrency(item.stats.pendingAmount)}` : 'Nothing pending'}
                    </Text>
                  </View>
                </FlatCard>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const colors = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: color + '12' }]}>
      <Text style={{ fontSize: 15, color, fontFamily: 'Inter_700Bold' }}>{value}</Text>
      <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  backBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20 },
  headerSub: { fontSize: 12 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  callBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  codeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statsRow: { flexDirection: 'row', gap: 6 },
  stat: { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', gap: 1 },
});
