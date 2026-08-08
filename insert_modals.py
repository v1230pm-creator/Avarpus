import sys

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'r') as f:
    content = f.read()

target = "{/* Financial Edit Modal */}"
new_modals = """
      {/* Collect Payment Modal */}
      <Modal visible={showPayment} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Collect Payment</Text>
            
            <Text style={[styles.label, { color: colors.foreground }]}>Amount</Text>
            <TextInput value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
            
            <Text style={[styles.label, { color: colors.foreground }]}>Method</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'].map(m => (
                <TouchableOpacity key={m} onPress={() => setPaymentMethod(m)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: paymentMethod === m ? colors.primary : colors.card, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: paymentMethod === m ? '#FFF' : colors.foreground }}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { color: colors.foreground }]}>Type</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {['advance', 'partial', 'final'].map(k => (
                <TouchableOpacity key={k} onPress={() => setPaymentKind(k)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: paymentKind === k ? colors.primary : colors.card, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: paymentKind === k ? '#FFF' : colors.foreground, textTransform: 'capitalize' }}>{k}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { color: colors.foreground }]}>Note / Reference</Text>
            <TextInput value={paymentNote} onChangeText={setPaymentNote} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowPayment(false)} style={{ flex: 1 }} />
              <Button title="Save Payment" onPress={async () => {
                if (!paymentAmount) return Alert.alert('Required', 'Please enter amount');
                setUpdating(true);
                try {
                  await repairPaymentsCreate(repair.id, {
                    amount: Number(paymentAmount),
                    method: paymentMethod,
                    kind: paymentKind as any,
                    note: paymentNote || undefined
                  });
                  setShowPayment(false);
                  setPaymentAmount('');
                  setPaymentNote('');
                  await loadAll();
                  await paymentsRefetch();
                  queryClient.invalidateQueries();
                } catch (e: any) {
                  Alert.alert('Payment Failed', e.message || 'Could not record payment. Overpayment?');
                } finally {
                  setUpdating(false);
                }
              }} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

"""

content = content.replace(target, new_modals + target)
with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'w') as f:
    f.write(content)
