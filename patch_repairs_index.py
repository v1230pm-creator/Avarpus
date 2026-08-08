import sys

with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'r') as f:
    content = f.read()

target = """          <View style={{ flexDirection: 'row', gap: 8 }}>
            {canCreateRepair && (
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/repairs/new')}
                activeOpacity={0.85}
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
              >
                <Feather name="plus" size={18} color="#FFFFFF" />
                <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>New</Text>
              </TouchableOpacity>
            )}
          </View>"""
new_content = """          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/repairs/scanner')}
              activeOpacity={0.85}
              style={[styles.addBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
            >
              <Feather name="maximize" size={18} color={colors.foreground} />
            </TouchableOpacity>
            {canCreateRepair && (
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/repairs/new')}
                activeOpacity={0.85}
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
              >
                <Feather name="plus" size={18} color="#FFFFFF" />
                <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>New</Text>
              </TouchableOpacity>
            )}
          </View>"""

content = content.replace(target, new_content)
with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'w') as f:
    f.write(content)
