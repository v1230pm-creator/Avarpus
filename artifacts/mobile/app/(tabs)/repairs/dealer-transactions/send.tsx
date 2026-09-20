import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import {
  useDealersDirectory,
  useRepairsGet,
  useRepairsTransfer,
  getRepairsListQueryKey,
  getRepairsGetQueryKey,
  getDealerTransfersListQueryKey,
} from '@workspace/api-client-react';
import type { DealerDirectoryEntry } from '@workspace/api-client-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { FlatCard } from '@/components/ui/FlatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState } from '@/components/ui/DataStates';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { isDealerPortalRole } from '@/types';

// "Send to Dealer" for an EXISTING repair: pick a verified shop owner from the
// directory (name / shop / mobile / Dealer ID), confirm, and the other side
// gets an incoming request. Nothing is retyped — the saved repair travels.
export default function SendToDealerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, canAccess } = useAuth();
  const { repairId } = useLocalSearchParams<{ repairId: string }>();
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  // Route-level gate: portal viewers and staff without repairs_update must be
  // denied before any data hook fires, not just hidden from the entry point.
  const allowed = !isDealerPortalRole(user?.role) && user?.role !== 'customer' && canAccess('repairs_update');
  useEffect(() => {
    if (!allowed) router.back();
  }, [allowed, router]);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<DealerDirectoryEntry | null>(null);
  const [message, setMessage] = useState('');
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: repairData, isLoading: repairLoading, error: repairError, refetch: refetchRepair } = useRepairsGet(
    repairId ?? '',
    { query: { enabled: allowed && !!repairId } } as any,
  );
  const repair = repairData?.repair;

  const { data: dirData, isFetching: searching, error: searchError, refetch: refetchSearch } = useDealersDirectory(
    { q: debounced },
    { query: { enabled: allowed && debounced.length >= 2, retry: false } } as any,
  );
  // A failed request must never read as "no dealer found" — the owner would
  // conclude the other shop is not registered when it is the network/API
  // (for example an outdated server build) that let them down.
  const searchFailed = !!searchError && !searching && debounced.length >= 2;
  const searchErrorMessage = (() => {
    const status = (searchError as any)?.status as number | undefined;
    if (status === 404) return 'Dealer search is not available on this server yet. Please update the app or try again later.';
    if (status === 403) return 'Your role cannot search dealers. Ask the shop owner to enable repair updates for you.';
    return 'Could not search dealers right now. Check your connection and try again.';
  })();
  const results = useMemo(() => dirData?.dealers ?? [], [dirData]);
  // Only what the current query produced is selectable: never a cached list
  // from an earlier query while this one failed.
  const visibleResults = searchFailed ? [] : results;
  const showSearchError = searchFailed && query.trim() === debounced;

  const transfer = useRepairsTransfer();

  const handleSend = async () => {
    if (!repair || !selected) return;
    setSubmitError('');
    try {
      const res = await transfer.mutateAsync({ id: repair.id, data: { receiverShopId: selected.shopId, message: message.trim() || undefined } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getRepairsListQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getRepairsGetQueryKey(repair.id) }),
        queryClient.invalidateQueries({ queryKey: getDealerTransfersListQueryKey() }),
      ]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/(tabs)/repairs/dealer-transactions/request/${res.request.id}` as any);
    } catch (err: any) {
      setSubmitError(err?.data?.message ?? 'Could not send this request. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const alreadyBlocked = repair
    ? repair.status === 'delivered' || repair.status === 'cancelled'
      ? 'This repair is closed and cannot be sent to another dealer.'
      : repair.transfer?.status === 'pending'
        ? `Already waiting for ${repair.transfer.receiverBusinessName} to accept.`
        : null
    : null;

  if (!allowed) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Send to Dealer</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            The other dealer must accept before it shows in their queue
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {repairLoading && !repair ? (
        <DataLoadingState />
      ) : repairError && !repair ? (
        <DataErrorState onRetry={() => { void refetchRepair(); }} />
      ) : !repair ? null : (
        <FlatList
          data={selected ? [] : visibleResults}
          keyExtractor={(d) => d.shopId}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 40, gap: 10 }}
          ListHeaderComponent={
            <View style={{ gap: 12 }}>
              <FlatCard style={{ padding: 12, gap: 4 }} testID="send-repair-summary">
                <Text style={{ fontSize: 10, letterSpacing: 1, color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }}>DEVICE BEING SENT</Text>
                <Text style={{ fontSize: 15, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{repair.repairId} · {repair.brand} {repair.model}</Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }} numberOfLines={2}>{repair.problem}</Text>
                {!!repair.imei && (
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>IMEI {repair.imei}</Text>
                )}
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                  Saved device details travel with the request. Your customer's name and number stay with you.
                </Text>
              </FlatCard>

              {alreadyBlocked ? (
                <View style={[styles.infoBox, { backgroundColor: colors.warning + '14', borderColor: colors.warning + '33' }]}>
                  <Feather name="alert-circle" size={14} color={colors.warning} />
                  <Text style={[styles.infoText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>{alreadyBlocked}</Text>
                </View>
              ) : selected ? (
                <View style={{ gap: 12 }}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>SENDING TO</Text>
                  <View style={[styles.matchCard, { backgroundColor: colors.success + '0F', borderColor: colors.success + '33' }]} testID="send-selected-dealer">
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{selected.businessName}</Text>
                      <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>
                        {selected.ownerName} · Dealer ID {selected.dealerCode}
                      </Text>
                      {!!selected.address && (
                        <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }} numberOfLines={1}>{selected.address}</Text>
                      )}
                    </View>
                    <TouchableOpacity onPress={() => setSelected(null)} accessibilityLabel="Change dealer" accessibilityRole="button">
                      <Feather name="x-circle" size={20} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                  <Input
                    label="Note for the dealer (optional)"
                    value={message}
                    onChangeText={(t) => setMessage(t.slice(0, 500))}
                    placeholder="e.g. Customer needs it back by Friday"
                    leftIcon="message-square"
                    multiline
                  />
                  {!!submitError && (
                    <Text style={{ fontSize: 12, color: colors.destructive, fontFamily: 'Inter_500Medium' }} testID="send-error">{submitError}</Text>
                  )}
                  <Button
                    title={`Send request to ${selected.businessName}`}
                    onPress={handleSend}
                    loading={transfer.isPending}
                    fullWidth
                    size="lg"
                    testID="send-confirm"
                  />
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
                    You will see “Waiting for {selected.businessName} to accept” until they respond. You can cancel any time before that.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 12 }}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>CHOOSE A VERIFIED DEALER</Text>
                  <Input
                    label="Search"
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Name, shop name, mobile or Dealer ID"
                    leftIcon="search"
                    autoCapitalize="none"
                    testID="dealer-search"
                  />
                  {searching && <AvarpusSpinner size={20} style={{ alignSelf: 'center' }} />}
                  {showSearchError && (
                    <View style={[styles.infoBox, { backgroundColor: colors.destructive + '12', borderColor: colors.destructive + '33' }]} testID="dealer-search-error">
                      <Feather name="alert-circle" size={14} color={colors.destructive} />
                      <Text style={[styles.infoText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>{searchErrorMessage}</Text>
                      <TouchableOpacity onPress={() => { void refetchSearch(); }} accessibilityRole="button" accessibilityLabel="Retry dealer search" hitSlop={8}>
                        <Text style={{ fontSize: 12, color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            selected || alreadyBlocked || debounced.length < 2 || searchFailed ? null : searching ? null : (
              <EmptyState icon="users" title="No verified dealer found" description="Only registered shop owners appear here. Try the owner's mobile number or their Dealer ID." />
            )
          }
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => setSelected(item)} activeOpacity={0.8} testID={`dealer-result-${item.shopId}`} accessibilityRole="button">
              <FlatCard style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.avatar, { backgroundColor: colors.primary + '1A' }]}>
                  <Feather name="briefcase" size={16} color={colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_700Bold' }} numberOfLines={1}>{item.businessName}</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
                    {item.ownerName} · ID {item.dealerCode}{item.matchedByMobile ? ' · matched by mobile' : ''}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </FlatCard>
            </TouchableOpacity>
          )}
        />
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
  sectionLabel: { fontSize: 10, letterSpacing: 1, marginTop: 4 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, padding: 10, borderRadius: 14 },
  infoText: { fontSize: 12, flex: 1, lineHeight: 17 },
  matchCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
  avatar: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
