import sys

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'r') as f:
    content = f.read()

target = """            <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowDeliveryHandover(false)} style={{ flex: 1 }} />
              <Button title="Proceed to Signature" onPress={handleHandoverProceed} style={{ flex: 1 }} />
            </View>"""
            
new_content = """
            <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_500Medium', marginBottom: 8 }}>Warranty (Days)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {['0', '7', '15', '30', '90', '180'].map(w => (
                <TouchableOpacity
                  key={w}
                  onPress={() => setDeliveryWarranty(w)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                    borderWidth: 1, borderColor: deliveryWarranty === w ? colors.primary : colors.border,
                    backgroundColor: deliveryWarranty === w ? colors.primary : colors.card
                  }}
                >
                  <Text style={{ color: deliveryWarranty === w ? '#FFF' : colors.foreground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
                    {w === '0' ? 'None' : w}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowDeliveryHandover(false)} style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
              <Button title="Send OTP" onPress={async () => {
                try {
                  await deliveryOtpSend(repair.id);
                  setShowDeliveryHandover(false);
                  setTimeout(() => setShowDeliveryOtp(true), 350);
                } catch(e: any) {
                  Alert.alert('Error', e.message);
                }
              }} variant="outline" style={{ flex: 1 }} />
              <Button title="Signature" onPress={handleHandoverProceed} style={{ flex: 1 }} />
            </View>
"""

content = content.replace(target, new_content)

otp_modal = """
      {/* Delivery OTP Modal */}
      <Modal visible={showDeliveryOtp} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Verify Delivery OTP</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 16 }}>Sent to customer email.</Text>
            
            <TextInput value={deliveryOtpCode} onChangeText={setDeliveryOtpCode} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} placeholder="OTP Code" />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowDeliveryOtp(false)} style={{ flex: 1 }} />
              <Button title="Verify & Deliver" onPress={async () => {
                if (!deliveryOtpCode) return;
                setUpdating(true);
                try {
                  await deliveryOtpVerify(repair.id, { code: deliveryOtpCode });
                  
                  // Setup warranty
                  const deliveryDate = new Date().toISOString().split('T')[0];
                  let warrantyExpiry = undefined;
                  const wd = parseInt(deliveryWarranty);
                  if (wd > 0) {
                    const exp = new Date();
                    exp.setDate(exp.getDate() + wd);
                    warrantyExpiry = exp.toISOString().split('T')[0];
                  }

                  await updateRepair({
                    ...repair,
                    status: 'delivered',
                    deliveryDate,
                    warrantyExpiry,
                    warrantyDays: wd,
                    paymentMethod: handoverPaymentMethod,
                    otpVerified: true
                  });
                  
                  setShowDeliveryOtp(false);
                  await loadAll();
                  queryClient.invalidateQueries();
                } catch (e: any) {
                  Alert.alert('Error', e.message);
                } finally {
                  setUpdating(false);
                }
              }} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
"""

content = content.replace("{/* Signatures */}", otp_modal + "{/* Signatures */}")
with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'w') as f:
    f.write(content)
