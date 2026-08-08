import sys

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'r') as f:
    content = f.read()

import_target = """  estimateApprovalsDecide, deliveryOtpSend, deliveryOtpVerify, repairNotifyReady
} from '@workspace/api-client-react';"""
import_new = """  estimateApprovalsDecide, deliveryOtpSend, deliveryOtpVerify, repairNotifyReady, estimateApprovalsSendOtp
} from '@workspace/api-client-react';"""

content = content.replace(import_target, import_new)

approvals_target = """                  {app.status === 'pending' && (
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
                  )}"""

approvals_new = """                  {app.status === 'pending' && (
                    <View style={{ marginTop: 10, gap: 10 }}>
                      {showOtp ? (
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TextInput value={otpCode} onChangeText={setOtpCode} keyboardType="numeric" placeholder="OTP Code" style={[styles.input, { flex: 1, height: 36, minHeight: 36 }]} />
                          <Button title="Verify" onPress={async () => {
                            if (!otpCode) return;
                            try {
                              await estimateApprovalsDecide(app.id, { decision: 'approved', method: 'otp', code: otpCode });
                              setShowOtp(false);
                              setOtpCode('');
                              await loadAll();
                              await approvalsRefetch();
                              queryClient.invalidateQueries();
                            } catch (e: any) { Alert.alert('Error', e.message); }
                          }} size="sm" />
                          <Button title="Cancel" variant="outline" onPress={() => setShowOtp(false)} size="sm" />
                        </View>
                      ) : (
                        <>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <Button title="Approve (Dealer)" onPress={async () => {
                              try {
                                await estimateApprovalsDecide(app.id, { decision: 'approved', method: 'dealer' });
                                await loadAll();
                                await approvalsRefetch();
                                queryClient.invalidateQueries();
                              } catch (e: any) { Alert.alert('Error', e.message); }
                            }} size="sm" style={{ flex: 1 }} />
                            <Button title="Reject" variant="outline" onPress={async () => {
                              try {
                                await estimateApprovalsDecide(app.id, { decision: 'rejected', method: 'dealer' });
                                await loadAll();
                                await approvalsRefetch();
                                queryClient.invalidateQueries();
                              } catch (e: any) { Alert.alert('Error', e.message); }
                            }} size="sm" style={{ flex: 1 }} />
                          </View>
                          <Button title="Send OTP to Customer" variant="outline" leftIcon="smartphone" onPress={async () => {
                            try {
                              await estimateApprovalsSendOtp(app.id);
                              setShowOtp(true);
                            } catch (e: any) { Alert.alert('Error', e.message); }
                          }} size="sm" />
                        </>
                      )}
                    </View>
                  )}"""

content = content.replace(approvals_target, approvals_new)
with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'w') as f:
    f.write(content)
