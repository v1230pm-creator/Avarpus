import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { RepairStatusBadge, SampleBadge } from '@/components/ui/Badge';
import { GlassCard, ScreenGlow, useStaggerAnim } from '@/components/ui/Glass';
import { CustomerFormSheet } from '@/components/forms/CustomerFormSheet';
import { formatCurrency, formatDate } from '@/utils/helpers';

import { useReturnsList, useRefundsList } from '@workspace/api-client-react';

export default function CustomerDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { customers, repairs } = useData();
  const [showEdit, setShowEdit] = useState(false);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const customer = useMemo(() => customers.find((c) => c.id === id), [customers, id]);
  const customerRepairs = useMemo(
    () => repairs.filter((r) => r.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [repairs, id],
  );

  const { data: returnsData } = useReturnsList();
  const { data: refundsData } = useRefundsList();
  const customerReturns = useMemo(() => {
    return (returnsData?.returns || []).filter(r => r.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [returnsData, id]);
  const customerRefunds = useMemo(() => {
    return (refundsData?.refunds || []).filter(rf => rf.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [refundsData, id]);

  const anims = useStaggerAnim(4);

  if (!customer) {
    return (
      <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }]}>
        <ScreenGlow />
        <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Customer not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />

      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Customer Profile</Text>
        <TouchableOpacity onPress={() => setShowEdit(true)} style={styles.backBtn} accessibilityLabel="Edit customer">
          <Feather name="edit-2" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}>
        {/* Profile Card */}
        <GlassCard animValue={anims[0]} style={styles.profileCard}>
          <Avatar name={customer.name} size={64} />
          {customer.isSample && <SampleBadge style={{ alignSelf: 'center', marginTop: 6 }} />}
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
            <View style={[styles.statBadge, { backgroundColor: colors.primary + '15' }]}>
              <Text style={[styles.statValue, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{customer.totalRepairs}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Repairs</Text>
            </View>
            <View style={[styles.statBadge, { backgroundColor: customer.dueAmount > 0 ? colors.warning + '15' : colors.success + '15' }]}>
              <Text style={[styles.statValue, { color: customer.dueAmount > 0 ? colors.warning : colors.success, fontFamily: 'Inter_700Bold' }]}>
                {formatCurrency(customer.dueAmount)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Due</Text>
            </View>
          </View>
        </GlassCard>

        {/* Repair History */}
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
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
                  <View style={[styles.repairIdBadge, { backgroundColor: colors.primary + '15' }]}>
                    <Text style={[styles.repairId, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{repair.repairId}</Text>
                  </View>
                  <RepairStatusBadge status={repair.status} />
                  {repair.isSample && <SampleBadge />}
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
        {/* Returns History */}
        {customerReturns.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold', marginTop: 12 }]}>
              RETURNS & REWORK ({customerReturns.length})
            </Text>
            {customerReturns.map((ret) => (
              <TouchableOpacity
                key={ret.id}
                onPress={() => router.push(`/(tabs)/repairs/return/${ret.id}` as any)}
                activeOpacity={0.8}
              >
                <Card style={styles.repairCard}>
                  <View style={styles.repairRow}>
                    <View style={[styles.repairIdBadge, { backgroundColor: colors.warning + '15' }]}>
                      <Text style={[styles.repairId, { color: colors.warning, fontFamily: 'Inter_700Bold' }]}>{ret.returnId}</Text>
                    </View>
                    <View style={[styles.repairIdBadge, { backgroundColor: ret.status === 'closed' ? colors.success + '15' : colors.warning + '15' }]}>
                      <Text style={{ fontSize: 11, color: ret.status === 'closed' ? colors.success : colors.warning, fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' }}>
                        {ret.status.replace(/_/g, ' ')}
                      </Text>
                    </View>
                    <Text style={[styles.repairDate, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      {formatDate(ret.createdAt)}
                    </Text>
                  </View>
                  <Text style={[styles.deviceLine, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                    {ret.brand} {ret.model}
                  </Text>
                  <Text style={[styles.problemLine, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
                    Reason: {ret.reason.replace(/_/g, ' ')}
                  </Text>
                  {customerRefunds.filter(rf => rf.returnCaseId === ret.id).map(rf => (
                    <Text key={rf.id} style={{ fontSize: 13, color: colors.info, fontFamily: 'Inter_600SemiBold', marginTop: 4 }}>
                      Refund: {formatCurrency(rf.amount)} ({rf.status.replace('_', ' ')})
                    </Text>
                  ))}
                </Card>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>

      <CustomerFormSheet visible={showEdit} onClose={() => setShowEdit(false)} customer={customer} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18 },
  scroll: { padding: 16, gap: 12 },
  profileCard: { alignItems: 'center', gap: 6, padding: 20 },
  name: { fontSize: 22, marginTop: 4 },
  mobile: { fontSize: 16 },
  email: { fontSize: 13 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  address: { fontSize: 12 },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 10, alignSelf: 'stretch' },
  statBadge: { flex: 1, borderRadius: 14, padding: 14, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 18 },
  statLabel: { fontSize: 11 },
  sectionTitle: { fontSize: 11, letterSpacing: 1, marginTop: 4 },
  emptyText: { textAlign: 'center', fontSize: 14 },
  repairCard: { gap: 6 },
  repairRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  repairIdBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  repairId: { fontSize: 11 },
  repairDate: { fontSize: 11, marginLeft: 'auto' },
  deviceLine: { fontSize: 14 },
  problemLine: { fontSize: 12 },
  chargeText: { fontSize: 14 },
});
