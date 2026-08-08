import sys

with open('artifacts/mobile/app/(tabs)/repairs/new.tsx', 'r') as f:
    content = f.read()

import_target = "import { formatDate, getReturnStatusColor } from '@/utils/helpers';"
import_new = """import { formatDate, getReturnStatusColor, generateUUID } from '@/utils/helpers';
import * as Network from 'expo-network';
import { offlineQueue } from '@/utils/offlineQueue';"""

content = content.replace(import_target, import_new)

submit_target = """      const repair = await addRepair(newRepair);

      let sigPath;
      if (receivingSignatureUri) {
        sigPath = await uploadToGcs(receivingSignatureUri, 'image/png');
        if (sigPath) {
          await updateRepair({ ...repair, receivingSignaturePath: sigPath });
        }
      }

      if (repairId) {
        Alert.alert('Update Successful', `Repair updated successfully.`);
        router.back();
      } else {
        Alert.alert('Success', `Repair saved successfully.\nTicket: ${repair.repairId}`);
        router.push('/repairs');
      }
    } catch (e: any) {
      Alert.alert('Save Failed', e.message || 'Check your network connection.');
    } finally {
      setLoading(false);
    }
  };"""

submit_new = """      // Network check
      const net = await Network.getNetworkStateAsync();
      const isOnline = net.isConnected && net.isInternetReachable !== false;

      let repair;
      if (!isOnline && !repairId) {
        const clientRequestId = generateUUID();
        
        // Map to API payload
        const apiPayload = {
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
        };
        
        await offlineQueue.add(apiPayload, clientRequestId);
        Alert.alert('Saved Offline', 'The repair was saved offline and will sync automatically when network is available.\n\nPhotos and signatures will need to be re-added after sync.');
        router.push('/repairs');
        return;
      }

      try {
        repair = await addRepair(newRepair);
      } catch (addError: any) {
        // Fallback for network issues during request
        if (!repairId && addError.message && (addError.message.includes('Network request failed') || addError.message.includes('fetch'))) {
          const clientRequestId = generateUUID();
          const apiPayload = {
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
          };
          await offlineQueue.add(apiPayload, clientRequestId);
          Alert.alert('Saved Offline', 'Network request failed. The repair was saved offline and will sync automatically when network is available.\n\nPhotos and signatures will need to be re-added after sync.');
          router.push('/repairs');
          return;
        }
        throw addError;
      }

      let sigPath;
      if (receivingSignatureUri) {
        sigPath = await uploadToGcs(receivingSignatureUri, 'image/png');
        if (sigPath) {
          await updateRepair({ ...repair, receivingSignaturePath: sigPath });
        }
      }

      if (repairId) {
        Alert.alert('Update Successful', `Repair updated successfully.`);
        router.back();
      } else {
        Alert.alert('Success', `Repair saved successfully.\\nTicket: ${repair.repairId}`);
        router.push('/repairs');
      }
    } catch (e: any) {
      Alert.alert('Save Failed', e.message || 'Check your network connection.');
    } finally {
      setLoading(false);
    }
  };"""

content = content.replace(submit_target, submit_new)

with open('artifacts/mobile/app/(tabs)/repairs/new.tsx', 'w') as f:
    f.write(content)
