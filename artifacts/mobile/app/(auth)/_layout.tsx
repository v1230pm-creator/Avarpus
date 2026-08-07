import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="otp" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="register" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="biometric" options={{ animation: 'fade' }} />
      <Stack.Screen name="forgot" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}
