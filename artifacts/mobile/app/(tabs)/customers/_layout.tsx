import { Stack } from 'expo-router';
import { useColors } from '@/hooks/useColors';

export default function CustomersLayout() {
  const colors = useColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="chat" />
    </Stack>
  );
}
