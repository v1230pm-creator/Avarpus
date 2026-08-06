import React, { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { RepairStatusBadge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/utils/helpers';

export default function CustomerDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { customers, repairs } = useData();

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const customer = useMemo(() => customers.find((c) => c.id === id), [customers, id]);
  const customerRepairs = useMemo(
    () => repairs.filter((r) => r.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [repairs, id],
  );

  if (!customer) {
    return (
      <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Customer not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 14, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Customer Profile</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}>
        {/* Profile Card */}
        <Card style={styles.profileCard}>
          <Avatar name={customer.name} size={64} />
          <Text style={[styles.name, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{customer.name}</Text>
          <Text style={[styles.mobile, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>{customer.mobile}</Text>
          {customer.email && (
            <Text style={[styles.email, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{customer.email}</Text>
          )}
          {customer.address && (
            <View style={styles.addressRow}>
              <Feather name="map-pin" size={12} color={colors.mutedForeground} />
              <Text style={[styles.address, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{customer.address}</Text>
            </View>
          )}
          <View style={styles.statsRow}>
            <View style={[styles.statBadge, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.statValue, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{customer.totalRepairs}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Repairs</Text>
            </View>
            <View style={[styles.statBadge, { backgroundColor: customer.dueAmount > 0 ? colors.warningLight : colors.successLight }]}>
              <Text style={[styles.statValue, { color: customer.dueAmount > 0 ? colors.warning : colors.success, fontFamily: 'Inter_700Bold' }]}>
                {formatCurrency(customer.dueAmount)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Due</Text>
            </View>
          </View>
        </Card>

        {/* Repair History */}
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
          REPAIR HISTORY ({customerRepairs.length})
        </Text>

        {customerRepairs.length === 0 ? (
          <Card>
            <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              No repairs yet
            </Text>
          </Card>
        ) : (
          customerRepairs.map((repair) => (
            <TouchableOpacity
              key={repair.id}
              onPress={() => router.push(`/(tabs)/repairs/${repair.id}`)}
              activeOpacity={0.8}
            >
              <Card style={styles.repairCard}>
                <View style={styles.repairRow}>
                  <View style={[styles.repairIdBadge, { backgroundColor: colors.primary + '1A' }]}>
                    <Text style={[styles.repairId, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{repair.repairId}</Text>
                  </View>
                  <RepairStatusBadge status={repair.status} />
                  <Text style={[styles.repairDate, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    {formatDate(repair.createdAt)}
                  </Text>
                </View>
                <Text style={[styles.deviceLine, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                  {repair.brand} {repair.model}
                </Text>
                <Text style={[styles.problemLine, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
                  {repair.problem}
                </Text>
                <Text style={[styles.chargeText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {formatCurrency(repair.repairCharge + repair.partsCharge)}
                </Text>
              </Card>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18 },
  scroll: { padding: 16, gap: 12 },
  profileCard: { alignItems: 'center', gap: 6 },
  name: { fontSize: 22, marginTop: 4 },
  mobile: { fontSize: 16 },
  email: { fontSize: 13 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  address: { fontSize: 12 },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  statBadge: { flex: 1, borderRadius: 12, padding: 12, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 18 },
  statLabel: { fontSize: 11 },
  sectionTitle: { fontSize: 11, letterSpacing: 1 },
  emptyText: { textAlign: 'center', fontSize: 14 },
  repairCard: { gap: 6 },
  repairRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  repairIdBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  repairId: { fontSize: 11 },
  repairDate: { fontSize: 11, marginLeft: 'auto' },
  deviceLine: { fontSize: 14 },
  problemLine: { fontSize: 12 },
  chargeText: { fontSize: 14 },
});
