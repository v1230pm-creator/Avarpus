import sys

with open('artifacts/mobile/app/(tabs)/repairs/new.tsx', 'r') as f:
    content = f.read()

bad_payload = """        const apiPayload = {
          customerId: newRepair.customerId || undefined,
          customerName: newRepair.customerName,
          mobile: newRepair.mobile,
          deviceType: newRepair.deviceType,
          brand: newRepair.brand,
          model: newRepair.model,
          imei: newRepair.imei,
          imei2: newRepair.imei2,
          serialNumber: newRepair.serialNumber,
          color: newRepair.color,
          storage: newRepair.storage,
          ram: newRepair.ram,
          simPresent: newRepair.simPresent,
          memoryCardPresent: newRepair.memoryCardPresent,
          devicePassword: newRepair.devicePassword,
          deviceCondition: newRepair.deviceCondition,
          physicalCondition: newRepair.physicalCondition,
          accessories: newRepair.accessories,
          accessoriesList: newRepair.accessoriesList,
          problem: newRepair.problem,
          priority: newRepair.priority,
          repairCharge: newRepair.repairCharge,
          status: newRepair.status,
          expectedDate: newRepair.expectedDate || new Date().toISOString(),
          // Ignore advance - handled via payments now if possible, or legacy fallback
        };"""

good_payload = """        const apiPayload = {
          customerId: newRepair.customerId || undefined,
          customerName: newRepair.customerName,
          mobile: newRepair.mobile,
          deviceType: newRepair.deviceType,
          brand: newRepair.brand,
          model: newRepair.model,
          imei: newRepair.imei,
          imei2: newRepair.imei2,
          serialNumber: newRepair.serialNumber,
          color: newRepair.color,
          storage: newRepair.storage,
          ram: newRepair.ram,
          devicePassword: newRepair.devicePassword,
          simPresent: newRepair.simPresent,
          memoryCardPresent: newRepair.memoryCardPresent,
          alternateMobile: newRepair.alternateMobile,
          accessories: newRepair.accessories,
          accessoriesList: newRepair.accessoriesList,
          physicalCondition: newRepair.physicalCondition,
          deviceCondition: newRepair.deviceCondition,
          problem: newRepair.problem,
          priority: newRepair.priority,
          repairCharge: newRepair.repairCharge,
          expectedDate: newRepair.expectedDate || new Date().toISOString(),
        };"""

content = content.replace(bad_payload, good_payload)

bad_payload2 = """          const apiPayload = {
            customerId: newRepair.customerId || undefined,
            customerName: newRepair.customerName,
            mobile: newRepair.mobile,
            deviceType: newRepair.deviceType,
            brand: newRepair.brand,
            model: newRepair.model,
            imei: newRepair.imei,
            imei2: newRepair.imei2,
            serialNumber: newRepair.serialNumber,
            color: newRepair.color,
            storage: newRepair.storage,
            ram: newRepair.ram,
            simPresent: newRepair.simPresent,
            memoryCardPresent: newRepair.memoryCardPresent,
            devicePassword: newRepair.devicePassword,
            deviceCondition: newRepair.deviceCondition,
            physicalCondition: newRepair.physicalCondition,
            accessories: newRepair.accessories,
            accessoriesList: newRepair.accessoriesList,
            problem: newRepair.problem,
            priority: newRepair.priority,
            repairCharge: newRepair.repairCharge,
            status: newRepair.status,
            expectedDate: newRepair.expectedDate || new Date().toISOString(),
          };"""

content = content.replace(bad_payload2, good_payload)

with open('artifacts/mobile/app/(tabs)/repairs/new.tsx', 'w') as f:
    f.write(content)
