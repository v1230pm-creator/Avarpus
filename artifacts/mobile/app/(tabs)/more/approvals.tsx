import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { FlatCard, FadeInView, useIsDark, useStaggerAnim } from '@/components/ui/Glass';
import { formatDate } from '@/utils/helpers';
import { KeyboardAvoidingCompat } from '@/components/KeyboardAvoidingCompat';
import {
  useApprovalsList,
  approvalsApprove,
  approvalsReject,
  ApprovalRequest
} from '@workspace/api-client-react';

const STATUS_COLORS = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
} as const;

function ApprovalCard({
  request,
  isStaff,
  onApprove,
  onReject
}: {
  request: ApprovalRequest;
  isStaff: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const colors = useColors();
  const isDark = useIsDark();

  let details = '';
  if (request.recordType === 'repair') {
    const p = request.payload as any;
    details = `Repair: ${p.customerName} - ${p.brand} ${p.model}`;
  } else if (request.recordType === 'purchase') {
    const p = request.payload as any;
    details = `Purchase: ${p.supplier} - ${p.itemName} (₹${p.total})`;
  } else if (request.recordType === 'finance') {
    const p = request.payload as any;
    details = `Finance: ${p.type === 'income' ? 'Income' : 'Expense'} - ${p.category} (₹${p.amount})`;
  }

  return (
    <FlatCard style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.requester, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
            {request.requesterName}
          </Text>
          <Text style={[styles.role, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {request.requesterRole.replace('_', ' ')}
          </Text>
        </View>
        <Badge
          label={request.status.charAt(0).toUpperCase() + request.status.slice(1)}
          variant={STATUS_COLORS[request.status]}
          size="sm"
        />
      </View>

      <View style={[styles.detailsBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.border }]}>
        <Text style={[styles.recordType, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' }]}>
          {request.mode} {request.recordType}
        </Text>
        <Text style={[styles.detailsText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {details}
        </Text>
        <Text style={[styles.dateInfo, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
          Requested Backdate: {formatDate(request.requestedDate)}
        </Text>
      </View>

      <View style={styles.reasonBlock}>
        <Text style={[styles.reasonLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
          Reason for backdating:
        </Text>
        <Text style={[styles.reasonText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
          "{request.reason}"
        </Text>
      </View>

      {!isStaff && request.status === 'pending' && (
        <View style={styles.actionRow}>
          <Button
            title="Reject"
            variant="outline"
            onPress={() => onReject(request.id)}
            style={{ flex: 1 }}
          />
          <Button
            title="Approve"
            onPress={() => onApprove(request.id)}
            style={{ flex: 1, backgroundColor: colors.success }}
          />
        </View>
      )}

      {request.status !== 'pending' && (
        <View style={[styles.decidedBox, { borderTopColor: colors.border }]}>
          <Text style={[styles.decidedText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {request.status === 'approved' ? 'Approved by' : 'Rejected by'} {request.decidedByName} on {formatDate(request.decidedAt || '')}
          </Text>
          {request.status === 'rejected' && request.rejectionReason && (
            <Text style={[styles.rejectionReason, { color: colors.destructive, fontFamily: 'Inter_500Medium' }]}>
              Reason: {request.rejectionReason}
            </Text>
          )}
        </View>
      )}
    </FlatCard>
  );
}

export default function ApprovalsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isStaff = user?.role !== 'dealer' && user?.role !== 'super_admin';

  const { data, isLoading, error, refetch, isRefetching } = useApprovalsList();
  const approvals = (data?.approvals || []) as ApprovalRequest[];

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const anims = useStaggerAnim(2);
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const handleApprove = (id: string) => {
    Alert.alert(
      'Approve Request',
      'Are you sure you want to approve this backdated entry? It will be saved immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          style: 'default',
          onPress: async () => {
            setProcessing(true);
            try {
              await approvalsApprove(id);
              await refetch();
              // Invalidate specific lists since a new record was just created
              // (Simplest approach without importing every single hook's queryKey)
              queryClient.invalidateQueries();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to approve request');
            } finally {
              setProcessing(false);
            }
          }
        }
      ]
    );
  };

  const submitReject = async () => {
    if (!rejectReason.trim() || !rejectingId) return;
    setProcessing(true);
    try {
      await approvalsReject(rejectingId, { reason: rejectReason.trim() });
      setRejectingId(null);
      setRejectReason('');
      await refetch();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to reject request');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <FadeInView animValue={anims[0]}>
        <View style={[styles.header, { paddingTop: topPad + 14 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {isStaff ? 'My Requests' : 'Approvals'}
            </Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Backdated entries
            </Text>
          </View>
          <View style={{ width: 44 }} />
        </View>
      </FadeInView>

      {isLoading && approvals.length === 0 ? (
        <DataLoadingState />
      ) : error && approvals.length === 0 ? (
        <DataErrorState onRetry={() => refetch()} />
      ) : (
        <>
          {!!error && <DataErrorBanner onRetry={() => refetch()} />}
          <FlatList
            data={approvals}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={isRefetching || processing} onRefresh={refetch} tintColor={colors.primary} />}
            ListEmptyComponent={<EmptyState icon="check-circle" title="No requests" description={isStaff ? "You haven't made any backdated entry requests." : "No pending approvals found."} />}
            renderItem={({ item }) => (
              <ApprovalCard
                request={item}
                isStaff={isStaff}
                onApprove={handleApprove}
                onReject={(id) => setRejectingId(id)}
              />
            )}
          />
        </>
      )}

      {/* Reject Modal */}
      <Modal visible={!!rejectingId} animationType="fade" transparent>
        <KeyboardAvoidingCompat style={[styles.overlayCenter, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <View style={[styles.rejectModal, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Reject Request</Text>
            <Text style={[styles.modalSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Please provide a reason for rejecting this backdated entry.
            </Text>

            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Reason for rejection..."
              placeholderTextColor={colors.mutedForeground}
              style={[styles.rejectInput, { color: colors.foreground, borderColor: colors.border, fontFamily: 'Inter_400Regular' }]}
              multiline
              autoFocus
            />

            <View style={styles.modalActions}>
              <Button title="Cancel" variant="outline" onPress={() => { setRejectingId(null); setRejectReason(''); }} style={{ flex: 1 }} />
              <Button title="Reject" onPress={submitReject} loading={processing} disabled={!rejectReason.trim()} style={{ flex: 1, backgroundColor: colors.destructive }} />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22 },
  headerSub: { fontSize: 12, marginTop: 2 },
  list: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  card: { padding: 16, gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  requester: { fontSize: 16 },
  role: { fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  detailsBox: { padding: 12, borderRadius: 8, borderWidth: 1, gap: 6 },
  recordType: { fontSize: 13 },
  detailsText: { fontSize: 13, lineHeight: 18 },
  dateInfo: { fontSize: 13, marginTop: 4 },
  reasonBlock: { gap: 4 },
  reasonLabel: { fontSize: 12 },
  reasonText: { fontSize: 14, fontStyle: 'italic' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  decidedBox: { borderTopWidth: 1, paddingTop: 12, marginTop: 4, gap: 4 },
  decidedText: { fontSize: 12 },
  rejectionReason: { fontSize: 12 },

  overlayCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  rejectModal: { width: '100%', padding: 20, borderRadius: 16, borderWidth: 1 },
  modalTitle: { fontSize: 18, marginBottom: 8 },
  modalSub: { fontSize: 13, marginBottom: 16, lineHeight: 18 },
  rejectInput: { borderWidth: 1, borderRadius: 8, padding: 12, height: 100, textAlignVertical: 'top', marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 12 },
});