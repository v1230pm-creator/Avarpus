import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCurrency, formatDate } from '@/utils/helpers';
import { FlatCard } from '@/components/ui/FlatCard';
import { useKhataRepairs } from '@/hooks/useKhataRepairs';
import { getRepairKhataAmounts, summarizeKhataRepairs, type KhataPartyType } from '@/utils/khata';

export default function KhataDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { type, id, name } = useLocalSearchParams<{
    type: KhataPartyType;
    id: string;
    name?: string;
  }>();
  const validType = type === 'customer' || type === 'dealer' ? type : undefined;
  const { repairs, isLoading, error, reload } = useKhataRepairs(validType, id);
  const [refreshing, setRefreshing] = useState(false);
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const sortedRepairs = useMemo(
    () => [...repairs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [repairs],
  );
  const summary = useMemo(() => summarizeKhataRepairs(sortedRepairs), [sortedRepairs]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  if (isLoading && repairs.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#0B63F6" size="large" />
        <Text style={styles.loadingText}>Loading account…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Back">
          <Feather name="arrow-left" size={22} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle} numberOfLines={1}>{name || 'Khata Details'}</Text>
          <Text style={styles.headerSubtitle}>
            {validType === 'dealer' ? 'Dealer account' : 'Customer account'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0B63F6" />
        }
      >
        {!!error && (
          <FlatCard style={styles.errorCard}>
            <Feather name="alert-circle" size={18} color="#EF4444" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={reload} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </FlatCard>
        )}

        <FlatCard style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>Total Business</Text>
              <Text style={styles.summaryValue}>{formatCurrency(summary.billed)}</Text>
            </View>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>Total Paid</Text>
              <Text style={[styles.summaryValue, styles.paidValue]}>{formatCurrency(summary.paid)}</Text>
            </View>
          </View>
          <View style={styles.outstandingBox}>
            <Text style={styles.outstandingLabel}>Outstanding</Text>
            <Text style={[styles.outstandingValue, summary.due <= 0 && styles.paidValue]}>
              {formatCurrency(summary.due)}
            </Text>
          </View>
        </FlatCard>

        <Text style={styles.sectionTitle}>LINKED REPAIRS ({sortedRepairs.length})</Text>

        {sortedRepairs.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="file-text" size={25} color="#94A3B8" />
            </View>
            <Text style={styles.emptyTitle}>No linked repairs</Text>
            <Text style={styles.emptyText}>Real repair bills will appear here automatically.</Text>
          </View>
        ) : (
          sortedRepairs.map((repair) => {
            const amounts = getRepairKhataAmounts(repair);
            return (
              <TouchableOpacity
                key={repair.id}
                activeOpacity={0.75}
                onPress={() => router.push(`/(tabs)/repairs/${repair.id}`)}
                style={styles.repairPressable}
              >
                <FlatCard style={styles.repairCard}>
                  <View style={styles.repairHeader}>
                    <View style={styles.repairIdBadge}>
                      <Text style={styles.repairId}>{repair.repairId}</Text>
                    </View>
                    <Text style={styles.repairDate}>{formatDate(repair.createdAt)}</Text>
                  </View>
                  <Text style={styles.deviceName}>{repair.brand} {repair.model}</Text>
                  <Text style={styles.customerName} numberOfLines={1}>{repair.customerName}</Text>

                  <View style={styles.amountRow}>
                    <View>
                      <Text style={styles.amountLabel}>Bill</Text>
                      <Text style={styles.amountValue}>{formatCurrency(amounts.billed)}</Text>
                    </View>
                    <View>
                      <Text style={styles.amountLabel}>Paid</Text>
                      <Text style={[styles.amountValue, styles.paidValue]}>{formatCurrency(amounts.paid)}</Text>
                    </View>
                    <View style={styles.amountEnd}>
                      <Text style={styles.amountLabel}>Due</Text>
                      <Text style={[styles.amountValue, amounts.due > 0 ? styles.dueValue : styles.paidValue]}>
                        {formatCurrency(amounts.due)}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.statusBadge, amounts.due > 0 ? styles.pendingBadge : styles.settledBadge]}>
                    <Feather
                      name={amounts.due > 0 ? 'clock' : 'check-circle'}
                      size={12}
                      color={amounts.due > 0 ? '#B45309' : '#15803D'}
                    />
                    <Text style={[styles.statusText, amounts.due > 0 ? styles.pendingText : styles.settledText]}>
                      {amounts.due > 0 ? 'Payment pending' : 'Settled'}
                    </Text>
                  </View>
                </FlatCard>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    gap: 12,
  },
  loadingText: { color: '#64748B', fontSize: 13, fontFamily: 'Inter_500Medium' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, paddingRight: 44 },
  headerTitle: { color: '#111827', fontSize: 18, fontFamily: 'Inter_700Bold' },
  headerSubtitle: { color: '#64748B', fontSize: 12, marginTop: 2, fontFamily: 'Inter_400Regular' },
  scroll: { padding: 16, paddingBottom: 110, width: '100%', maxWidth: 720, alignSelf: 'center' },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    borderColor: '#FECACA',
  },
  errorText: { flex: 1, color: '#991B1B', fontSize: 12, fontFamily: 'Inter_400Regular' },
  retryButton: { paddingHorizontal: 10, paddingVertical: 7 },
  retryText: { color: '#0B63F6', fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  summaryCard: { backgroundColor: '#EAF2FF', borderColor: '#D7E6FF', marginBottom: 22 },
  summaryTop: { flexDirection: 'row', gap: 18 },
  summaryBox: { flex: 1 },
  summaryLabel: { color: '#64748B', fontSize: 11, fontFamily: 'Inter_500Medium' },
  summaryValue: { color: '#111827', fontSize: 19, marginTop: 4, fontFamily: 'Inter_700Bold' },
  paidValue: { color: '#16A34A' },
  outstandingBox: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#CFE0FA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  outstandingLabel: { color: '#64748B', fontSize: 12, fontFamily: 'Inter_500Medium' },
  outstandingValue: { color: '#EF4444', fontSize: 22, fontFamily: 'Inter_700Bold' },
  sectionTitle: {
    color: '#64748B',
    fontSize: 11,
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
    fontFamily: 'Inter_600SemiBold',
  },
  repairPressable: { marginBottom: 10 },
  repairCard: { padding: 14 },
  repairHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  repairIdBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#EAF2FF' },
  repairId: { color: '#0B63F6', fontSize: 11, fontFamily: 'Inter_700Bold' },
  repairDate: { color: '#94A3B8', fontSize: 10, fontFamily: 'Inter_400Regular' },
  deviceName: { color: '#111827', fontSize: 15, marginTop: 10, fontFamily: 'Inter_600SemiBold' },
  customerName: { color: '#64748B', fontSize: 12, marginTop: 2, fontFamily: 'Inter_400Regular' },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 15 },
  amountEnd: { alignItems: 'flex-end' },
  amountLabel: { color: '#94A3B8', fontSize: 10, fontFamily: 'Inter_500Medium' },
  amountValue: { color: '#111827', fontSize: 14, marginTop: 3, fontFamily: 'Inter_600SemiBold' },
  dueValue: { color: '#EF4444' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: 13,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 9,
  },
  pendingBadge: { backgroundColor: '#FFF7E6' },
  settledBadge: { backgroundColor: '#EAF8EF' },
  statusText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  pendingText: { color: '#B45309' },
  settledText: { color: '#15803D' },
  empty: { alignItems: 'center', paddingVertical: 50, paddingHorizontal: 24 },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#F3F7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: '#111827', fontSize: 15, marginTop: 13, fontFamily: 'Inter_600SemiBold' },
  emptyText: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 5,
    textAlign: 'center',
    fontFamily: 'Inter_400Regular',
  },
});