import sys

with open('artifacts/mobile/app/(tabs)/repairs/new.tsx', 'r') as f:
    content = f.read()

submit_target = """      const newRepair: Repair = {
        id: '', repairId: '',
        ...basePayload,
        receiveDate: receiveDate.trim(),
        createdAt: new Date().toISOString(),
      } as Repair;

      const repair = await addRepair(newRepair);

      let sigPath;
      if (receivingSignatureUri) {
        sigPath = await uploadToGcs(receivingSignatureUri, 'image/png');
        if (sigPath) {
          await updateRepair({ ...repair, receivingSignaturePath: sigPath });
        }
      }

      for (const p of photos) {
        const path = await uploadToGcs(p.uri, 'image/jpeg');
        if (path) {
          await repairPhotosAdd(repair.id, { kind: p.kind as any, objectPath: path });
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCreatedRepair(repair);
    } catch (err: any) {"""

submit_new = """      const newRepair: Repair = {
        id: '', repairId: '',
        ...basePayload,
        receiveDate: receiveDate.trim(),
        createdAt: new Date().toISOString(),
      } as Repair;

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
      };

      const net = await Network.getNetworkStateAsync();
      const isOnline = net.isConnected && net.isInternetReachable !== false;
      const clientRequestId = generateUUID();

      if (!isOnline) {
        await offlineQueue.add(apiPayload, clientRequestId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Saved Offline', 'The repair was saved offline and will sync automatically when network is available.\\n\\nPhotos and signatures will need to be re-added after sync.', [
          { text: 'OK', onPress: () => router.push('/repairs') }
        ]);
        return;
      }

      let repair;
      try {
        repair = await addRepair({ ...newRepair, clientRequestId } as any);
      } catch (addError: any) {
        if (addError.message && (addError.message.includes('Network request failed') || addError.message.includes('fetch'))) {
          await offlineQueue.add(apiPayload, clientRequestId);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Saved Offline', 'Network request failed. The repair was saved offline and will sync automatically when network is available.\\n\\nPhotos and signatures will need to be re-added after sync.', [
            { text: 'OK', onPress: () => router.push('/repairs') }
          ]);
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

      for (const p of photos) {
        const path = await uploadToGcs(p.uri, 'image/jpeg');
        if (path) {
          await repairPhotosAdd(repair.id, { kind: p.kind as any, objectPath: path });
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCreatedRepair(repair);
    } catch (err: any) {"""

content = content.replace(submit_target, submit_new)
with open('artifacts/mobile/app/(tabs)/repairs/new.tsx', 'w') as f:
    f.write(content)
