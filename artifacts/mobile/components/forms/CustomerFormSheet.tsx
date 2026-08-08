import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Input } from '@/components/ui/Input';
import { FormSheet } from '@/components/ui/FormSheet';
import { useData } from '@/context/DataContext';
import { Customer } from '@/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** When set, the sheet edits this customer instead of creating one. */
  customer?: Customer;
}

/** Add/edit customer form. Values persist across failed saves for retry. */
export function CustomerFormSheet({ visible, onClose, customer }: Props) {
  const { addCustomer, updateCustomer } = useData();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [alternateMobile, setAlternateMobile] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Re-seed fields each time the sheet opens (fresh add, or the target customer).
  useEffect(() => {
    if (visible) {
      setName(customer?.name ?? '');
      setMobile(customer?.mobile ?? '');
      setAlternateMobile((customer as any)?.alternateMobile ?? '');
      setEmail(customer?.email ?? '');
      setAddress(customer?.address ?? '');
      setErrors({});
    }
  }, [visible, customer]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!/^\d{10}$/.test(mobile.trim())) e.mobile = 'Enter a valid 10-digit mobile number';
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'Enter a valid email';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        mobile: mobile.trim(),
        email: email.trim() || undefined,
        alternateMobile: alternateMobile.trim() || undefined,
        address: address.trim() || undefined,
      };
      if (customer) {
        await updateCustomer({ ...customer, ...payload });
      } else {
        await addCustomer(payload);
      }
      onClose();
    } catch (err) {
      Alert.alert(
        customer ? 'Update failed' : 'Save failed',
        err instanceof Error ? err.message : "Couldn't save the customer. Please try again. Your entries are still here.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormSheet
      visible={visible}
      title={customer ? 'Edit Customer' : 'Add Customer'}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={customer ? 'Save Changes' : 'Add Customer'}
      loading={loading}
    >
      <Input label="Name *" value={name} onChangeText={setName} placeholder="Customer name" error={errors.name} leftIcon="user" />
      <Input label="Mobile *" value={mobile} onChangeText={setMobile} placeholder="10-digit mobile" keyboardType="phone-pad" maxLength={10} error={errors.mobile} leftIcon="phone" />
      <Input label="Alternate Mobile" value={alternateMobile} onChangeText={setAlternateMobile} placeholder="Optional" keyboardType="phone-pad" maxLength={10} error={errors.alternateMobile} leftIcon="phone" />
      <Input label="Email" value={email} onChangeText={setEmail} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" error={errors.email} leftIcon="mail" />
      <Input label="Address" value={address} onChangeText={setAddress} placeholder="Optional" leftIcon="map-pin" />
    </FormSheet>
  );
}
