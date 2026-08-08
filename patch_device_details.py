import sys

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'r') as f:
    content = f.read()

target = """          <InfoRow label="Brand & Model" value={`${repair.brand} ${repair.model}`} bold />
          {repair.imei && <InfoRow label="IMEI" value={repair.imei} />}
          <InfoRow label="Alternate Mobile" value={repair.alternateMobile || 'N/A'} />
          <InfoRow label="Accessories" value={repair.accessories || 'None'} />
          {repair.deviceCondition && <InfoRow label="Device Condition" value={repair.deviceCondition} />}
          <InfoRow label="Received By" value={repair.receivedByName || 'System'} />"""

new_content = """          <InfoRow label="Brand & Model" value={`${repair.brand} ${repair.model}`} bold />
          <InfoRow label="Color / Storage / RAM" value={[repair.color, repair.storage, repair.ram].filter(Boolean).join(' · ') || 'N/A'} />
          {repair.imei && <InfoRow label="IMEI 1" value={repair.imei} />}
          {repair.imei2 && <InfoRow label="IMEI 2" value={repair.imei2} />}
          {repair.serialNumber && <InfoRow label="Serial No" value={repair.serialNumber} />}
          
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 4 }}>
            <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: repair.simPresent ? colors.primary + '22' : colors.card, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 11, color: repair.simPresent ? colors.primary : colors.mutedForeground }}>SIM: {repair.simPresent ? 'YES' : 'NO'}</Text>
            </View>
            <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: repair.memoryCardPresent ? colors.primary + '22' : colors.card, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 11, color: repair.memoryCardPresent ? colors.primary : colors.mutedForeground }}>SD Card: {repair.memoryCardPresent ? 'YES' : 'NO'}</Text>
            </View>
          </View>

          <InfoRow label="Alternate Mobile" value={repair.alternateMobile || 'N/A'} />
          <InfoRow label="Accessories" value={(repair.accessoriesList?.length ? repair.accessoriesList.join(', ') : 'None') + (repair.accessories ? ` (${repair.accessories})` : '')} />
          {repair.deviceCondition && <InfoRow label="Device Condition" value={repair.deviceCondition} />}
          <InfoRow label="Received By" value={repair.receivedByName || 'System'} />"""

content = content.replace(target, new_content)

# Add physical condition checklist
checklist_target = """          {repair.checklist && Object.keys(repair.checklist).length > 0 && ("""
new_checklist = """          {repair.physicalCondition && Object.keys(repair.physicalCondition).length > 0 && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Text style={[styles.problemTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 8 }]}>Physical Condition</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {Object.keys(repair.physicalCondition).map(k => (
                  <View key={k} style={[styles.checkBadge, { backgroundColor: repair.physicalCondition![k] ? colors.destructive + '15' : colors.card, borderColor: colors.border, borderWidth: 1 }]}>
                    {repair.physicalCondition![k] && <Feather name="alert-circle" size={12} color={colors.destructive} />}
                    <Text style={{ fontSize: 11, color: repair.physicalCondition![k] ? colors.destructive : colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>
                      {k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {repair.checklist && Object.keys(repair.checklist).length > 0 && ("""

content = content.replace(checklist_target, new_checklist)

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'w') as f:
    f.write(content)
