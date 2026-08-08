import sys

with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'r') as f:
    content = f.read()

old_status = """      await updateRepair({
        ...repair,
        status: newStatus as RepairStatus,
      });
      setShowStatusPicker(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Update failed', e.message || "Couldn't update the repair status.");
    } finally {"""

new_status = """      await updateRepair({
        ...repair,
        status: newStatus as RepairStatus,
      });
      setShowStatusPicker(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      if (e?.code === 'TESTING_REQUIRED' || e?.message?.includes('TESTING_REQUIRED')) {
        setShowStatusPicker(false);
        setTimeout(() => setShowTesting(true), 350);
      } else {
        Alert.alert('Update failed', e.message || "Couldn't update the repair status.");
      }
    } finally {"""

content = content.replace(old_status, new_status)
with open('artifacts/mobile/app/(tabs)/repairs/[id].tsx', 'w') as f:
    f.write(content)
