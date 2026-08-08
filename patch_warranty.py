import sys

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'r') as f:
    content = f.read()

state_target = "  const [deliveryWarranty, setDeliveryWarranty] = useState('0');"
state_new = """  const [deliveryWarranty, setDeliveryWarranty] = useState('0');
  const [customWarrantyDays, setCustomWarrantyDays] = useState('');"""

content = content.replace(state_target, state_new)

ui_target = """            <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_500Medium', marginBottom: 8 }}>Warranty (Days)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {['0', '7', '15', '30', '90', '180'].map(w => ("""

ui_new = """            <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_500Medium', marginBottom: 8 }}>Warranty (Days)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {(user?.role === 'dealer' || user?.role === 'super_admin' ? ['0', '7', '15', '30', '90', '180', 'Custom'] : ['0', '7', '15', '30', '90', '180']).map(w => ("""

content = content.replace(ui_target, ui_new)

custom_input_target = """            <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowDeliveryHandover(false)} style={{ flex: 1 }} />
            </View>"""
custom_input_new = """            {deliveryWarranty === 'Custom' && (
              <View style={{ marginBottom: 20 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Custom Days (1-3650)</Text>
                <TextInput 
                  value={customWarrantyDays} 
                  onChangeText={setCustomWarrantyDays} 
                  keyboardType="numeric" 
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} 
                  placeholder="e.g. 365"
                />
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowDeliveryHandover(false)} style={{ flex: 1 }} />
            </View>"""

content = content.replace(custom_input_target, custom_input_new)

save_target = """      const deliveryDate = new Date().toISOString().split('T')[0];
      let warrantyExpiry = undefined;
      const wd = parseInt(deliveryWarranty);
      if (wd > 0) {"""
save_new = """      const deliveryDate = new Date().toISOString().split('T')[0];
      let warrantyExpiry = undefined;
      const wd = deliveryWarranty === 'Custom' ? parseInt(customWarrantyDays || '0') : parseInt(deliveryWarranty);
      if (wd > 0) {"""

content = content.replace(save_target, save_new)

otp_save_target = """                  const deliveryDate = new Date().toISOString().split('T')[0];
                  let warrantyExpiry = undefined;
                  const wd = parseInt(deliveryWarranty);
                  if (wd > 0) {"""
otp_save_new = """                  const deliveryDate = new Date().toISOString().split('T')[0];
                  let warrantyExpiry = undefined;
                  const wd = deliveryWarranty === 'Custom' ? parseInt(customWarrantyDays || '0') : parseInt(deliveryWarranty);
                  if (wd > 0) {"""

content = content.replace(otp_save_target, otp_save_new)

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'w') as f:
    f.write(content)
