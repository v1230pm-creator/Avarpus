import sys

with open('artifacts/mobile/app/(tabs)/repairs/new.tsx', 'r') as f:
    content = f.read()

target = """        const created = await addCustomer({
          name: customerName.trim(), mobile: mobile.trim(),
          email: email.trim() || undefined,
          address: address.trim() || undefined,
        });"""

new_content = """        const created = await addCustomer({
          name: customerName.trim(), mobile: mobile.trim(),
          email: email.trim() || undefined,
          alternateMobile: alternateMobile.trim() || undefined,
          address: address.trim() || undefined,
        } as any);"""

content = content.replace(target, new_content)

with open('artifacts/mobile/app/(tabs)/repairs/new.tsx', 'w') as f:
    f.write(content)
