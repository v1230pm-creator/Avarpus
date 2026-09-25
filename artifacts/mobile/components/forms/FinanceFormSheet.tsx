import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Input } from '@/components/ui/Input';
import { SelectInput } from '@/components/ui/SelectInput';
import { FormSheet } from '@/components/ui/FormSheet';
import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { FinanceEntry } from '@/types';
import { font, fontFamily } from '@/constants/typography';
import { getTodayStr, isValidDateStr } from '@/utils/helpers';
import { approvalsCreate } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { radius, space } from '@/constants/spacing';

const TYPE_OPTIONS = ['income', 'expense'];
const TYPE_LABELS: Record<string, string> = { income: 'Income', expense: 'Expense' };
const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer'];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** When set, the sheet edits this entry instead of creating one. */
  entry?: FinanceEntry;
}

/** Add/edit income/expense entry form. Values persist across failed saves for retry. */
export function FinanceFormSheet({ visible, onClose, entry }: Props) {
  const colors = useColors();
  const { addFinanceEntry, updateFinanceEntry } = useData();
  const { user } = useAuth();
  const [type, setType] = useState('income');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [date, setDate] = useState(getTodayStr());
  const [reason, setReason] = useState('');
  const [forceApprovalMode, setForceApprovalMode] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const isStaff = user?.role !== 'dealer' && user?.role !== 'super_admin';
  const isBackdated = isStaff && (date.trim() < getTodayStr() || forceApprovalMode);

  useEffect(() => {
    if (visible) {
      setType(entry?.type ?? 'income');
      setCategory(entry?.category ?? '');
      setAmount(entry ? String(entry.amount) : '');
      setDescription(entry?.description ?? '');
      setPaymentMethod(entry?.paymentMethod ?? 'Cash');
      setDate(entry?.date ?? getTodayStr());
      setReason('');
      setForceApprovalMode(false);
      setErrors({});
    }
  }, [visible, entry]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!category.trim()) e.category = 'Category is required';
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) e.amount = 'Enter an amount greater than 0';
    if (!isValidDateStr(date.trim())) e.date = 'Enter a valid date as YYYY-MM-DD';
    else if (date.trim() > getTodayStr()) e.date = 'Date cannot be in the future';

    if (isBackdated && !reason.trim()) {
      e.reason = 'A reason is required for backdated entries';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const payload = {
        type: type as FinanceEntry['type'],
        category: category.trim(),
        amount: parseFloat(amount),
        description: description.trim(),
        paymentMethod,
        date: date.trim(),
      };

      if (isBackdated) {
        await approvalsCreate({
          recordType: 'finance',
          mode: entry ? 'update' : 'create',
          recordId: entry?.id,
          payload,
          requestedDate: date.trim(),
          reason: reason.trim(),
        });
        Alert.alert('Request Sent', 'Request sent to Dealer/Owner for approval.');
        onClose();
        return;
      }

      if (entry) {
        await updateFinanceEntry({ ...entry, ...payload });
      } else {
        await addFinanceEntry({ id: '', createdAt: '', ...payload });
      }
      onClose();
    } catch (err: any) {
      if (err?.code === 'APPROVAL_REQUIRED' || err?.message?.includes('APPROVAL_REQUIRED') || err?.data?.code === 'APPROVAL_REQUIRED') {
        setForceApprovalMode(true);
        Alert.alert('Approval Required', 'This entry requires dealer approval. Please provide a reason and submit again.');
        return;
      }
      Alert.alert(
        entry ? 'Update failed' : 'Save failed',
        err instanceof Error ? err.message : "Couldn't save the entry. Please try again. Your entries are still here.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormSheet
      visible={visible}
      title={entry ? 'Edit Entry' : 'Add Entry'}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={isBackdated ? 'Request Approval' : entry ? 'Save Changes' : 'Add Entry'}
      loading={loading}
    >
      {isBackdated && (
        <View style={[styles.warningBanner, { backgroundColor: colors.warning + '22', borderColor: colors.warning + '55' }]}>
          <Feather name="alert-triangle" size={16} color={colors.warning} />
          <Text style={[styles.warningText, { color: colors.warning, fontFamily: fontFamily.medium }]}>
            This is a backdated entry. Dealer/Owner approval is required.
          </Text>
        </View>
      )}

      <SelectInput label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} labelMap={TYPE_LABELS} />
      <Input label="Category *" value={category} onChangeText={setCategory} placeholder="e.g. Repair Charges, Utilities" error={errors.category} />
      <Input label="Date *" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} error={errors.date} />

      {isBackdated && (
        <Input label="Reason for backdating *" value={reason} onChangeText={setReason} placeholder="Explain why this is backdated..." error={errors.reason} />
      )}

      <Input label="Amount *" value={amount} onChangeText={setAmount} placeholder="0" keyboardType="decimal-pad" error={errors.amount} />
      <Input label="Description" value={description} onChangeText={setDescription} placeholder="Optional note" />
      <SelectInput label="Payment Method" options={PAYMENT_METHODS} value={paymentMethod} onChange={setPaymentMethod} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.sm, borderWidth: 1, marginBottom: space.xs },
  warningText: { ...font.small, flex: 1 },
});
