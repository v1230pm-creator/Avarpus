import sys

with open('artifacts/mobile/context/DataContext.tsx', 'r') as f:
    content = f.read()

target = """    const res = await repairsCreate({
      customerId: r.customerId || undefined,
      customerName: r.customerName,"""
new = """    const res = await repairsCreate({
      clientRequestId: (r as any).clientRequestId,
      customerId: r.customerId || undefined,
      customerName: r.customerName,"""
content = content.replace(target, new)
with open('artifacts/mobile/context/DataContext.tsx', 'w') as f:
    f.write(content)
