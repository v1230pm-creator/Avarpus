import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Input } from '@/components/ui/Input';
import { SelectInput } from '@/components/ui/SelectInput';
import { FormSheet } from '@/components/ui/FormSheet';
import { useColors } from '@/hooks/useColors';
import { useData } from '@/context/DataContext';
import { Purchase } from '@/types';
import { formatCurrency, getTodayStr } from '@/utils/helpers';

const STATUS_OPTIONS = ['paid', 'unpaid', 'partial'];
const STATUS_LABELS: Record<string, string> = { paid: 'Paid', unpaid: 'Unpaid', partial: 'Partial' };
const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Credit'];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** When set, the sheet edits this purchase instead of creating one. */
  purchase?: Purchase;
}

/** Add/edit purchase form. Values persist across failed saves for retry. */
export function PurchaseFormSheet({ visible, onClose, purchase }: Props) {
  const colors = useColors();
  const { addPurchase, updatePurchase } = useData();
  const [invoiceNo, setInvoiceNo] = useState('');
  const [supplier, setSupplier] = useState('');
  const [supplierMobile, setSupplierMobile] = useState('');
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('unpaid');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setInvoiceNo(purchase?.invoiceNo ?? '');
      setSupplier(purchase?.supplier ?? '');
      setSupplierMobile(purchase?.supplierMobile ?? '');
      setItemName(purchase?.itemName ?? '');
      setQuantity(purchase ? String(purchase.quantity) : '');
      setPurchasePrice(purchase ? String(purchase.purchasePrice) : '');
      setPaymentStatus(purchase?.paymentStatus ?? 'unpaid');
      setPaymentMethod(purchase?.paymentMethod ?? 'Cash');
      setErrors({});
    }
  }, [visible, purchase]);

  const total = useMemo(() => {
    const qty = parseInt(quantity, 10);
    const price = parseFloat(purchasePrice);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0;
    return qty * price;
  }, [quantity, purchasePrice]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!invoiceNo.trim()) e.invoiceNo = 'Invoice number is required';
    if (!supplier.trim()) e.supplier = 'Supplier is required';
    if (supplierMobile.trim() && !/^\d{10}$/.test(supplierMobile.trim())) e.supplierMobile = 'Enter a valid 10-digit mobile number';
    if (!itemName.trim()) e.itemName = 'Item name is required';
    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) e.quantity = 'Enter a quantity of 1 or more';
    const price = parseFloat(purchasePrice);
    if (!Number.isFinite(price) || price < 0) e.purchasePrice = 'Enter a valid unit price';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const payload = {
        invoiceNo: invoiceNo.trim(),
        supplier: supplier.trim(),
        supplierMobile: supplierMobile.trim() || undefined,
        itemName: itemName.trim(),
        quantity: parseInt(quantity, 10),
        purchasePrice: parseFloat(purchasePrice),
        total,
        paymentStatus: paymentStatus as Purchase['paymentStatus'],
        paymentMethod,
      };
      if (purchase) {
        await updatePurchase({ ...purchase, ...payload });
      } else {
        await addPurchase({ id: '', purchaseId: '', createdAt: '', date: getTodayStr(), ...payload });
      }
      onClose();
    } catch (err) {
      Alert.alert(
        purchase ? 'Update failed' : 'Save failed',
        err instanceof Error ? err.message : "Couldn't save the purchase. Please try again. Your entries are still here.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormSheet
      visible={visible}
      title={purchase ? 'Edit Purchase' : 'Add Purchase'}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={purchase ? 'Save Changes' : 'Add Purchase'}
      loading={loading}
    >
      <Input label="Invoice No *" value={invoiceNo} onChangeText={setInvoiceNo} placeholder="e.g. INV-1024" autoCapitalize="characters" error={errors.invoiceNo} />
      <Input label="Supplier *" value={supplier} onChangeText={setSupplier} placeholder="Supplier name" error={errors.supplier} />
      <Input label="Supplier Mobile" value={supplierMobile} onChangeText={setSupplierMobile} placeholder="Optional" keyboardType="phone-pad" maxLength={10} error={errors.supplierMobile} />
      <Input label="Item *" value={itemName} onChangeText={setItemName} placeholder="What was purchased" error={errors.itemName} />
      <View style={styles.row}>
        <Input label="Quantity *" value={quantity} onChangeText={setQuantity} placeholder="0" keyboardType="number-pad" error={errors.quantity} containerStyle={styles.half} />
        <Input label="Unit Price *" value={purchasePrice} onChangeText={setPurchasePrice} placeholder="0" keyboardType="decimal-pad" error={errors.purchasePrice} containerStyle={styles.half} />
      </View>
      <View style={styles.totalRow}>
        <Text style={[styles.totalLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Total</Text>
        <Text style={[styles.totalValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{formatCurrency(total)}</Text>
      </View>
      <SelectInput label="Payment Status" options={STATUS_OPTIONS} value={paymentStatus} onChange={setPaymentStatus} labelMap={STATUS_LABELS} />
      <SelectInput label="Payment Method" options={PAYMENT_METHODS} value={paymentMethod} onChange={setPaymentMethod} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { fontSize: 13 },
  totalValue: { fontSize: 18 },
});
