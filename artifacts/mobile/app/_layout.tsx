import React from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BackgroundRelock } from '@/components/BackgroundRelock';
import { KeyboardProviderCompat } from '@/components/KeyboardProviderCompat';
import { PrivacyShield } from '@/components/PrivacyShield';
import { PushNotificationsBridge } from '@/components/PushNotificationsBridge';
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  setAuthTokenGetter,
  setBaseUrl,
  setBaseUrlFallbacks,
} from '@workspace/api-client-react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { DataProvider } from '@/context/DataContext';
import { storage, KEYS } from '@/utils/storage';
import { AVARPUS_BLUE } from '@/constants/brand';

setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
// An installed build cannot be re-pointed at a new server. If the primary
// domain ever stops resolving, the app falls back to the deployment's own
// address instead of failing every sign-in until users reinstall.
const fallbackDomain = process.env.EXPO_PUBLIC_FALLBACK_DOMAIN;
setBaseUrlFallbacks(
  fallbackDomain && fallbackDomain !== process.env.EXPO_PUBLIC_DOMAIN
    ? [`https://${fallbackDomain}`]
    : [],
);
setAuthTokenGetter(() => storage.get<string>(KEYS.AUTH_TOKEN));

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav({ dark }: { dark: boolean }) {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Without this the native stack falls back to its own light surface,
        // which flashes through while the splash fades out and between screen
        // transitions. Binding it to the theme keeps opening seamless.
        contentStyle: { backgroundColor: AVARPUS_BLUE },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

function IdentityBoundDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <DataProvider key={user?.id ?? 'signed-out'}>{children}</DataProvider>;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={dark ? 'light-content' : 'dark-content'}
        backgroundColor={AVARPUS_BLUE}
        translucent={false}
      />
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider queryClient={queryClient}>
            <IdentityBoundDataProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProviderCompat>
                  <BackgroundRelock>
                    <ConfirmDialogProvider>
                      <RootLayoutNav dark={dark} />
                      <PushNotificationsBridge />
                    </ConfirmDialogProvider>
                    <PrivacyShield />
                  </BackgroundRelock>
                </KeyboardProviderCompat>
              </GestureHandlerRootView>
            </IdentityBoundDataProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
