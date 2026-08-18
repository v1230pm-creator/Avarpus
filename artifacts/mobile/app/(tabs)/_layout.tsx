import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { isDealerPortalRole } from '@/types';
import { useColors } from '@/hooks/useColors';
import { isLockEnabled, isUnlocked, subscribeLockState } from '@/utils/appLock';
import { InactivityGuard } from '@/components/InactivityGuard';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';

function NativeTabLayout({ portal }: { portal: boolean }) {
  const { canAccess } = useAuth();
  // Dealer-portal accounts only get Repairs (their read-only "My Repairs"
  // view) and More (profile/sign-out). Staff tabs additionally honor the
  // shop's per-role feature toggles (More → Staff Permissions).
  return (
    <NativeTabs>
      {!portal && (
        <NativeTabs.Trigger name="index">
          <Icon sf={{ default: 'house', selected: 'house.fill' }} />
          <Label>Dashboard</Label>
        </NativeTabs.Trigger>
      )}
      {(portal ? canAccess('repairs_portal') : canAccess('repairs')) && (
        <NativeTabs.Trigger name="repairs">
          <Icon sf={{ default: 'wrench', selected: 'wrench.fill' }} />
          <Label>Repairs</Label>
        </NativeTabs.Trigger>
      )}
      {!portal && canAccess('customers') && (
        <NativeTabs.Trigger name="customers">
          <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
          <Label>Customers</Label>
        </NativeTabs.Trigger>
      )}
      {!portal && canAccess('inventory') && (
        <NativeTabs.Trigger name="inventory">
          <Icon sf={{ default: 'shippingbox', selected: 'shippingbox.fill' }} />
          <Label>Inventory</Label>
        </NativeTabs.Trigger>
      )}
      <NativeTabs.Trigger name="more">
        <Icon sf={{ default: 'ellipsis.circle', selected: 'ellipsis.circle.fill' }} />
        <Label>More</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout({ portal }: { portal: boolean }) {
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
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.glassNav,
          borderTopWidth: 1,
          borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84, paddingBottom: 34 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassNav, ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' } as any) : {}) }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          href: portal ? null : undefined,
          title: 'Dashboard',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={22} />
            ) : (
              <Feather name="home" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="repairs"
        options={{
          href: (portal ? canAccess('repairs_portal') : canAccess('repairs')) ? undefined : null,
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
          href: portal || !canAccess('customers') ? null : undefined,
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
        name="inventory"
        options={{
          href: portal || !canAccess('inventory') ? null : undefined,
          title: 'Inventory',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="shippingbox" tintColor={color} size={22} />
            ) : (
              <Feather name="package" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="ellipsis.circle" tintColor={color} size={22} />
            ) : (
              <Feather name="menu" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const { isAuthenticated, isLoading, user } = useAuth();
  const portal = isDealerPortalRole(user?.role);
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
      {isLiquidGlassAvailable() ? <NativeTabLayout portal={portal} /> : <ClassicTabLayout portal={portal} />}
    </InactivityGuard>
  );
}
