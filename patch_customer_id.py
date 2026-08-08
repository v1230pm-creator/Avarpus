import sys

with open('artifacts/mobile/app/(tabs)/customers/[id].tsx', 'r') as f:
    content = f.read()

target = """          <Text style={[styles.mobile, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>{customer.mobile}</Text>"""
new_content = """          <Text style={[styles.mobile, { color: colors.primary, fontFamily: 'Inter_500Medium' }]}>{customer.mobile}</Text>
          {(customer as any).alternateMobile && (
            <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 }}>Alt: {(customer as any).alternateMobile}</Text>
          )}"""

content = content.replace(target, new_content)

with open('artifacts/mobile/app/(tabs)/customers/[id].tsx', 'w') as f:
    f.write(content)
