import { Stack } from 'expo-router';
import { useColors } from '@/hooks/useColors';

export default function MoreLayout() {
  const colors = useColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="finance" />
      <Stack.Screen name="staff" />
      <Stack.Screen name="staff-add" />
      <Stack.Screen name="staff-edit" />
      <Stack.Screen name="reports" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="permissions" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="security" />
      <Stack.Screen name="purchases" />
      <Stack.Screen name="approvals" />
      <Stack.Screen name="app-update" />
      <Stack.Screen name="update-manager" />
    </Stack>
  );
}
