import React, { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { formatCurrency, formatDate, getReturnStatusColor } from '@/utils/helpers';
import { KeyboardAvoidingCompat } from '@/components/KeyboardAvoidingCompat';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import {
  useReturnsGet,
  getReturnsGetQueryKey,
  returnsUpdate,
  returnPartsAdd,
  refundsCreate,
  refundsApprove,
  refundsReject,
  refundsMarkPaid,
  RepairReturnStatus
} from '@workspace/api-client-react';


const RESOLUTIONS = [
  'rework',
  'parts_replacement',
  'no_fault_found',
  'cannot_repair',
  'refund',
  'partial_refund',
  'customer_declined',
  'other',
];

function InfoRow({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: color ?? colors.foreground, fontFamily: bold ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>{value}</Text>
    </View>
  );
}

export default function ReturnDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { inventory } = useData();

  const isDealer = user?.role === 'dealer' || user?.role === 'super_admin';

  const { data, isLoading, refetch } = useReturnsGet(id as string, { query: { enabled: !!id, queryKey: getReturnsGetQueryKey(id as string) } });
  const ret = data?.return;
  const parts = data?.parts || [];
  const refunds = data?.refunds || [];

  const [updating, setUpdating] = useState(false);

  // Inspection Edit
  const [showInspectionEdit, setShowInspectionEdit] = useState(false);
  const [editDiagnosis, setEditDiagnosis] = useState('');
  const [editWork, setEditWork] = useState('');
  const [editResolution, setEditResolution] = useState('');
  const [editLabour, setEditLabour] = useState('');
  const [editPayable, setEditPayable] = useState('');
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  // Add Part
  const [showAddPart, setShowAddPart] = useState(false);
  const [selectedInventoryId, setSelectedInventoryId] = useState('');
  const [partName, setPartName] = useState('');
  const [partCost, setPartCost] = useState('');
  const [partQty, setPartQty] = useState('1');

  // Refund
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState('Cash');
  const [refundReason, setRefundReason] = useState('');

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const anims = useStaggerAnim(7);

  if (!ret && !isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>

        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.notFound}>
          <Text style={{ color: colors.mutedForeground }}>Return case not found</Text>
        </View>
      </View>
    );
  }


  const getAvailableStatuses = (): RepairReturnStatus[] => {
    if (!ret) return [];
    const st = ret.status as RepairReturnStatus;
    let allowed: RepairReturnStatus[] = [];
    switch (st) {
      case 'returned': allowed = ['inspection']; break;
      case 'inspection': allowed = ['rework_required', 'warranty_service', 'no_fault_found', 'cannot_repair', 'customer_declined']; break;
      case 'rework_required': allowed = ['warranty_service', 'waiting_for_parts', 'repaired', 'cannot_repair', 'customer_declined']; break;
      case 'warranty_service': allowed = ['rework_required', 'waiting_for_parts', 'repaired', 'cannot_repair', 'customer_declined']; break;
      case 'waiting_for_parts': allowed = ['rework_required', 'warranty_service', 'repaired', 'cannot_repair', 'customer_declined']; break;
      case 'cannot_repair': allowed = ['customer_declined']; break;
      case 'closed': allowed = ['inspection']; break;
      default: allowed = []; break;
    }

    if (st !== 'closed') {
      allowed.push('closed');
    }

    if (!isDealer) {
      allowed = allowed.filter(s => s !== 'rework_required' && s !== 'closed');
    }

    return allowed;
  };

  const availableStatuses = getAvailableStatuses();

  const handleStatusUpdate = async (newStatus: RepairReturnStatus) => {
    if (updating) return;
    setUpdating(true);
    try {
      await returnsUpdate(ret!.id, { status: newStatus });
      await refetch();
      queryClient.invalidateQueries();
    } catch (e: any) {
      Alert.alert('Update failed', e.message || 'Could not update status');
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveInspection = async () => {
    setUpdating(true);
    try {
      await returnsUpdate(ret!.id, {
        diagnosis: editDiagnosis,
        workPerformed: editWork,
        resolution: editResolution,
        labourCost: Number(editLabour) || 0,
        customerPayable: Number(editPayable) || 0,
      });
      setShowInspectionEdit(false);
      await refetch();
      queryClient.invalidateQueries();
    } catch (e: any) {
      Alert.alert('Update failed', e.message || 'Could not update inspection');
    } finally {
      setUpdating(false);
    }
  };

  const handleAddPart = async () => {
    if (!selectedInventoryId && !partName) {
      Alert.alert('Required', 'Please select or enter a part name');
      return;
    }
    setUpdating(true);
    try {
      await returnPartsAdd(ret!.id, {
        inventoryItemId: selectedInventoryId || undefined,
        partName: selectedInventoryId ? undefined : partName,
        quantity: Number(partQty) || 1,
        unitCost: selectedInventoryId ? undefined : (Number(partCost) || 0),
      });
      setShowAddPart(false);
      setPartName('');
      setPartCost('');
      setSelectedInventoryId('');
      setPartQty('1');
      await refetch();
      queryClient.invalidateQueries();
    } catch (e: any) {
      Alert.alert('Add Part failed', e.message || 'Stock issue?');
    } finally {
      setUpdating(false);
    }
  };

  const handleCreateRefund = async () => {
    if (!refundAmount || !refundReason) {
      Alert.alert('Required', 'Please fill amount and reason');
      return;
    }
    setUpdating(true);
    try {
      await refundsCreate(ret!.id, {
        amount: Number(refundAmount),
        method: refundMethod,
        reason: refundReason,
      });
      setShowRefundModal(false);
      setRefundAmount('');
      setRefundReason('');
      await refetch();
      queryClient.invalidateQueries();
    } catch (e: any) {
      Alert.alert('Refund request failed', e.message);
    } finally {
      setUpdating(false);
    }
  };

  const approveRefund = async (refundId: string) => {
    try {
      await refundsApprove(refundId, {});
      await refetch();
      queryClient.invalidateQueries();
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  const markRefundPaid = async (refundId: string) => {
    try {
      await refundsMarkPaid(refundId, {});
      await refetch();
      queryClient.invalidateQueries();
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  if (!ret) return <View style={{ flex: 1, backgroundColor: colors.background }}></View>;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <FadeInView animValue={anims[0]} style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.returnId, { color: getReturnStatusColor(ret.status, colors), fontFamily: 'Inter_700Bold' }]}>{ret.returnId}</Text>
          <View style={[styles.statusBadge, { backgroundColor: getReturnStatusColor(ret.status, colors) + '15' }]}>
            <Text style={{ fontSize: 11, color: getReturnStatusColor(ret.status, colors), fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' }}>
              {ret.status.replace(/_/g, ' ')}
            </Text>
          </View>
        </View>
        <View style={{ width: 44 }} />
      </FadeInView>

      <KeyboardAwareScrollViewCompat showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]} bottomOffset={24}>

        {/* Status Stepper / Actions */}
        <FadeInView animValue={anims[1]}>
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>STATUS</Text>
            {availableStatuses.length > 0 ? (
              <TouchableOpacity
                onPress={() => setShowStatusPicker(true)}
                disabled={updating}
                style={{ backgroundColor: colors.success, borderRadius: colors.radius - 2, padding: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 }}
              >
                <Feather name="edit" size={18} color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Update Status</Text>
              </TouchableOpacity>
            ) : (
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontStyle: 'italic', marginTop: 8 }}>
                No further status updates available.
              </Text>
            )}
          </Card>
        </FadeInView>

        {/* Case Info */}
        <FadeInView animValue={anims[2]}>
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>AFTER-SALES CASE</Text>
            <InfoRow label="Reason" value={ret.reason.replace(/_/g, ' ')} />
            <InfoRow label="Complaint" value={ret.complaint} />
            {!!ret.deviceCondition && <InfoRow label="Condition" value={ret.deviceCondition} />}
            {!!ret.receivedByName && <InfoRow label="Received By" value={ret.receivedByName} />}
          </Card>
        </FadeInView>

        {/* Original Repair Info */}
        <FadeInView animValue={anims[2]}>
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>ORIGINAL REPAIR</Text>
            {!!ret.repairTicket && <InfoRow label="Ticket" value={ret.repairTicket} bold />}
            {!!ret.customerName && <InfoRow label="Customer" value={ret.customerName} />}
            <InfoRow label="Device" value={`${ret.brand} ${ret.model}`} />
            {ret.imei && <InfoRow label="IMEI" value={ret.imei} />}
            {ret.originalProblem && <InfoRow label="Problem" value={ret.originalProblem} />}
            {ret.originalReceiveDate && <InfoRow label="Received" value={formatDate(ret.originalReceiveDate)} />}
            {ret.originalDeliveryDate && <InfoRow label="Delivered" value={formatDate(ret.originalDeliveryDate)} />}
            {ret.originalAmount !== undefined && <InfoRow label="Amount" value={formatCurrency(ret.originalAmount)} />}
            {ret.daysAfterDelivery !== undefined && (
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Days Since Delivery</Text>
                <Text style={[styles.infoValue, { color: colors.warning, fontFamily: 'Inter_600SemiBold' }]}>{ret.daysAfterDelivery} Days</Text>
              </View>
            )}
          </Card>
        </FadeInView>

        {/* Inspection Card */}
        <FadeInView animValue={anims[3]}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>INSPECTION & REWORK</Text>
              <TouchableOpacity onPress={() => {
                setEditDiagnosis(ret.diagnosis || '');
                setEditWork(ret.workPerformed || '');
                setEditResolution(ret.resolution || '');
                setEditLabour(ret.labourCost?.toString() || '0');
                setEditPayable(ret.customerPayable?.toString() || '0');
                setShowInspectionEdit(true);
              }}>
                <Feather name="edit-2" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
            {!!ret.resolution && <InfoRow label="Resolution" value={ret.resolution.replace(/_/g, ' ')} bold />}
            {(!!ret.diagnosis || !!ret.workPerformed) && <View style={styles.divider} />}
            {!!ret.diagnosis && (
              <>
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Diagnosis</Text>
                <Text style={{ fontSize: 14, color: colors.foreground, marginBottom: 8 }}>{ret.diagnosis}</Text>
              </>
            )}
            {!!ret.workPerformed && (
              <>
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Work Performed</Text>
                <Text style={{ fontSize: 14, color: colors.foreground }}>{ret.workPerformed}</Text>
              </>
            )}
          </Card>
        </FadeInView>

        {/* Parts Card */}
        <FadeInView animValue={anims[4]}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>PARTS USED</Text>
              <TouchableOpacity onPress={() => setShowAddPart(true)}>
                <Feather name="plus-circle" size={18} color={colors.primary} />
              </TouchableOpacity>
            </View>
            {parts.length === 0 ? (
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontStyle: 'italic' }}>No parts added yet.</Text>
            ) : (
              parts.map(p => (
                <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View>
                    <Text style={{ fontSize: 14, color: colors.foreground }}>{p.partName}</Text>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Qty: {p.quantity} @ {formatCurrency(p.unitCost)}</Text>
                  </View>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>
                    {formatCurrency(p.quantity * p.unitCost)}
                  </Text>
                </View>
              ))
            )}
          </Card>
        </FadeInView>

        {/* Refunds */}
        <FadeInView animValue={anims[5]}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>REFUNDS</Text>
              <TouchableOpacity onPress={() => setShowRefundModal(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="plus-circle" size={16} color={colors.primary} />
                <Text style={{ fontSize: 12, color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>
                  {isDealer ? 'Create Refund' : 'Request Refund'}
                </Text>
              </TouchableOpacity>
            </View>
            {refunds.length === 0 ? (
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontStyle: 'italic' }}>No refunds requested.</Text>
            ) : (
              refunds.map(rf => (
                <View key={rf.id} style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 15, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{formatCurrency(rf.amount)}</Text>
                    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: rf.status === 'paid' ? colors.success + '22' : colors.warning + '22' }}>
                      <Text style={{ fontSize: 10, color: rf.status === 'paid' ? colors.success : colors.warning, textTransform: 'uppercase', fontFamily: 'Inter_700Bold' }}>{rf.status.replace('_', ' ')}</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Reason: {rf.reason}</Text>

                  {rf.status === 'pending_approval' && isDealer && (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                      <Button title="Reject" onPress={() => refundsReject(rf.id, { reason: 'Declined' }).then(() => { refetch(); queryClient.invalidateQueries(); })} variant="outline" style={{ flex: 1 }} />
                      <Button title="Approve" onPress={() => approveRefund(rf.id)} style={{ flex: 1, backgroundColor: colors.success }} />
                    </View>
                  )}
                  {rf.status === 'approved' && isDealer && (
                    <Button title="Mark Paid" onPress={() => markRefundPaid(rf.id)} style={{ marginTop: 12, backgroundColor: colors.info }} />
                  )}
                </View>
              ))
            )}
          </Card>
        </FadeInView>

        {/* Totals Summary */}
        <FadeInView animValue={anims[6]}>
          <Card>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>SUMMARY TOTALS</Text>
            <InfoRow label="Parts Cost" value={formatCurrency(ret.partsCost)} />
            <InfoRow label="Labour Cost" value={formatCurrency(ret.labourCost)} />
            <View style={styles.divider} />
            <InfoRow label="Customer Payable" value={formatCurrency(ret.customerPayable)} color={ret.customerPayable > 0 ? colors.warning : colors.success} bold />
          </Card>
        </FadeInView>

      </KeyboardAwareScrollViewCompat>

      {/* Inspection Modal */}
      <Modal visible={showInspectionEdit} animationType="fade" transparent onRequestClose={() => setShowInspectionEdit(false)}>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Inspection</Text>

            <Text style={[styles.label, { color: colors.foreground }]}>Resolution</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {RESOLUTIONS.map(r => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setEditResolution(r)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                    borderWidth: 1, borderColor: editResolution === r ? colors.primary : colors.border,
                    backgroundColor: editResolution === r ? colors.primary + '22' : colors.card
                  }}
                >
                  <Text style={{ fontSize: 12, color: editResolution === r ? colors.primary : colors.foreground }}>
                    {r.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { color: colors.foreground }]}>Diagnosis</Text>
            <TextInput value={editDiagnosis} onChangeText={setEditDiagnosis} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

            <Text style={[styles.label, { color: colors.foreground }]}>Work Performed</Text>
            <TextInput value={editWork} onChangeText={setEditWork} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Labour Charge</Text>
                <TextInput value={editLabour} onChangeText={setEditLabour} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Cust. Payable</Text>
                <TextInput value={editPayable} onChangeText={setEditPayable} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowInspectionEdit(false)} style={{ flex: 1 }} />
              <Button title="Save" onPress={handleSaveInspection} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </Modal>

      {/* Add Part Modal */}
      <Modal visible={showAddPart} animationType="fade" transparent onRequestClose={() => setShowAddPart(false)}>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Part</Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 12 }}>
              Select from inventory to deduct stock, or enter custom.
            </Text>

            <Text style={[styles.label, { color: colors.foreground }]}>Select Part</Text>
            <ScrollView style={{ maxHeight: 150, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginBottom: 12 }}>
              <TouchableOpacity
                onPress={() => setSelectedInventoryId('')}
                style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: !selectedInventoryId ? colors.primary + '22' : colors.card }}
              >
                <Text style={{ fontSize: 13, color: !selectedInventoryId ? colors.primary : colors.foreground }}>Custom Part (Not in Inventory)</Text>
              </TouchableOpacity>
              {inventory.map(i => (
                <TouchableOpacity
                  key={i.id}
                  onPress={() => setSelectedInventoryId(i.id)}
                  style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: selectedInventoryId === i.id ? colors.primary + '22' : colors.card }}
                >
                  <Text style={{ fontSize: 13, color: selectedInventoryId === i.id ? colors.primary : colors.foreground }}>
                    {i.name} ({i.quantity} in stock)
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {!selectedInventoryId && (
              <>
                <Text style={[styles.label, { color: colors.foreground }]}>Part Name</Text>
                <TextInput value={partName} onChangeText={setPartName} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
                <Text style={[styles.label, { color: colors.foreground }]}>Unit Cost</Text>
                <TextInput value={partCost} onChangeText={setPartCost} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
              </>
            )}

            <Text style={[styles.label, { color: colors.foreground }]}>Quantity</Text>
            <TextInput value={partQty} onChangeText={setPartQty} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowAddPart(false)} style={{ flex: 1 }} />
              <Button title="Add" onPress={handleAddPart} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </Modal>

      {/* Refund Modal */}
      <Modal visible={showRefundModal} animationType="fade" transparent onRequestClose={() => setShowRefundModal(false)}>
        <KeyboardAvoidingCompat style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{isDealer ? 'Create Refund' : 'Request Refund'}</Text>

            <Text style={[styles.label, { color: colors.foreground }]}>Amount</Text>
            <TextInput value={refundAmount} onChangeText={setRefundAmount} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

            <Text style={[styles.label, { color: colors.foreground }]}>Reason</Text>
            <TextInput value={refundReason} onChangeText={setRefundReason} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowRefundModal(false)} style={{ flex: 1 }} />
              <Button title="Submit" onPress={handleCreateRefund} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </Modal>
      {/* Status Picker Modal */}
      <Modal visible={showStatusPicker} animationType="fade" transparent onRequestClose={() => setShowStatusPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, marginBottom: 16 }]}>Update Status</Text>
            <View style={{ gap: 8 }}>
              {availableStatuses.map(s => (
                <TouchableOpacity
                  key={s}
                  onPress={() => { setShowStatusPicker(false); handleStatusUpdate(s); }}
                  style={{ padding: 14, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
                >
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: "Inter_500Medium", textTransform: "capitalize" }}>
                    {s.replace(/_/g, " ")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Button title="Cancel" variant="outline" onPress={() => setShowStatusPicker(false)} style={{ marginTop: 16 }} />
          </View>
        </View>
      </Modal>


    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  returnId: { fontSize: 18 },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 12, gap: 10 },
  cardLabel: { fontSize: 10, letterSpacing: 0.8, marginBottom: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  infoLabel: { fontSize: 12 },
  infoValue: { fontSize: 13, textAlign: 'right', flex: 1, marginLeft: 12 },
  divider: { height: 1, marginVertical: 6, backgroundColor: '#333' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
  modalContent: { borderWidth: 1, borderRadius: 12, padding: 16 },
  modalTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 10 },
  label: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 4, marginTop: 6 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
});