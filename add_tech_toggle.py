import sys

with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'r') as f:
    content = f.read()

state_target = """  const [showCancelled, setShowCancelled] = useState(false);"""
state_new = """  const [showCancelled, setShowCancelled] = useState(false);
  const [techOnly, setTechOnly] = useState(true);"""

content = content.replace(state_target, state_new)

effect_target = """  React.useEffect(() => {
    setPage(1);
  }, [filter, debouncedSearch, showCancelled]);"""
effect_new = """  React.useEffect(() => {
    setPage(1);
  }, [filter, debouncedSearch, showCancelled, techOnly]);"""

content = content.replace(effect_target, effect_new)

param_target = """  if (user?.role === 'technician') {
    repairsParams.technicianId = 'me';
  }"""
param_new = """  if (user?.role === 'technician' && techOnly) {
    repairsParams.technicianId = 'me';
  }"""

content = content.replace(param_target, param_new)

ui_target = """        {filter === 'Delivered' && ("""
ui_new = """        {user?.role === 'technician' && (
          <TouchableOpacity onPress={() => setTechOnly(!techOnly)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: colors.primary, backgroundColor: techOnly ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {techOnly && <Feather name="check" size={12} color="#FFF" />}
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>Assigned to me only</Text>
          </TouchableOpacity>
        )}
        {filter === 'Delivered' && ("""

content = content.replace(ui_target, ui_new)

with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'w') as f:
    f.write(content)
