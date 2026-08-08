import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Input } from '@/components/ui/Input';
import { SelectInput } from '@/components/ui/SelectInput';
import { FormSheet } from '@/components/ui/FormSheet';
import { useData } from '@/context/DataContext';
import { FinanceEntry } from '@/types';
import { getTodayStr, isValidDateStr } from '@/utils/helpers';

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
  const { addFinanceEntry, updateFinanceEntry } = useData();
  const [type, setType] = useState('income');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [date, setDate] = useState(getTodayStr());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setType(entry?.type ?? 'income');
      setCategory(entry?.category ?? '');
      setAmount(entry ? String(entry.amount) : '');
      setDescription(entry?.description ?? '');
      setPaymentMethod(entry?.paymentMethod ?? 'Cash');
      setDate(entry?.date ?? getTodayStr());
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
      if (entry) {
        await updateFinanceEntry({ ...entry, ...payload });
      } else {
        await addFinanceEntry({ id: '', createdAt: '', ...payload });
      }
      onClose();
    } catch (err) {
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
      submitLabel={entry ? 'Save Changes' : 'Add Entry'}
      loading={loading}
    >
      <SelectInput label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} labelMap={TYPE_LABELS} />
      <Input label="Category *" value={category} onChangeText={setCategory} placeholder="e.g. Repair Charges, Utilities" error={errors.category} />
      <Input label="Date *" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} error={errors.date} />
      <Input label="Amount *" value={amount} onChangeText={setAmount} placeholder="0" keyboardType="decimal-pad" error={errors.amount} />
      <Input label="Description" value={description} onChangeText={setDescription} placeholder="Optional note" />
      <SelectInput label="Payment Method" options={PAYMENT_METHODS} value={paymentMethod} onChange={setPaymentMethod} />
    </FormSheet>
  );
}
