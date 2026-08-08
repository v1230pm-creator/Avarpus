import sys

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'r') as f:
    content = f.read()

target = """          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>SERVICE DETAILS</Text>
            {repair.status !== 'delivered' && repair.status !== 'cancelled' && ("""
            
new_content = """          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>SERVICE DETAILS</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {(user?.role === 'dealer' || user?.role === 'super_admin') && repair.status !== 'delivered' && repair.status !== 'cancelled' && (
                <TouchableOpacity onPress={() => setShowAssign(true)}>
                  <Feather name="user-plus" size={16} color={colors.primary} />
                </TouchableOpacity>
              )}
              {repair.status !== 'delivered' && repair.status !== 'cancelled' && ("""

content = content.replace(target, new_content)

modal_target = "{/* Signatures */}"
modal_content = """
      {/* Assign Technician Modal */}
      <Modal visible={showAssign} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Assign Technician</Text>
            
            <ScrollView style={{ maxHeight: 300 }}>
              {technicians.map(tech => (
                <TouchableOpacity key={tech.id} onPress={async () => {
                  setUpdating(true);
                  try {
                    await repairAssignTechnician(repair.id, { technicianId: tech.id });
                    setShowAssign(false);
                    await loadAll();
                    queryClient.invalidateQueries();
                  } catch(e: any) { Alert.alert('Error', e.message); }
                  finally { setUpdating(false); }
                }} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.foreground, fontSize: 15 }}>{tech.name}</Text>
                  {repair.technicianId === tech.id && <Feather name="check" size={16} color={colors.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Button title="Cancel" variant="outline" onPress={() => setShowAssign(false)} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
"""

content = content.replace(modal_target, modal_content + modal_target)

tech_info = """          <Text style={[styles.problemTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginTop: 10 }]}>Problem Reported</Text>"""
tech_new = """          {repair.technicianId && (
            <View style={{ marginBottom: 12, padding: 12, backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Assigned Technician</Text>
              <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_500Medium' }}>{repair.technicianName}</Text>
              {repair.assignedByName && (
                <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 2 }}>Assigned by {repair.assignedByName} on {repair.assignedAt ? formatDate(repair.assignedAt) : ''}</Text>
              )}
            </View>
          )}
          
          <Text style={[styles.problemTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginTop: 10 }]}>Problem Reported</Text>"""

content = content.replace(tech_info, tech_new)

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'w') as f:
    f.write(content)
