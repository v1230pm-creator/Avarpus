import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Redirect, useRouter, useSegments } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { isDealerPortalRole, isCustomerRole, isLinkedCustomerPortalUser } from '@/types';
import { useColors } from '@/hooks/useColors';
import { isLockEnabled, isUnlocked, subscribeLockState } from '@/utils/appLock';
import { InactivityGuard } from '@/components/InactivityGuard';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { canAccessTabsRoute } from '@/utils/tabRouteAccess';
import {
  getPrimaryTabsHomeRoute,
  getVisiblePrimaryTabs,
  type PrimaryTabName,
} from '@/utils/tabVisibility';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AvarpusLoadingScreen, AvarpusSpinner } from '@/components/ui/AvarpusSpinner';

const MAIN_TABS: Array<{
  name: PrimaryTabName;
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
}> = [
  { name: 'index', label: 'Chat', icon: 'message-circle' as const },
  { name: 'status', label: 'Status', icon: 'circle' as const },
  { name: 'shop', label: 'Shop', icon: 'briefcase' as const },
  { name: 'calls', label: 'Calls', icon: 'phone' as const },
  { name: 'repairs', label: 'My Repairs', icon: 'tool' as const },
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
          title: 'Chat',
        }}
      />
      <Tabs.Screen name="status" options={{ href: undefined, title: 'Status' }} />
      <Tabs.Screen name="shop" options={{ href: undefined, title: 'Shop' }} />
      <Tabs.Screen name="calls" options={{ href: undefined, title: 'Calls' }} />
      <Tabs.Screen
        name="repairs"
        options={{
          href: null,
          title: 'Repairs',
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          href: null,
          title: 'Customers',
        }}
      />
      <Tabs.Screen
        name="khata"
        options={{
          href: null,
          title: 'Khata',
        }}
      />
      <Tabs.Screen name="updates" options={{ href: null, title: 'Updates' }} />
      <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
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

function DealerInactiveScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { logout, refreshFeatures } = useAuth();
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await refreshFeatures();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View
      style={[
        styles.inactivePage,
        {
          backgroundColor: colors.background,
          paddingTop: Platform.OS === 'web' ? insets.top + 67 : insets.top,
          paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom,
        },
      ]}
    >
      <View style={[styles.inactiveIcon, { backgroundColor: colors.accent }]}>
        <Feather name="lock" size={28} color={colors.primary} />
      </View>
      <Text style={[styles.inactiveTitle, { color: colors.foreground }]}>Dealer portal is inactive</Text>
      <Text style={[styles.inactiveBody, { color: colors.mutedForeground }]}>
        Your shop has disabled access to this dealer portal. No repair information is available while access is inactive.
      </Text>
      <Text style={[styles.inactiveHint, { color: colors.mutedForeground }]}>
        If the shop reactivates your access, tap Retry to continue without signing in again.
      </Text>
      <TouchableOpacity
        testID="dealer-inactive-retry"
        accessibilityRole="button"
        onPress={retry}
        disabled={retrying}
        style={[styles.inactivePrimary, { backgroundColor: colors.primary, opacity: retrying ? 0.7 : 1 }]}
      >
        {retrying ? <AvarpusSpinner size={20} color={colors.primaryForeground} /> : (
          <Text style={[styles.inactivePrimaryText, { color: colors.primaryForeground }]}>Retry access</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        testID="dealer-inactive-account"
        accessibilityRole="button"
        onPress={() => router.push('/(tabs)/more/profile')}
        style={[styles.inactiveSecondary, { borderColor: colors.border }]}
      >
        <Text style={[styles.inactiveSecondaryText, { color: colors.foreground }]}>Manage account</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="dealer-inactive-sign-out" accessibilityRole="button" onPress={() => void logout()}>
        <Text style={[styles.inactiveSignOut, { color: colors.mutedForeground }]}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const { isAuthenticated, isLoading, user, canAccess, dealerPortalInactive } = useAuth();
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

  const isPersonalAccountRoute =
    segments[1] === 'more' && ['profile', 'account', 'security'].includes(segments[2] ?? '');
  if (portal && dealerPortalInactive && !isPersonalAccountRoute) {
    return <DealerInactiveScreen />;
  }

  // A hidden tab is not an authorization boundary. This runs above all nested
  // tab routes so denied deep links never mount sensitive screen hooks.
  if (user && !canAccessTabsRoute(segments, { role: user.role, canAccess })) {
    return <Redirect href="/(tabs)" />;
  }
  const repairPortal = portal || isLinkedCustomerPortalUser(user);
  const primaryRoute = getPrimaryTabsHomeRoute({ portal: repairPortal, canAccess });
  if (repairPortal && segments[1] === undefined && primaryRoute !== '/(tabs)') {
    return <Redirect href={primaryRoute} />;
  }

  if (lockCheck === 'pending') {
    return <AvarpusLoadingScreen background={colors.background} size={40} />;
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
  inactivePage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  inactiveIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  inactiveTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    textAlign: 'center',
  },
  inactiveBody: {
    marginTop: 12,
    maxWidth: 440,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  inactiveHint: {
    marginTop: 10,
    marginBottom: 24,
    maxWidth: 440,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  inactivePrimary: {
    minWidth: 220,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  inactivePrimaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  inactiveSecondary: {
    minWidth: 220,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingHorizontal: 22,
  },
  inactiveSecondaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  inactiveSignOut: {
    marginTop: 22,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
