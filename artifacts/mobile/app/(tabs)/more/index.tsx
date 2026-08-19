import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Avatar } from '@/components/ui/Avatar';
import { GlassCard, ScreenGlow, useStaggerAnim } from '@/components/ui/Glass';
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
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'my-profile', label: 'My Profile', icon: 'user', route: '/(tabs)/more/profile', color: '#4DA3FF', description: 'Name, mobile and password', roles: ['super_admin', 'dealer', 'accountant', 'store_manager', 'reception', 'technician', 'dealer_owner', 'dealer_staff'] },
  { id: 'notifications', label: 'Notifications', icon: 'bell', route: '/(tabs)/more/notifications', color: '#F59E0B', description: 'Repairs, payments and approvals', roles: ['super_admin', 'dealer', 'accountant', 'store_manager', 'reception', 'technician'] },
  { id: 'activity', label: 'Activity Log', icon: 'activity', route: '/(tabs)/more/activity', color: '#34D399', description: 'View system events', roles: ['super_admin', 'dealer'] },
  { id: 'finance', label: 'Finance', icon: 'bar-chart-2', route: '/(tabs)/more/finance', color: '#34D399', description: 'Income, expense, cash book', roles: ['super_admin', 'dealer'], feature: 'finance' },
  { id: 'approvals', label: 'Approvals', icon: 'check-circle', route: '/(tabs)/more/approvals', color: '#FB7185', description: 'Backdated entry requests', roles: ['super_admin', 'dealer'], feature: 'approvals' },
  { id: 'staff', label: 'Staff', icon: 'users', route: '/(tabs)/more/staff', color: '#8B5CF6', description: 'Manage staff and roles', roles: ['super_admin', 'dealer'] },
  { id: 'permissions', label: 'Staff Permissions', icon: 'sliders', route: '/(tabs)/more/permissions', color: '#F472B6', description: 'Turn features on/off per role', roles: ['super_admin', 'dealer'] },
  { id: 'purchases', label: 'Purchases', icon: 'shopping-bag', route: '/(tabs)/more/purchases', color: '#4DA3FF', description: 'Purchase orders, suppliers', roles: ['super_admin', 'dealer'], feature: 'purchases' },
  { id: 'reports', label: 'Reports', icon: 'file-text', route: '/(tabs)/more/reports', color: '#F59E0B', description: 'Generate and export reports', roles: ['super_admin', 'dealer'], feature: 'reports' },
  { id: 'settings', label: 'Settings', icon: 'settings', route: '/(tabs)/more/settings', color: '#A8B3C7', description: 'Company, app configuration', roles: ['super_admin', 'dealer'] },
  { id: 'app-update', label: 'App Update', icon: 'download-cloud', route: '/(tabs)/more/app-update', color: '#3A8FF7', description: 'Check for new app versions', roles: ['super_admin', 'dealer', 'accountant', 'store_manager', 'reception', 'technician'] },
  { id: 'update-manager', label: 'App Update Manager', icon: 'upload-cloud', route: '/(tabs)/more/update-manager', color: '#8B5CF6', description: 'Publish new app releases', roles: ['super_admin'] },
];

export default function MoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, canAccess } = useAuth();
  const currentVersion = getAppVersion();
  const currentBuild = getAppBuildNumber();
  const { data: approvalsData } = useApprovalsList();
  const pendingCount = approvalsData?.pendingCount || 0;
  // Unread in-app notifications badge (polled every minute). Portal accounts
  // don't have a notification inbox.
  const notifRole = useAuth().user?.role ?? '';
  const notifEnabled = notifRole !== 'dealer_owner' && notifRole !== 'dealer_staff';
  const { data: notifData } = useNotificationsList({ query: { enabled: notifEnabled, refetchInterval: 60000 } } as any);
  const unreadNotifs = notifData?.unreadCount || 0;
  // Quiet update indicator: a small badge only, never a popup.
  const { data: latestUpdateData } = useLatestAppUpdate({ buildNumber: currentBuild });
  const updateAvailable =
    !!latestUpdateData?.update && latestUpdateData.update.buildNumber > currentBuild;

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  // Fixed role lists cover owner roles; staff visibility follows the shop's
  // per-role feature toggles (More → Staff Permissions) when `feature` is set.
  const role = user?.role ?? '';
  const isPortal = role === 'dealer_owner' || role === 'dealer_staff';
  const visibleItems = MENU_ITEMS.filter(
    (item) => item.roles.includes(role) || (!isPortal && !!item.feature && canAccess(item.feature)),
  );

  const anims = useStaggerAnim(3);

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await logout();
    router.replace('/(auth)');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />

      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>More</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}>
        {/* User Card */}
        <GlassCard animValue={anims[0]} style={styles.userCard}>
          <Avatar name={user?.name ?? 'User'} size={56} />
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{user?.name}</Text>
            <Text style={[styles.userEmail, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{user?.email}</Text>
            <View style={[styles.roleBadge, { backgroundColor: colors.primary + '15' }]}>
              <Text style={[styles.roleText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                {ROLE_LABELS[user?.role ?? 'reception']}
              </Text>
            </View>
          </View>
        </GlassCard>

        {/* Menu Items */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>MODULES</Text>
        <GlassCard animValue={anims[1]} style={styles.menuGroup}>
          {visibleItems.map((item, idx) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => router.push(item.route as any)}
              activeOpacity={0.7}
              style={[
                styles.menuItem,
                idx < visibleItems.length - 1 && [styles.menuItemBorder, { borderBottomColor: colors.border }],
              ]}
            >
              <View style={[styles.menuIconWrap, { backgroundColor: item.color + '1A' }]}>
                <Feather name={item.icon} size={20} color={item.color} />
                {item.id === 'approvals' && pendingCount > 0 && (user?.role === 'dealer' || user?.role === 'super_admin') && (
                  <View style={[styles.badgeWrap, { backgroundColor: colors.destructive, borderColor: colors.card }]}>
                    <Text style={styles.badgeText}>{pendingCount > 99 ? '99+' : pendingCount}</Text>
                  </View>
                )}
                {item.id === 'notifications' && unreadNotifs > 0 && (
                  <View style={[styles.badgeWrap, { backgroundColor: colors.destructive, borderColor: colors.card }]}>
                    <Text style={styles.badgeText}>{unreadNotifs > 99 ? '99+' : unreadNotifs}</Text>
                  </View>
                )}
                {item.id === 'app-update' && updateAvailable && (
                  <View style={[styles.badgeWrap, { backgroundColor: colors.primary, borderColor: colors.card }]}>
                    <Text style={styles.badgeText}>1</Text>
                  </View>
                )}
              </View>
              <View style={styles.menuContent}>
                <Text style={[styles.menuLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{item.label}</Text>
                <Text style={[styles.menuDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{item.description}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </GlassCard>

        {/* Version info */}
        <Text style={[styles.version, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          VMC Electronic BMS v{currentVersion} (Build {currentBuild})
        </Text>

        {/* Logout */}
        <TouchableOpacity
          onPress={handleLogout}
          style={[styles.logoutBtn, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '33', borderRadius: 20 }]}
          activeOpacity={0.8}
        >
          <Feather name="log-out" size={18} color={colors.destructive} />
          <Text style={[styles.logoutText, { color: colors.destructive, fontFamily: 'Inter_600SemiBold' }]}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 28 },
  scroll: { padding: 16, gap: 14 },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  userInfo: { flex: 1, gap: 3 },
  userName: { fontSize: 18 },
  userEmail: { fontSize: 13 },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, marginTop: 2 },
  roleText: { fontSize: 11 },
  sectionLabel: { fontSize: 11, letterSpacing: 1 },
  menuGroup: { overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  menuItemBorder: { borderBottomWidth: 1 },
  menuIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeWrap: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#FFF', fontSize: 9, fontWeight: 'bold' },
  menuContent: { flex: 1, gap: 2 },
  menuLabel: { fontSize: 15 },
  menuDesc: { fontSize: 12 },
  version: { textAlign: 'center', fontSize: 12, paddingVertical: 8 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, borderWidth: 1 },
  logoutText: { fontSize: 15 },
});
