import sys

with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'r') as f:
    content = f.read()

target = """             <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
               <TouchableOpacity onPress={onPress} style={{ flex: 1, backgroundColor: colors.primary, paddingVertical: 6, borderRadius: 6, alignItems: 'center' }}>
                 <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>View / Hand Over</Text>
               </TouchableOpacity>
             </View>"""
             
new_content = """             <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
               <TouchableOpacity onPress={onPress} style={{ flex: 1, backgroundColor: colors.info, paddingVertical: 6, borderRadius: 6, alignItems: 'center' }}>
                 <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>Notify</Text>
               </TouchableOpacity>
               <TouchableOpacity onPress={onPress} style={{ flex: 1, backgroundColor: colors.warning, paddingVertical: 6, borderRadius: 6, alignItems: 'center' }}>
                 <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>Payment</Text>
               </TouchableOpacity>
               <TouchableOpacity onPress={onPress} style={{ flex: 1, backgroundColor: colors.primary, paddingVertical: 6, borderRadius: 6, alignItems: 'center' }}>
                 <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>Hand Over</Text>
               </TouchableOpacity>
             </View>"""

content = content.replace(target, new_content)
with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'w') as f:
    f.write(content)
