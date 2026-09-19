import React, { useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { FlatCard } from '@/components/ui/FlatCard';
import { Button } from '@/components/ui/Button';
import { RepairStatusBadge } from '@/components/ui/Badge';
import { DataLoadingState, DataErrorState } from '@/components/ui/DataStates';
import { formatCurrency, formatDate } from '@/utils/helpers';
import {
  useDealerTransactionsGet,
  useDealerTransactionsReceive,
  getDealerTransactionsListQueryKey,
  chatContactsMatch,
  chatRoomsCreate,
} from '@workspace/api-client-react';

// One transaction's full timeline: who sent it, who's repairing it, its
// current stage, and — once the two shops are linked by a real transaction —
// a one-tap way into the dedicated private chat between the two owners.
export default function DealerTransactionDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const [chatBusy, setChatBusy] = useState(false);

  const { data, isLoading, error, refetch } = useDealerTransactionsGet(id ?? '', {
    query: { enabled: !!id },
  } as any);
  const receiveMutation = useDealerTransactionsReceive();

  const repair = data?.repair as any;
  const counterpart = data?.counterpart as any;
  const isIncoming = !!repair && repair.sourceDealerBusinessName !== undefined && !!repair.sourceDealerShopId;

  const openChat = async () => {
    if (!counterpart?.ownerMobile || !counterpart?.ownerUserId) return;
    setChatBusy(true);
    try {
      const matchRes = await chatContactsMatch({ phone: counterpart.ownerMobile });
      const contact = matchRes.contacts.find((c) => c.userId === counterpart.ownerUserId) ?? matchRes.contacts[0];
      if (!contact) {
        Alert.alert('Chat unavailable', `${counterpart.businessName} could not be reached for chat right now.`);
        return;
      }
      const roomRes = await chatRoomsCreate({
        name: counterpart.businessName,
        kind: 'direct',
        targetUserId: contact.userId,
        matchToken: contact.matchToken,
      } as any);
      router.push({
        pathname: '/(tabs)/customers/chat/[id]',
        params: { id: roomRes.room.id, name: counterpart.businessName },
      });
    } catch (err: any) {
      Alert.alert('Chat unavailable', err?.data?.message ?? 'Could not open the chat. Please try again.');
    } finally {
      setChatBusy(false);
    }
  };

  const markReceived = async () => {
    if (!id) return;
    try {
      await receiveMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getDealerTransactionsListQueryKey() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void refetch();
    } catch (err: any) {
      Alert.alert('Could not confirm receipt', err?.data?.message ?? 'Please try again.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Transaction</Text>
          {!!repair && (
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
              {repair.brand} {repair.model}
            </Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      {isLoading && !data ? (
        <DataLoadingState />
      ) : error && !data ? (
        <DataErrorState onRetry={() => { void refetch(); }} />
      ) : !repair ? null : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 40, gap: 12 }} showsVerticalScrollIndicator={false}>
          <FlatCard style={{ padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{repair.brand} {repair.model}</Text>
              <RepairStatusBadge status={repair.status} />
            </View>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{repair.deviceType}</Text>
            {!!repair.imei && <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>IMEI {repair.imei}</Text>}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_500Medium' }}>{repair.problem}</Text>
            {!!repair.diagnosis && (
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Diagnosis: {repair.diagnosis}</Text>
            )}
          </FlatCard>

          {!!counterpart && (
            <FlatCard style={{ padding: 14, gap: 10 }}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                {isIncoming ? 'SOURCE / SUPPLIER DEALER' : 'REPAIRING DEALER'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.avatar, { backgroundColor: colors.primary + '1A' }]}>
                  <Feather name="briefcase" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{counterpart.businessName}</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{counterpart.ownerName} · {counterpart.ownerMobile}</Text>
                </View>
                <TouchableOpacity
                  accessibilityLabel={`Call ${counterpart.businessName}`}
                  onPress={() => { void Linking.openURL(`tel:${counterpart.ownerMobile}`); }}
                  style={[styles.iconBtn, { backgroundColor: colors.success + '1A' }]}
                >
                  <Feather name="phone-call" size={15} color={colors.success} />
                </TouchableOpacity>
              </View>
              <Button
                title="Chat with dealer"
                variant="secondary"
                onPress={openChat}
                loading={chatBusy}
                fullWidth
              />
            </FlatCard>
          )}

          {isIncoming && !repair.sourceDealerReceivedAt && (
            <FlatCard style={{ padding: 14, gap: 10, borderColor: colors.warning + '44', borderWidth: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="clock" size={16} color={colors.warning} />
                <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Confirm physical receipt</Text>
              </View>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                Let {repair.sourceDealerBusinessName} know the device has physically arrived at your shop.
              </Text>
              <Button title="Mark as Received" onPress={markReceived} loading={receiveMutation.isPending} fullWidth />
            </FlatCard>
          )}

          {isIncoming && repair.sourceDealerReceivedAt && (
            <View style={[styles.receivedBadge, { backgroundColor: colors.success + '12' }]}>
              <Feather name="check-circle" size={14} color={colors.success} />
              <Text style={{ fontSize: 12, color: colors.success, fontFamily: 'Inter_600SemiBold' }}>
                Received on {formatDate(repair.sourceDealerReceivedAt)}
              </Text>
            </View>
          )}

          {typeof repair.totalAmount === 'number' && (
            <FlatCard style={{ padding: 14, gap: 8 }}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>BILLING</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>Total</Text>
                <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{formatCurrency(repair.totalAmount)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>Balance</Text>
                <Text style={{ fontSize: 13, color: repair.balance > 0 ? colors.warning : colors.success, fontFamily: 'Inter_700Bold' }}>
                  {formatCurrency(repair.balance)}
                </Text>
              </View>
            </FlatCard>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  backBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20 },
  headerSub: { fontSize: 12 },
  sectionLabel: { fontSize: 10, letterSpacing: 1, fontFamily: 'Inter_600SemiBold' },
  divider: { height: 1, width: '100%' },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  receivedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
});
