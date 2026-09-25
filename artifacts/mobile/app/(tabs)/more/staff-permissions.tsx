import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AvarpusLoadingScreen } from '@/components/ui/AvarpusSpinner';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  staffPermissionsGet,
  staffPermissionsUpdate,
  type IndividualPermissions,
} from '@workspace/api-client-react';
import { FlatCard } from '@/components/ui/FlatCard';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { font, fontFamily } from '@/constants/typography';
import { layout, size, space } from '@/constants/spacing';
import { ROLE_LABELS } from '@/utils/helpers';

const FEATURE_LABELS: Record<string, { label: string; description: string }> = {
  repairs: { label: 'Repairs — view', description: 'Open repair lists and job details' },
  repairs_create: { label: 'Repairs — create', description: 'Register new repair jobs' },
  repairs_update: { label: 'Repairs — actions', description: 'Update jobs, parts, testing and delivery actions' },
  customers: { label: 'Customers', description: 'View, add and edit customers' },
  inventory: { label: 'Inventory', description: 'Manage stock items and adjustments' },
  purchases: { label: 'Purchases', description: 'Manage purchases and suppliers' },
  finance: { label: 'Finance', description: 'Income, expenses and cash book' },
  payments: { label: 'Payment collection', description: 'Record repair payments' },
  reports: { label: 'Reports', description: 'Open and export reports' },
  approvals: { label: 'Approvals', description: 'Request backdated-entry approvals' },
  portal_repairs: { label: 'Dealer portal', description: 'View repairs linked to this dealer account' },
};

const FEATURE_ORDER = Object.keys(FEATURE_LABELS);

function errorMessage(error: unknown): string {
  return (
    (error as { data?: { message?: string } })?.data?.message ??
    'Please check your connection and try again.'
  );
}

export default function StaffPermissionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const targetId = typeof params.id === 'string' ? params.id : '';
  const isOwner = user?.role === 'dealer' || user?.role === 'super_admin';

  const [settings, setSettings] = useState<IndividualPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!targetId || !isOwner) return;
    setLoading(true);
    setLoadError('');
    try {
      setSettings(await staffPermissionsGet(targetId));
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [isOwner, targetId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveChanges = async (changes: Record<string, boolean | null>, busyKey: string) => {
    if (!settings || savingKey) return;
    const previous = settings;
    const nextOverrides = { ...settings.overrides };
    const nextFeatures = { ...settings.features };
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) {
        delete nextOverrides[key];
        nextFeatures[key] = settings.roleFeatures[key] === true;
      } else {
        nextOverrides[key] = value;
        nextFeatures[key] = value;
      }
    }
    setSettings({ ...settings, overrides: nextOverrides, features: nextFeatures });
    setSavingKey(busyKey);
    try {
      const updated = await staffPermissionsUpdate(targetId, { features: changes });
      setSettings(updated);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      setSettings(previous);
      Alert.alert('Could not save permission', errorMessage(error));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSavingKey(null);
    }
  };

  const toggle = (key: string, enabled: boolean) => {
    if (!settings) return;
    const roleDefault = settings.roleFeatures[key] === true;
    // Matching the role value means there is no reason to keep a custom row.
    saveChanges({ [key]: enabled === roleDefault ? null : enabled }, key);
  };

  const resetAll = () => {
    if (!settings || Object.keys(settings.overrides).length === 0) return;
    Alert.alert(
      'Use role defaults?',
      'All custom permissions for this person will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          onPress: () =>
            saveChanges(
              Object.fromEntries(Object.keys(settings.overrides).map((key) => [key, null])),
              '__all__',
            ),
        },
      ],
    );
  };

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const visibleKeys = settings
    ? FEATURE_ORDER.filter((key) => settings.availableFeatures.includes(key))
    : [];
  const customCount = settings ? Object.keys(settings.overrides).length : 0;
  const displayName = settings?.user.name ?? params.name ?? 'Account';

  if (!isOwner) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.mutedForeground }]}>
          Only the shop owner can manage individual permissions.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}
        >
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: fontFamily.bold }]}>
            Permission Settings
          </Text>
          <Text
            style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}
            numberOfLines={1}
          >
            {displayName}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading && !settings ? (
        <AvarpusLoadingScreen size={40} />
      ) : loadError && !settings ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={size.headerIcon} color={colors.destructive} />
          <Text style={[styles.message, { color: colors.mutedForeground }]}>{loadError}</Text>
          <TouchableOpacity onPress={load} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : settings ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        >
          <FlatCard style={styles.profileCard}>
            <View style={[styles.profileIcon, { backgroundColor: colors.primary + '18' }]}>
              <Feather name="user" size={20} color={colors.primary} />
            </View>
            <View style={styles.profileText}>
              <Text style={[styles.name, { color: colors.foreground, fontFamily: fontFamily.bold }]}>
                {settings.user.name}
              </Text>
              <Text style={[styles.role, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
                {ROLE_LABELS[settings.user.role] ?? settings.user.role}
                {customCount > 0 ? ` · ${customCount} custom` : ' · Role defaults'}
              </Text>
            </View>
            {customCount > 0 && (
              <TouchableOpacity
                disabled={savingKey !== null}
                onPress={resetAll}
                style={[styles.resetBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.resetText, { color: colors.primary, fontFamily: fontFamily.semibold }]}>
                  Reset
                </Text>
              </TouchableOpacity>
            )}
          </FlatCard>

          <View style={[styles.infoBox, { backgroundColor: colors.primary + '0D', borderColor: colors.primary + '20' }]}>
            <Feather name="info" size={15} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
              Every switch starts from the account&apos;s role setting. A changed switch applies only to this person.
            </Text>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: fontFamily.semibold }]}>
            FEATURES & ACTIONS
          </Text>
          <FlatCard style={styles.permissionCard}>
            {visibleKeys.map((key, index) => {
              const meta = FEATURE_LABELS[key];
              const inherited = !Object.prototype.hasOwnProperty.call(settings.overrides, key);
              const enabled = settings.features[key] === true;
              return (
                <View
                  key={key}
                  style={[
                    styles.permissionRow,
                    index < visibleKeys.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.permissionText}>
                    <View style={styles.labelRow}>
                      <Text style={[styles.permissionLabel, { color: colors.foreground, fontFamily: fontFamily.semibold }]}>
                        {meta.label}
                      </Text>
                      <View
                        style={[
                          styles.sourceBadge,
                          { backgroundColor: inherited ? colors.muted : colors.primary + '18' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sourceText,
                            {
                              color: inherited ? colors.mutedForeground : colors.primary,
                              fontFamily: fontFamily.semibold,
                            },
                          ]}
                        >
                          {inherited ? 'Role default' : 'Custom'}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.permissionDesc, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
                      {meta.description}
                    </Text>
                  </View>
                  <Switch
                    value={enabled}
                    disabled={savingKey !== null}
                    onValueChange={(value) => toggle(key, value)}
                    trackColor={{ false: colors.muted, true: colors.primary }}
                    thumbColor={colors.primaryForeground}
                  />
                </View>
              );
            })}
          </FlatCard>

          <Text style={[styles.footerNote, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
            Changes are enforced by the server and refresh automatically on this person&apos;s signed-in devices.
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xxl },
  header: { minHeight: layout.headerHeight, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: layout.screenPadding, paddingBottom: space.md },
  backBtn: { width: size.iconButton, height: size.iconButton, borderRadius: size.iconButton / 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  headerTitle: { ...font.title },
  headerSub: { ...font.caption },
  headerSpacer: { width: size.iconButton },
  message: { ...font.small, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12 },
  retryText: { ...font.smallStrong },
  scroll: { padding: layout.screenPadding, gap: space.sm },
  profileCard: { padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: layout.avatarGap },
  profileIcon: { width: size.avatarSm, height: size.avatarSm, borderRadius: size.avatarSm / 2, alignItems: 'center', justifyContent: 'center' },
  profileText: { flex: 1, gap: 2 },
  name: { ...font.itemTitle },
  role: { ...font.caption },
  resetBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
  resetText: { ...font.captionStrong },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderWidth: 1, borderRadius: 12, padding: 12 },
  infoText: { ...font.caption, flex: 1 },
  sectionLabel: { ...font.overline, marginTop: 4 },
  permissionCard: { overflow: 'hidden' },
  permissionRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg },
  permissionText: { flex: 1, gap: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  permissionLabel: { ...font.label },
  permissionDesc: { ...font.caption },
  sourceBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  sourceText: { ...font.small },
  footerNote: { ...font.caption, textAlign: 'center', paddingHorizontal: 8 },
});