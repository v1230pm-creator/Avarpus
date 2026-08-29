import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { Redirect, useSegments } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { isDealerPortalRole, isCustomerRole } from '@/types';
import { useColors } from '@/hooks/useColors';
import { isLockEnabled, isUnlocked, subscribeLockState } from '@/utils/appLock';
import { InactivityGuard } from '@/components/InactivityGuard';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { canCustomerAccessTabsRoute, canPortalAccessTabsRoute } from '@/utils/tabRouteAccess';

function NativeTabLayout({ portal, customer }: { portal: boolean; customer: boolean }) {
  const { canAccess } = useAuth();
  // Customer role: only Chats (chat inbox) is visible.
  // Dealer-portal accounts only get Repairs (their read-only "My Repairs"
  // view). Staff tabs additionally honor the
  // shop's per-role feature toggles (More → Staff Permissions).
  return (
    <NativeTabs>
      {!portal && (
        <NativeTabs.Trigger name="index">
          <Icon sf={{ default: 'message', selected: 'message.fill' }} />
          <Label>Chats</Label>
        </NativeTabs.Trigger>
      )}
      {!customer && (portal ? canAccess('repairs_portal') : canAccess('repairs')) && (
        <NativeTabs.Trigger name="repairs">
          <Icon sf={{ default: 'wrench', selected: 'wrench.fill' }} />
          <Label>Repairs</Label>
        </NativeTabs.Trigger>
      )}
      {!customer && !portal && canAccess('customers') && (
        <NativeTabs.Trigger name="customers">
          <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
          <Label>Customers</Label>
        </NativeTabs.Trigger>
      )}
      {!customer && !portal && canAccess('payments') && (
        <NativeTabs.Trigger name="khata">
          <Icon sf={{ default: 'book.closed', selected: 'book.closed.fill' }} />
          <Label>Khata</Label>
        </NativeTabs.Trigger>
      )}
    </NativeTabs>
  );
}

function ClassicTabLayout({ portal, customer }: { portal: boolean; customer: boolean }) {
  const colors = useColors();
  const { canAccess } = useAuth();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84, paddingBottom: 34 } : {}),
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          href: portal ? null : undefined,
          title: 'Chats',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="message" tintColor={color} size={22} />
            ) : (
              <Feather name="message-circle" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="repairs"
        options={{
          href: customer || !(portal ? canAccess('repairs_portal') : canAccess('repairs')) ? null : undefined,
          title: 'Repairs',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="wrench" tintColor={color} size={22} />
            ) : (
              <Feather name="tool" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          href: customer || portal || !canAccess('customers') ? null : undefined,
          title: 'Customers',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.2" tintColor={color} size={22} />
            ) : (
              <Feather name="users" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="khata"
        options={{
          href: customer || portal || !canAccess('payments') ? null : undefined,
          title: 'Khata',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="book.closed" tintColor={color} size={22} />
            ) : (
              <Feather name="book" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          href: null,
          title: 'Inventory',
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          href: null,
          title: 'More',
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const { isAuthenticated, isLoading, user } = useAuth();
  const portal = isDealerPortalRole(user?.role);
  const customer = isCustomerRole(user?.role);
  const segments = useSegments();
  const [lockCheck, setLockCheck] = useState<'pending' | 'locked' | 'open'>(
    isUnlocked() ? 'open' : 'pending',
  );

  useEffect(() => {
    if (isUnlocked()) return;
    let active = true;
    (async () => {
      try {
        const locked = (await isLockEnabled()) && !isUnlocked();
        if (active) setLockCheck(locked ? 'locked' : 'open');
      } catch {
        // Fail closed: if lock configuration can't be read, require unlocking.
        if (active) setLockCheck('locked');
      }
    })();
    return () => { active = false; };
  }, []);

  // React to lock-state changes while mounted: re-locking (e.g. after an
  // inactivity timeout) must immediately block the tabs again.
  useEffect(() => {
    const unsubscribe = subscribeLockState((unlockedNow) => {
      if (unlockedNow) {
        setLockCheck('open');
        return;
      }
      // Fail closed while re-reading lock config
      setLockCheck('locked');
      isLockEnabled()
        .then((enabled) => setLockCheck(enabled ? 'locked' : 'open'))
        .catch(() => setLockCheck('locked'));
    });
    return unsubscribe;
  }, []);

  // If auth state clears while inside the tabs (e.g. this device's session
  // was revoked and an API call came back 401), route back to sign-in.
  if (!isLoading && !isAuthenticated) {
    return <Redirect href="/(auth)" />;
  }

  // A hidden tab is not an authorization boundary. Restricted accounts may
  // enter their primary area, direct-chat rooms, and the compact account menu
  // including chat notifications. Other business routes fail closed here.
  if (customer && !canCustomerAccessTabsRoute(segments)) {
    return <Redirect href="/(tabs)" />;
  }
  if (portal && !canPortalAccessTabsRoute(segments)) {
    return <Redirect href="/(tabs)" />;
  }

  if (lockCheck === 'pending') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (lockCheck === 'locked') {
    return <Redirect href="/(auth)/biometric" />;
  }

  return (
    <InactivityGuard>
      {isLiquidGlassAvailable() ? <NativeTabLayout portal={portal} customer={customer} /> : <ClassicTabLayout portal={portal} customer={customer} />}
    </InactivityGuard>
  );
}
