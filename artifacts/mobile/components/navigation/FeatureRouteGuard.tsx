import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { isDealerPortalRole } from '@/types';

export function FeatureRouteGuard({
  children,
  feature,
  excludeDealerPortal = false,
}: {
  children: React.ReactNode;
  feature: string;
  excludeDealerPortal?: boolean;
}) {
  const { user, canAccess } = useAuth();
  const blocked =
    (excludeDealerPortal && isDealerPortalRole(user?.role)) ||
    !canAccess(feature);

  if (blocked) return <Redirect href="/(tabs)/more" />;
  return <>{children}</>;
}