import React from 'react';
import { Stack, useSegments } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FeatureRouteGuard } from '@/components/navigation/FeatureRouteGuard';

/** Khata screens that need the `payments` feature — everything below the overview. */
const PAYMENTS_ONLY = ['payments'];
/** The overview also serves repairs-only staff as a money-free repair book. */
const OVERVIEW = ['payments', 'repairs'];

export default function KhataLayout() {
  const colors = useColors();
  const segments = useSegments();
  // Root-vs-child policy, mirroring canAccessTabsRoute: the overview is open
  // to anyone with `payments` or `repairs` (index.tsx picks the money-free
  // repair book for the latter); party ledgers, dealer books and transactions
  // require `payments`. Segments are global, so only judge them while Khata
  // itself is focused — this layout stays mounted behind the other tabs.
  // Typed as `string` on purpose: the router omits `index` from segments, but
  // the tabs boundary tolerates an explicit one, so this mirror does too.
  const child: string | undefined = segments[1] === 'khata' ? segments[2] : undefined;
  const atOverview = child === undefined || child === 'index';

  return (
    <FeatureRouteGuard anyFeature={atOverview ? OVERVIEW : PAYMENTS_ONLY} excludeDealerPortal>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="party/[type]/[id]" />
        <Stack.Screen name="dealer/[shopId]" />
        <Stack.Screen name="transaction" />
      </Stack>
    </FeatureRouteGuard>
  );
}
