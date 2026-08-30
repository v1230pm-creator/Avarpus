import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Redirect, useSegments } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { isDealerPortalRole, isCustomerRole } from '@/types';
import { useColors } from '@/hooks/useColors';
import { isLockEnabled, isUnlocked, subscribeLockState } from '@/utils/appLock';
import { InactivityGuard } from '@/components/InactivityGuard';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { canCustomerAccessTabsRoute, canPortalAccessTabsRoute } from '@/utils/tabRouteAccess';
import {
  getPrimaryTabsHomeRoute,
  getVisiblePrimaryTabs,
  type PrimaryTabName,
} from '@/utils/tabVisibility';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MAIN_TABS: Array<{
  name: PrimaryTabName;
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
}> = [
  { name: 'index', label: 'Chats', icon: 'message-circle' as const },
  { name: 'calls', label: 'Calls', icon: 'phone' as const },
  { name: 'repairs', label: 'Repairs', icon: 'tool' as const },
  { name: 'customers', label: 'Customers', icon: 'users' as const },
  { name: 'khata', label: 'Khata', icon: 'book-open' as const },
  { name: 'updates', label: 'Updates', icon: 'bell' as const },
  { name: 'settings', label: 'Settings', icon: 'settings' as const },
];

function PremiumTabBar({
  state,
  descriptors,
  navigation,
  tabs,
}: {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  descriptors: Record<string, { options: { href?: string | null; tabBarStyle?: unknown } }>;
  navigation: { navigate: (name: string) => void };
  tabs: typeof MAIN_TABS;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'web' ? 20 : Math.max(insets.bottom, 8);
  const currentOptions = descriptors[state.routes[state.index]?.key]?.options;
  const tabBarStyle = currentOptions?.tabBarStyle as any;
  if (tabBarStyle?.display === 'none') return null;

  return (
    <View
      style={[
        styles.tabBar,
        {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: bottomInset,
          minHeight: 62 + bottomInset,
        },
        tabBarStyle,
      ]}
    >
      {tabs.map((tab) => {
        const routeIndex = state.routes.findIndex((route) => route.name === tab.name);
        if (routeIndex < 0) return null;
        const routeOptions = descriptors[state.routes[routeIndex].key]?.options;
        if (routeOptions?.href === null) return null;
        const focused = state.index === routeIndex;
        
        const isKhata = tab.name === 'khata';
        const activeColor = isKhata ? colors.goldActive : colors.primary;
        const activeBg = isKhata ? `${colors.gold}15` : colors.accent;
        const activeBorder = isKhata ? colors.gold : 'transparent';
        
        return (
          <TouchableOpacity
            key={tab.name}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={tab.label}
            onPress={() => navigation.navigate(tab.name)}
            style={styles.tabItem}
            activeOpacity={0.8}
          >
            <View
              style={[
                styles.tabIconWrap,
                focused && { backgroundColor: activeBg },
                focused && isKhata && { borderWidth: 1, borderColor: activeBorder },
              ]}
            >
              <Feather
                name={tab.icon}
                size={19}
                color={focused ? activeColor : colors.mutedForeground}
              />
            </View>
            <Text
              style={[
                styles.tabLabel,
                {
                  color: focused ? activeColor : colors.mutedForeground,
                  fontFamily: focused ? 'Inter_600SemiBold' : 'Inter_500Medium',
                },
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ClassicTabLayout({ portal, customer }: { portal: boolean; customer: boolean }) {
  const colors = useColors();
  const { canAccess } = useAuth();
  const isWeb = Platform.OS === 'web';
  const visibleTabNames = getVisiblePrimaryTabs({ customer, portal, canAccess });
  const visibleTabs = MAIN_TABS.filter((tab) => visibleTabNames.includes(tab.name));

  return (
    <Tabs
      tabBar={(props) => <PremiumTabBar {...props} tabs={visibleTabs} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: isWeb ? { height: 84 } : undefined,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          href: undefined,
          title: 'Chats',
        }}
      />
      <Tabs.Screen name="calls" options={{ href: customer || portal ? null : undefined, title: 'Calls' }} />
      <Tabs.Screen
        name="repairs"
        options={{
          href: customer || !(portal ? canAccess('repairs_portal') : canAccess('repairs')) ? null : undefined,
          title: 'Repairs',
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          href: customer || portal || !canAccess('customers') ? null : undefined,
          title: 'Customers',
        }}
      />
      <Tabs.Screen
        name="khata"
        options={{
          href: customer || portal || !canAccess('payments') ? null : undefined,
          title: 'Khata',
        }}
      />
      <Tabs.Screen name="updates" options={{ href: customer || portal ? null : undefined, title: 'Updates' }} />
      <Tabs.Screen name="settings" options={{ href: customer || portal ? null : undefined, title: 'Settings' }} />
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
  const { isAuthenticated, isLoading, user, canAccess } = useAuth();
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
  const primaryRoute = getPrimaryTabsHomeRoute({ portal, canAccess });
  if (portal && segments[1] === undefined && primaryRoute !== '/(tabs)') {
    return <Redirect href={primaryRoute} />;
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

  return <InactivityGuard><ClassicTabLayout portal={portal} customer={customer} /></InactivityGuard>;
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    paddingTop: 6,
    borderTopWidth: 1,
    elevation: 0,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: 56,
  },
  tabIconWrap: {
    width: 34,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: { fontSize: 10, letterSpacing: 0.1 },
});
