import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Input } from '@/components/ui/Input';
import { SelectInput } from '@/components/ui/SelectInput';
import { FormSheet } from '@/components/ui/FormSheet';
import { useData } from '@/context/DataContext';
import { InventoryItem } from '@/types';

const CATEGORY_OPTIONS = ['product', 'accessory', 'spare_part'];
const CATEGORY_LABELS: Record<string, string> = { product: 'Product', accessory: 'Accessory', spare_part: 'Spare Part' };

interface Props {
  visible: boolean;
  onClose: () => void;
  /** When set, the sheet edits this item instead of creating one. */
  item?: InventoryItem;
}

/** Add/edit inventory item form. Values persist across failed saves for retry. */
export function InventoryFormSheet({ visible, onClose, item }: Props) {
  const { addInventoryItem, updateInventoryItem } = useData();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('product');
  const [brand, setBrand] = useState('');
  const [quantity, setQuantity] = useState('');
  const [minStock, setMinStock] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [supplier, setSupplier] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(item?.name ?? '');
      setCategory(item?.category ?? 'product');
      setBrand(item?.brand ?? '');
      setQuantity(item ? String(item.quantity) : '');
      setMinStock(item ? String(item.minStock) : '');
      setPurchasePrice(item ? String(item.purchasePrice) : '');
      setSellingPrice(item ? String(item.sellingPrice) : '');
      setSupplier(item?.supplier ?? '');
      setErrors({});
    }
  }, [visible, item]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Item name is required';
    if (!brand.trim()) e.brand = 'Brand is required';
    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 0) e.quantity = 'Enter a quantity of 0 or more';
    const min = parseInt(minStock, 10);
    if (!Number.isFinite(min) || min < 0) e.minStock = 'Enter a minimum stock of 0 or more';
    const pp = parseFloat(purchasePrice);
    if (!Number.isFinite(pp) || pp < 0) e.purchasePrice = 'Enter a valid purchase price';
    const sp = parseFloat(sellingPrice);
    if (!Number.isFinite(sp) || sp < 0) e.sellingPrice = 'Enter a valid selling price';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        category: category as InventoryItem['category'],
        brand: brand.trim(),
        quantity: parseInt(quantity, 10),
        minStock: parseInt(minStock, 10),
        purchasePrice: parseFloat(purchasePrice),
        sellingPrice: parseFloat(sellingPrice),
        supplier: supplier.trim() || undefined,
      };
      if (item) {
        await updateInventoryItem({ ...item, ...payload });
      } else {
        await addInventoryItem({ id: '', createdAt: '', ...payload });
      }
      onClose();
    } catch (err) {
      Alert.alert(
        item ? 'Update failed' : 'Save failed',
        err instanceof Error ? err.message : "Couldn't save the item. Please try again. Your entries are still here.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormSheet
      visible={visible}
      title={item ? 'Edit Item' : 'Add Inventory Item'}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={item ? 'Save Changes' : 'Add Item'}
      loading={loading}
    >
      <Input label="Item Name *" value={name} onChangeText={setName} placeholder="e.g. iPhone 12 Battery" error={errors.name} />
      <SelectInput label="Category" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} labelMap={CATEGORY_LABELS} />
      <Input label="Brand *" value={brand} onChangeText={setBrand} placeholder="e.g. Apple" error={errors.brand} />
      <View style={styles.row}>
        <Input label="Quantity *" value={quantity} onChangeText={setQuantity} placeholder="0" keyboardType="number-pad" error={errors.quantity} containerStyle={styles.half} />
        <Input label="Min Stock *" value={minStock} onChangeText={setMinStock} placeholder="0" keyboardType="number-pad" error={errors.minStock} containerStyle={styles.half} />
      </View>
      <View style={styles.row}>
        <Input label="Purchase Price *" value={purchasePrice} onChangeText={setPurchasePrice} placeholder="0" keyboardType="decimal-pad" error={errors.purchasePrice} containerStyle={styles.half} />
        <Input label="Selling Price *" value={sellingPrice} onChangeText={setSellingPrice} placeholder="0" keyboardType="decimal-pad" error={errors.sellingPrice} containerStyle={styles.half} />
      </View>
      <Input label="Supplier" value={supplier} onChangeText={setSupplier} placeholder="Optional" />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
});
