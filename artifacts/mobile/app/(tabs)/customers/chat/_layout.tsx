import React from 'react';
import { Slot } from 'expo-router';
import { FeatureRouteGuard } from '@/components/navigation/FeatureRouteGuard';

export default function ChatLayout() {
  return (
    <FeatureRouteGuard feature="customers" excludeDealerPortal>
      <Slot />
    </FeatureRouteGuard>
  );
}