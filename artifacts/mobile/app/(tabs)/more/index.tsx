import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Avatar } from '@/components/ui/Avatar';
import { ROLE_LABELS } from '@/utils/helpers';
import { useApprovalsList, useLatestAppUpdate, useNotificationsList } from '@workspace/api-client-react';
import { getAppBuildNumber, getAppVersion } from '@/utils/appVersion';

interface MenuItem {
  id: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route: string;
  color: string;
  description: string;
  roles: string[];
  /** When set, staff visibility follows the shop's feature toggles instead of the fixed role list. */
  feature?: string;
  section: 'personal' | 'business';
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'my-profile', label: 'Personal Profile', icon: 'user', route: '/(tabs)/more/profile', color: '#0866FF', description: 'Name and mobile number', roles: ['super_admin', 'dealer', 'accountant', 'store_manager', 'reception', 'technician', 'dealer_owner', 'dealer_staff', 'customer'], section: 'personal' },
  { id: 'notifications', label: 'Personal Notifications', icon: 'bell', route: '/(tabs)/more/notifications', color: '#F2B84B', description: 'Chats, repairs and approvals', roles: ['super_admin', 'dealer', 'accountant', 'store_manager', 'reception', 'technician', 'dealer_owner', 'dealer_staff', 'customer'], section: 'personal' },
  { id: 'my-reports', label: 'Safety Reports', icon: 'flag', route: '/(tabs)/more/my-reports', color: '#FB7185', description: 'Chats you reported and their progress', roles: ['super_admin', 'dealer', 'accountant', 'store_manager', 'reception', 'technician', 'dealer_owner', 'dealer_staff', 'customer'], section: 'personal' },
  { id: 'account', label: 'Account & Security', icon: 'shield', route: '/(tabs)/more/account', color: '#718096', description: 'Sessions, app lock and account access', roles: ['super_admin', 'dealer', 'accountant', 'store_manager', 'reception', 'technician', 'dealer_owner', 'dealer_staff', 'customer'], section: 'personal' },
  { id: 'settings', label: 'Personal Settings', icon: 'settings', route: '/(tabs)/more/settings', color: '#718096', description: 'Chats, notifications and appearance', roles: ['super_admin', 'dealer', 'accountant', 'store_manager', 'reception', 'technician', 'dealer_owner', 'dealer_staff', 'customer'], section: 'personal' },
  { id: 'activity', label: 'Activity Log', icon: 'activity', route: '/(tabs)/more/activity', color: '#20C878', description: 'View system events', roles: ['super_admin', 'dealer'], section: 'business' },
  { id: 'finance', label: 'Finance', icon: 'bar-chart-2', route: '/(tabs)/more/finance', color: '#20C878', description: 'Income, expense, cash book', roles: ['super_admin', 'dealer'], feature: 'finance', section: 'business' },
  { id: 'approvals', label: 'Approvals', icon: 'check-circle', route: '/(tabs)/more/approvals', color: '#FF4D4F', description: 'Backdated entry requests', roles: ['super_admin', 'dealer'], feature: 'approvals', section: 'business' },
  { id: 'staff', label: 'Staff', icon: 'users', route: '/(tabs)/more/staff', color: '#8B5CF6', description: 'Manage staff and roles', roles: ['super_admin', 'dealer'], section: 'business' },
  { id: 'permissions', label: 'Staff Permissions', icon: 'sliders', route: '/(tabs)/more/permissions', color: '#D9A441', description: 'Turn features on/off per role', roles: ['super_admin', 'dealer'], section: 'business' },
  { id: 'purchases', label: 'Purchases', icon: 'shopping-bag', route: '/(tabs)/more/purchases', color: '#0866FF', description: 'Purchase orders, suppliers', roles: ['super_admin', 'dealer'], feature: 'purchases', section: 'business' },
  { id: 'reports', label: 'Reports', icon: 'file-text', route: '/(tabs)/more/reports', color: '#F2B84B', description: 'Generate and export reports', roles: ['super_admin', 'dealer'], feature: 'reports', section: 'business' },
  { id: 'inventory', label: 'Inventory', icon: 'package', route: '/(tabs)/inventory', color: '#F2B84B', description: 'Manage stock and parts', roles: ['super_admin', 'dealer'], feature: 'inventory', section: 'business' },
  { id: 'app-update', label: 'App Update', icon: 'download-cloud', route: '/(tabs)/more/app-update', color: '#0866FF', description: 'Check for new app versions', roles: ['super_admin', 'dealer', 'accountant', 'store_manager', 'reception', 'technician'], section: 'business' },
];

export default function MoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  const { user, logout, canAccess } = useAuth();
  const role = user?.role ?? '';
  const isPortal = role === 'dealer_owner' || role === 'dealer_staff';
  const isCustomer = role === 'customer';
  const isOwner = role === 'dealer' || role === 'super_admin';
  const businessOnly = scope === 'business';
  const currentVersion = getAppVersion();
  const currentBuild = getAppBuildNumber();
  
  const { data: approvalsData } = useApprovalsList({
    query: { enabled: isOwner },
  } as any);
  const pendingCount = approvalsData?.pendingCount || 0;
  
  // Every authenticated role can receive exact-recipient direct-chat alerts.
  const { data: notifData } = useNotificationsList({ query: { enabled: true, refetchInterval: 60000 } } as any);
  const unreadNotifs = notifData?.unreadCount || 0;
  
  // Quiet update indicator: a small badge only, never a popup.
  const { data: latestUpdateData } = useLatestAppUpdate(
    { buildNumber: currentBuild },
    { query: { enabled: !isCustomer } } as any,
  );
  const updateAvailable =
    !!latestUpdateData?.update && latestUpdateData.update.buildNumber > currentBuild;

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  // Fixed role lists cover owner roles; staff visibility follows the shop's
  // per-role feature toggles (More → Staff Permissions) when `feature` is set.
  const visibleItems = MENU_ITEMS.filter(
    (item) =>
      (!businessOnly || item.section === 'business') &&
      item.roles.includes(role) ||
      ((!businessOnly || item.section === 'business') &&
        !isPortal && !isCustomer && !!item.feature && canAccess(item.feature)),
  );

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await logout();
    router.replace('/(auth)');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerAction}
          >
            <Feather name="arrow-left" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            {businessOnly ? 'Shop Settings' : 'Settings'}
          </Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}>
        {/* User Card */}
        <View style={[styles.userCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Avatar name={user?.name ?? 'User'} size={52} />
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{user?.name}</Text>
            <Text style={[styles.userEmail, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{user?.email}</Text>
            <View style={[styles.roleBadge, { backgroundColor: colors.primary + '15' }]}>
              <Text style={[styles.roleText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                {ROLE_LABELS[user?.role ?? 'reception']}
              </Text>
            </View>
          </View>
        </View>

        {(businessOnly ? (['business'] as const) : (['personal', 'business'] as const)).map((section) => {
          const items = visibleItems.filter((item) => item.section === section);
          if (!items.length) return null;
          return <View key={section} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
            {section === 'personal' ? 'PERSONAL ACCOUNT' : 'BUSINESS WORKSPACE'}
          </Text>
          <View style={[styles.menuGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {items.map((item, idx) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => router.push(item.route as any)}
              activeOpacity={0.7}
              style={[
                styles.menuItem,
                idx < items.length - 1 && [styles.menuItemBorder, { borderBottomColor: colors.border }],
              ]}
            >
              <View style={[styles.menuIconWrap, { backgroundColor: item.color + '1A' }]}>
                <Feather name={item.icon} size={18} color={item.color} />
                {item.id === 'approvals' && pendingCount > 0 && (user?.role === 'dealer' || user?.role === 'super_admin') && (
                  <View style={[styles.badgeWrap, { backgroundColor: colors.destructive, borderColor: colors.surface }]}>
                    <Text style={styles.badgeText}>{pendingCount > 99 ? '99+' : pendingCount}</Text>
                  </View>
                )}
                {item.id === 'notifications' && unreadNotifs > 0 && (
                  <View style={[styles.badgeWrap, { backgroundColor: colors.destructive, borderColor: colors.surface }]}>
                    <Text style={styles.badgeText}>{unreadNotifs > 99 ? '99+' : unreadNotifs}</Text>
                  </View>
                )}
                {item.id === 'app-update' && updateAvailable && (
                  <View style={[styles.badgeWrap, { backgroundColor: colors.primary, borderColor: colors.surface }]}>
                    <Text style={styles.badgeText}>1</Text>
                  </View>
                )}
              </View>
              <View style={styles.menuContent}>
                <Text style={[styles.menuLabel, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>{item.label}</Text>
                <Text style={[styles.menuDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{item.description}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
          </View></View>;
        })}

        {/* Logout */}
        <TouchableOpacity
          onPress={handleLogout}
          style={[styles.logoutBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          activeOpacity={0.7}
        >
          <Feather name="log-out" size={18} color={colors.destructive} />
          <Text style={[styles.logoutText, { color: colors.destructive, fontFamily: 'Inter_500Medium' }]}>Sign Out</Text>
        </TouchableOpacity>
        
        {/* Version info */}
        <Text style={[styles.version, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Avarpus v{currentVersion} (Build {currentBuild})
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 60,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: { fontSize: 20, letterSpacing: -0.5 },
  headerAction: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingHorizontal: 16, paddingTop: 14, gap: 16 },
  userCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  userInfo: { flex: 1, minWidth: 0, gap: 3 },
  userName: { fontSize: 18, lineHeight: 23, letterSpacing: -0.3 },
  userEmail: { fontSize: 13, lineHeight: 18 },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, marginTop: 5 },
  roleText: { fontSize: 11, lineHeight: 14 },
  menuGroup: { 
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden' 
  },
  section: { gap: 8 },
  sectionLabel: { fontSize: 11, lineHeight: 16, letterSpacing: 0.8, paddingHorizontal: 4 },
  menuItem: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  menuItemBorder: { borderBottomWidth: 1 },
  menuIconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badgeWrap: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#FFF', fontSize: 9, fontWeight: 'bold' },
  menuContent: { flex: 1, minWidth: 0, gap: 2 },
  menuLabel: { fontSize: 15, lineHeight: 20 },
  menuDesc: { fontSize: 12, lineHeight: 17 },
  logoutBtn: { 
    minHeight: 52,
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8, 
    borderWidth: 1,
    borderRadius: 16,
  },
  logoutText: { fontSize: 15, lineHeight: 20 },
  version: { textAlign: 'center', fontSize: 12, lineHeight: 16, paddingVertical: 8 },
});
