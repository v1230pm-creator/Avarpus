import React, { useEffect } from 'react';
import { Redirect, Slot, useNavigation } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { isDealerPortalRole, isCustomerRole } from '@/types';

export default function ChatLayout() {
  const { user, canAccess } = useAuth();
  const navigation = useNavigation();

  useEffect(() => {
    // Chat is a focused, full-screen conversation. The Customers tab stays
    // selected in navigation state, but its tab bar must not occupy chat space.
    let currentNavigation: any = navigation;
    let tabsNavigation: any = null;
    while (currentNavigation) {
      if (currentNavigation.getState?.()?.type === 'tab') {
        tabsNavigation = currentNavigation;
        break;
      }
      currentNavigation = currentNavigation.getParent?.();
    }
    tabsNavigation?.setOptions({ tabBarStyle: { display: 'none' } });

    return () => {
      tabsNavigation?.setOptions({ tabBarStyle: undefined });
    };
  }, [navigation]);

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
