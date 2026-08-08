import sys

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'r') as f:
    content = f.read()

target = """            {repair.status === 'delivered' && ("""
notify_action = """            {repair.status === 'ready' && (
              <TouchableOpacity onPress={async () => {
                try {
                  await repairNotifyReady(repair.id);
                  Alert.alert('Success', 'Customer notified via email.');
                  await loadAll();
                  queryClient.invalidateQueries();
                } catch(e: any) {
                  Alert.alert('Notice', e.message || 'Email service not configured for this address');
                }
              }} style={[styles.nextStatusBtn, { backgroundColor: colors.info, borderRadius: colors.radius - 2, marginBottom: 8 }]}>
                <Feather name="bell" size={18} color="#FFFFFF" />
                <Text style={[styles.nextStatusText, { fontFamily: 'Inter_600SemiBold' }]}>
                  Notify Customer
                </Text>
              </TouchableOpacity>
            )}
"""

content = content.replace(target, notify_action + target)
with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'w') as f:
    f.write(content)
