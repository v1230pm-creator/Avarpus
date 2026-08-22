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

  // Fail closed: redirect to the safe root tab rather than a potentially
  // invisible "More" tab (which is hidden for customer and dealer-portal roles).
  if (blocked) return <Redirect href="/(tabs)" />;
  return <>{children}</>;
}
