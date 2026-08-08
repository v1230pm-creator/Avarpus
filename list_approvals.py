import sys

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'r') as f:
    content = f.read()

target = "{/* Signatures */}"
approvals_list = """
        {/* Estimate Approvals */}
        {approvals.length > 0 && (
          <FadeInView animValue={anims[6]}>
            <Card>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>ESTIMATE APPROVALS</Text>
              {approvals.map(app => (
                <View key={app.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>₹{app.oldAmount} → ₹{app.newAmount}</Text>
                    <Text style={{ fontSize: 12, color: app.status === 'pending' ? colors.warning : app.status === 'approved' ? colors.success : colors.destructive, textTransform: 'uppercase', fontFamily: 'Inter_700Bold' }}>{app.status}</Text>
                  </View>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{app.reason}</Text>
                  
                  {app.status === 'pending' && (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                      <Button title="Approve (Dealer)" onPress={async () => {
                        try {
                          await estimateApprovalsDecide(repair.id, { decision: 'approved', method: 'dealer' });
                          await loadAll();
                          await approvalsRefetch();
                          queryClient.invalidateQueries();
                        } catch (e: any) { Alert.alert('Error', e.message); }
                      }} size="sm" style={{ flex: 1 }} />
                      <Button title="Reject" variant="outline" onPress={async () => {
                        try {
                          await estimateApprovalsDecide(repair.id, { decision: 'rejected', method: 'dealer' });
                          await loadAll();
                          await approvalsRefetch();
                          queryClient.invalidateQueries();
                        } catch (e: any) { Alert.alert('Error', e.message); }
                      }} size="sm" style={{ flex: 1 }} />
                    </View>
                  )}
                </View>
              ))}
            </Card>
          </FadeInView>
        )}
"""

content = content.replace(target, approvals_list + "\n        " + target)
with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'w') as f:
    f.write(content)
