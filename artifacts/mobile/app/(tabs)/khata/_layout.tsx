import React from 'react';
import { Stack } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FeatureRouteGuard } from '@/components/navigation/FeatureRouteGuard';

export default function KhataLayout() {
  const colors = useColors();
  return (
    <FeatureRouteGuard feature="payments" excludeDealerPortal>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="party/[type]/[id]" />
      </Stack>
    </FeatureRouteGuard>
  );
}
