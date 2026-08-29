import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';

export default function AuthLayout() {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#010714" translucent={false} />
      <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: '#010714' } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="terms" options={{ animation: 'fade' }} />
        <Stack.Screen name="phone" options={{ animation: 'fade' }} />
        <Stack.Screen name="otp" options={{ animation: 'fade' }} />
        <Stack.Screen name="register" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="biometric" options={{ animation: 'fade' }} />
        <Stack.Screen name="activate" options={{ animation: 'slide_from_right' }} />
      </Stack>
    </>
  );
}
