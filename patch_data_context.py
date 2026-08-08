with open('artifacts/mobile/context/DataContext.tsx', 'r') as f:
    content = f.read()

content = content.replace(
'''    const res = await customersCreate({
      name: c.name,
      mobile: c.mobile,
      email: c.email,
      address: c.address,
    });''',
'''    const res = await customersCreate({
      name: c.name,
      mobile: c.mobile,
      alternateMobile: (c as any).alternateMobile,
      email: c.email,
      address: c.address,
    } as any);'''
)

content = content.replace(
'''    const res = await customersUpdate(c.id, {
      name: c.name,
      mobile: c.mobile,
      email: c.email,
      address: c.address,
    });''',
'''    const res = await customersUpdate(c.id, {
      name: c.name,
      mobile: c.mobile,
      alternateMobile: (c as any).alternateMobile,
      email: c.email,
      address: c.address,
    } as any);'''
)

with open('artifacts/mobile/context/DataContext.tsx', 'w') as f:
    f.write(content)
