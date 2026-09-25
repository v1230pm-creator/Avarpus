import React, { useMemo, useState } from 'react';
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useData } from '@/context/DataContext';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { formatCurrency } from '@/utils/helpers';
import { Avatar } from '@/components/ui/Avatar';
import { useColors } from '@/hooks/useColors';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

export default function ReceivablesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useColors();
  const { customers, isLoading, loadError, loadAll } = useData();
  const [refreshing, setRefreshing] = useState(false);
  const [highestFirst, setHighestFirst] = useState(true);
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  };

  const outstandingCustomers = useMemo(() => {
    return customers
      .filter(c => c.dueAmount > 0)
      .sort((a, b) => highestFirst ? b.dueAmount - a.dueAmount : a.dueAmount - b.dueAmount);
  }, [customers, highestFirst]);

  const totalOutstanding = useMemo(() => {
    return outstandingCustomers.reduce((acc, c) => acc + c.dueAmount, 0);
  }, [outstandingCustomers]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + space.lg, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: space.lg }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Outstanding (Receivables)</Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setHighestFirst((value) => !value)}
          accessibilityLabel={highestFirst ? 'Show lowest outstanding first' : 'Show highest outstanding first'}
        >
          <Feather name={highestFirst ? 'arrow-down' : 'arrow-up'} size={18} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {isLoading && outstandingCustomers.length === 0 ? (
        <DataLoadingState />
      ) : loadError && outstandingCustomers.length === 0 ? (
        <DataErrorState onRetry={loadAll} />
      ) : (
      <>
      {!!loadError && <DataErrorBanner onRetry={loadAll} />}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={[styles.cardContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.summaryBox, { borderBottomColor: colors.border }]}>
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>{formatCurrency(totalOutstanding)}</Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Outstanding</Text>
          </View>
          
          <View style={styles.customerList}>
            {outstandingCustomers.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No outstanding balances</Text>
            ) : (
              outstandingCustomers.map((c) => (
                <TouchableOpacity key={c.id} style={styles.customerRow} onPress={() => router.push(`/(tabs)/customers/${c.id}`)}>
                  <Avatar name={c.name} size={size.avatarSm} />
                  <Text style={[styles.customerName, { color: colors.foreground }]} numberOfLines={1}>{c.name}</Text>
                  <Text style={[styles.customerDue, { color: colors.destructive }]}>{formatCurrency(c.dueAmount)}</Text>
                </TouchableOpacity>
              ))
            )}
            
            <TouchableOpacity style={[styles.viewAllBtn, { backgroundColor: colors.primary }]} onPress={() => router.push('/(tabs)/customers')}>
              <Text style={styles.viewAllText}>View All Customers</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    minHeight: layout.headerHeight,
    paddingHorizontal: layout.screenPadding,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  scroll: { padding: layout.screenPadding, paddingBottom: 100 },

  cardContainer: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  summaryBox: {
    paddingVertical: space.xxl,
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  summaryValue: { ...font.title, marginBottom: space.xs },
  summaryLabel: { ...font.captionStrong },
  
  customerList: { padding: space.lg },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: layout.rowPaddingVertical,
  },
  customerName: { flex: 1, ...font.bodyStrong, paddingHorizontal: space.md },
  customerDue: { ...font.bodyStrong },
  
  viewAllBtn: {
    minHeight: size.button,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: space.lg,
  },
  viewAllText: { ...font.button, color: '#FFF' },
  emptyText: { ...font.body, textAlign: 'center', marginVertical: space.xl },
});
