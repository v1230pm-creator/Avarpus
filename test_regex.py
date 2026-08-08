import sys
import re

with open('artifacts/mobile/app/(tabs)/index.tsx', 'r') as f:
    content = f.read()

# find exactly where export default function DashboardScreen() starts and useStaggerAnim(8) is.
start_idx = content.find("export default function DashboardScreen() {")
end_idx = content.find("const anims = useStaggerAnim(8);")

if start_idx != -1 and end_idx != -1:
    old_block = content[start_idx:end_idx]
    print(old_block[:500])
else:
    print("Not found")

