import sys

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'r') as f:
    content = f.read()

target = "{/* Financial Edit Modal */}"
new_modals = """
      {/* Testing Modal */}
      <Modal visible={showTesting} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Final Testing Checklist</Text>
            
            <ScrollView style={{ maxHeight: 400, marginVertical: 10 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {CHECKLIST_ITEMS.map((item) => {
                  const checked = testingChecklist[item.id] || false;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      activeOpacity={0.7}
                      onPress={() => setTestingChecklist(prev => ({ ...prev, [item.id]: !checked }))}
                      style={{ width: '48%', flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, gap: 10, backgroundColor: colors.card, borderColor: checked ? colors.primary : colors.border }}
                    >
                      <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: checked ? colors.primary : 'transparent', borderColor: checked ? colors.primary : colors.muted }}>
                        {checked && <Feather name="check" size={14} color="#FFF" />}
                      </View>
                      <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_500Medium', flex: 1 }} numberOfLines={1}>{item.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowTesting(false)} style={{ flex: 1 }} />
              <Button title="Confirm & Set Ready" onPress={async () => {
                setUpdating(true);
                try {
                  await repairTesting(repair.id, { checklist: testingChecklist, confirm: true });
                  setShowTesting(false);
                  await loadAll();
                  queryClient.invalidateQueries();
                } catch (e: any) {
                  Alert.alert('Testing Failed', e.message);
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
