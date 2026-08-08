import sys

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'r') as f:
    content = f.read()

target = """            <Button title="Collect Payment" onPress={() => setShowPayment(true)} variant="outline" size="sm" style={{ marginTop: 12 }} leftIcon="credit-card" />"""
new_content = """            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Button title="Payment" onPress={() => setShowPayment(true)} variant="outline" size="sm" style={{ flex: 1 }} leftIcon="credit-card" />
              <Button title="New Estimate" onPress={() => setShowApproval(true)} variant="outline" size="sm" style={{ flex: 1 }} leftIcon="file-text" />
            </View>"""

content = content.replace(target, new_content)

target_modal = "{/* Financial Edit Modal */}"
approval_modal = """
      {/* Estimate Approval Modal */}
      <Modal visible={showApproval} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Request Customer Approval</Text>
            
            <Text style={[styles.label, { color: colors.foreground }]}>New Estimate Amount (₹)</Text>
            <TextInput value={newEstimate} onChangeText={setNewEstimate} keyboardType="numeric" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
            
            <Text style={[styles.label, { color: colors.foreground }]}>Reason for Change</Text>
            <TextInput value={approvalReason} onChangeText={setApprovalReason} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowApproval(false)} style={{ flex: 1 }} />
              <Button title="Submit Request" onPress={async () => {
                if (!newEstimate || !approvalReason) return Alert.alert('Required', 'Please fill all fields');
                setUpdating(true);
                try {
                  await estimateApprovalsCreate(repair.id, {
                    newAmount: Number(newEstimate),
                    reason: approvalReason
                  });
                  setShowApproval(false);
                  setNewEstimate('');
                  setApprovalReason('');
                  await loadAll();
                  await approvalsRefetch();
                  queryClient.invalidateQueries();
                } catch (e: any) {
                  Alert.alert('Request Failed', e.message);
                } finally {
                  setUpdating(false);
                }
              }} loading={updating} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
"""

content = content.replace(target_modal, approval_modal + target_modal)
with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'w') as f:
    f.write(content)
