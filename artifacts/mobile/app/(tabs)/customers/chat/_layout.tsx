import React from 'react';
import { Redirect, Slot } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { isDealerPortalRole, isCustomerRole } from '@/types';

export default function ChatLayout() {
  const { user, canAccess } = useAuth();

  // Customer role and dealer-portal roles are explicitly allowed into chat.
  // Staff roles need the customers feature enabled.
  const isCustomer = isCustomerRole(user?.role);
  const isPortal = isDealerPortalRole(user?.role);

  if (isCustomer || isPortal) {
    // These roles are allowed into chat rooms but must not reach Customers list.
    return <Slot />;
  }

  // Staff roles: require the customers feature toggle.
  if (!canAccess('customers')) {
    return <Redirect href="/(tabs)" />;
  }

  return <Slot />;
}
