import sys

with open('artifacts/mobile/app/(tabs)/repairs/new.tsx', 'r') as f:
    content = f.read()

target = """      const techId = user?.role === 'technician' ? user.id : undefined;
      const techName = user?.role === 'technician' ? user.name : undefined;

      const basePayload = {
        customerId, customerName: customerName.trim(), mobile: mobile.trim(),
        deviceType: deviceType.trim(), brand: brand.trim(), model: model.trim(),
        imei: imei.trim() || undefined,
        imei2: imei2.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        color: color.trim() || undefined,
        storage: storage.trim() || undefined,
        ram: ram.trim() || undefined,
        devicePassword: password.trim() || undefined,
        simPresent,
        memoryCardPresent,
        alternateMobile: alternateMobile.trim() || undefined,
        deviceCondition: deviceCondition.trim() || undefined,
        physicalCondition,
        accessories: otherAccessory.trim() || undefined,
        accessoriesList,
        problem: problem.trim(),
        technicianId: techId, technicianName: techName,
        status: 'received', priority: priority as Repair['priority'],"""

new_content = """      const basePayload = {
        customerId, customerName: customerName.trim(), mobile: mobile.trim(),
        deviceType: deviceType.trim(), brand: brand.trim(), model: model.trim(),
        imei: imei.trim() || undefined,
        imei2: imei2.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        color: color.trim() || undefined,
        storage: storage.trim() || undefined,
        ram: ram.trim() || undefined,
        devicePassword: password.trim() || undefined,
        simPresent,
        memoryCardPresent,
        alternateMobile: alternateMobile.trim() || undefined,
        deviceCondition: deviceCondition.trim() || undefined,
        physicalCondition,
        accessories: otherAccessory.trim() || undefined,
        accessoriesList,
        problem: problem.trim(),
        status: 'received', priority: priority as Repair['priority'],"""

content = content.replace(target, new_content)
with open('artifacts/mobile/app/(tabs)/repairs/new.tsx', 'w') as f:
    f.write(content)
