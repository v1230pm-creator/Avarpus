import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { FormSheet } from '@/components/ui/FormSheet';
import { Input } from '@/components/ui/Input';
import { useCustomerKhataTransactionCreate } from '@/hooks/api-khata-adapter';

interface Props {
  visible: boolean;
  onClose: () => void;
  partyId: string;
  partyType: 'customer' | 'dealer';
  type: 'given' | 'received'; // given = we gave (charge), received = we received (payment)
  onSuccess?: () => void;
}

export function KhataTransactionSheet({ visible, onClose, partyId, partyType, type, onSuccess }: Props) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const clientRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (visible && !clientRequestIdRef.current) {
      clientRequestIdRef.current =
        `khata-${partyId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    } else if (!visible) {
      clientRequestIdRef.current = null;
    }
  }, [partyId, visible]);

  const createTx = useCustomerKhataTransactionCreate();

  const handleSubmit = async () => {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      setErrors({ amount: 'Enter a valid amount' });
      return;
    }
    setErrors({});

    try {
      await createTx.mutateAsync({
        partyId,
        partyType,
        type,
        amount: val,
        note: note.trim(),
        date: new Date().toISOString(),
        clientRequestId: clientRequestIdRef.current!,
      });
      onSuccess?.();
      setAmount('');
      setNote('');
      onClose();
    } catch (err) {
      Alert.alert('Error', 'Failed to save transaction');
    }
  };

  return (
    <FormSheet
      visible={visible}
      onClose={onClose}
      title={type === 'given' ? 'You Gave (Charge)' : 'You Got (Payment)'}
      submitLabel="Save Transaction"
      onSubmit={handleSubmit}
      loading={createTx.isPending}
    >
      <Input
        label="Amount *"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="0.00"
        leftIcon="dollar-sign"
        error={errors.amount}
      />
      <Input
        label="Note (Optional)"
        value={note}
        onChangeText={setNote}
        placeholder="What was this for?"
        leftIcon="file-text"
      />
    </FormSheet>
  );
}
