import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { isDealerPortalRole } from '@/types';

export function FeatureRouteGuard({
  children,
  feature,
  anyFeature,
  excludeDealerPortal = false,
}: {
  children: React.ReactNode;
  feature?: string;
  anyFeature?: string[];
  excludeDealerPortal?: boolean;
}) {
  const { user, canAccess } = useAuth();
  const hasAccess = anyFeature?.length
    ? anyFeature.some((candidate) => canAccess(candidate))
    : !!feature && canAccess(feature);
  const blocked =
    (excludeDealerPortal && isDealerPortalRole(user?.role)) ||
    !hasAccess;

  // Fail closed: redirect to the safe root tab rather than a potentially
  // invisible "More" tab (which is hidden for customer and dealer-portal roles).
  if (blocked) return <Redirect href="/(tabs)" />;
  return <>{children}</>;
}
