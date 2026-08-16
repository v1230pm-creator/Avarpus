import { Stack } from 'expo-router';
import { useColors } from '@/hooks/useColors';

export default function RepairsLayout() {
  const colors = useColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="scanner" />
      <Stack.Screen name="new" />
      <Stack.Screen name="returns" />
      <Stack.Screen name="return/new" />
      <Stack.Screen name="return/[id]" />
      <Stack.Screen name="dealer-new" />
      <Stack.Screen name="dealer/[id]" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
