with open('artifacts/mobile/app/(tabs)/repairs/_layout.tsx', 'r') as f:
    content = f.read()

content = content.replace(
'''      <Stack.Screen name="index" />''',
'''      <Stack.Screen name="index" />
      <Stack.Screen name="scanner" />'''
)

with open('artifacts/mobile/app/(tabs)/repairs/_layout.tsx', 'w') as f:
    f.write(content)
