import React, { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { AvarpusLoadingScreen } from '@/components/ui/AvarpusSpinner';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space, hitSlop } from '@/constants/spacing';
import { FlatCard } from '@/components/ui/FlatCard';
import { roleFeaturesGet, roleFeaturesUpdate } from '@workspace/api-client-react';

// ── Staff Permissions ───────────────────────────────────────────────────────
// Owner-only screen: switch app features on/off for each staff role and the
// dealer portal. Changes save immediately and apply on staff devices within a
// minute (their app refreshes its toggles periodically) — the server enforces
// them regardless of what the UI shows.

const ROLES: { key: string; label: string; description: string }[] = [
  { key: 'reception', label: 'Reception', description: 'Front desk — intake and customers' },
  { key: 'technician', label: 'Technician', description: 'Repair work on assigned jobs' },
  { key: 'store_manager', label: 'Store Manager', description: 'Inventory and purchases' },
  { key: 'accountant', label: 'Accountant', description: 'Finance, reports and books' },
  { key: 'dealer_owner', label: 'Dealer Portal — Owner', description: 'B2B dealer login (owner)' },
  { key: 'dealer_staff', label: 'Dealer Portal — Staff', description: 'B2B dealer login (staff)' },
];

const FEATURE_LABELS: Record<string, { label: string; description: string }> = {
  repairs: { label: 'Repairs — view', description: 'See the repairs list and details' },
  repairs_create: { label: 'Repairs — create', description: 'Register new repair jobs' },
  repairs_update: { label: 'Repairs — update', description: 'Change repair status and work details' },
  customers: { label: 'Customers', description: 'View, add and edit customers' },
  inventory: { label: 'Inventory', description: 'Stock items and adjustments' },
  purchases: { label: 'Purchases', description: 'Purchase orders and suppliers' },
  finance: { label: 'Finance', description: 'Income, expense and cash book' },
  payments: { label: 'Payment collection', description: 'Record customer payments on repairs' },
  reports: { label: 'Reports', description: 'Generate and export reports' },
  approvals: { label: 'Approvals', description: 'Request backdated-entry approvals' },
  portal_repairs: { label: 'Portal access', description: 'View their own repairs in the dealer portal' },
};

// Stable display order for the switches.
const FEATURE_ORDER = Object.keys(FEATURE_LABELS);

export default function PermissionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isOwner = user?.role === 'super_admin' || user?.role === 'dealer';

  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>> | null>(null);
  const [selectedRole, setSelectedRole] = useState('reception');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = async () => {
    setLoadError(false);
    try {
      const res = await roleFeaturesGet();
      setMatrix((res as any).matrix ?? null);
      if (!(res as any).matrix) setLoadError(true);
    } catch {
      setLoadError(true);
    }
  };

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner]);

  const toggle = async (featureKey: string, value: boolean) => {
    if (!matrix || savingKey) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const prev = matrix;
    // Optimistic flip; revert on failure.
    setMatrix({
      ...matrix,
      [selectedRole]: { ...matrix[selectedRole], [featureKey]: value },
    });
    setSavingKey(featureKey);
    try {
      const res = await roleFeaturesUpdate(selectedRole, { features: { [featureKey]: value } });
      if ((res as any).matrix) setMatrix((res as any).matrix);
    } catch (err) {
      setMatrix(prev);
      const msg = (err as { data?: { message?: string } })?.data?.message;
      Alert.alert('Could not save', msg ?? 'Please check your connection and try again.');
    } finally {
      setSavingKey(null);
    }
  };

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  if (!isOwner) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: colors.mutedForeground, fontFamily: fontFamily.regular }}>
          Only the shop owner can manage staff permissions.
        </Text>
      </View>
    );
  }

  const roleFeatures = matrix?.[selectedRole];
  const visibleKeys = roleFeatures ? FEATURE_ORDER.filter((k) => k in roleFeatures) : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <View style={[styles.header, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.card }]}>
          <Feather name="chevron-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: fontFamily.bold }]}>Staff Permissions</Text>
      </View>

      {!matrix && !loadError && (
        <AvarpusLoadingScreen size={40} />
      )}

      {loadError && (
        <View style={styles.center}>
          <Text style={{ color: colors.mutedForeground, fontFamily: fontFamily.regular, marginBottom: 12 }}>
            Could not load permissions.
          </Text>
          <TouchableOpacity onPress={load} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={{ color: colors.primaryForeground, fontFamily: fontFamily.semibold }}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {matrix && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}>
          <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
            Choose a role, then switch features on or off. Changes apply to staff devices within a minute.
          </Text>

          {/* Role selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roleRow}>
            {ROLES.map((r) => {
              const active = r.key === selectedRole;
              return (
                <TouchableOpacity hitSlop={hitSlop.chip}
                  key={r.key}
                  onPress={() => setSelectedRole(r.key)}
                  style={[
                    styles.roleChip,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? '#FFF' : colors.foreground,
                      ...font.captionStrong,
                    }}
                  >
                    {r.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={[styles.roleDesc, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
            {ROLES.find((r) => r.key === selectedRole)?.description}
          </Text>

          <FlatCard style={styles.group}>
            {visibleKeys.map((key, idx) => (
              <View
                key={key}
                style={[
                  styles.row,
                  idx < visibleKeys.length - 1 && [styles.rowBorder, { borderBottomColor: colors.border }],
                ]}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: fontFamily.semibold }]}>
                    {FEATURE_LABELS[key].label}
                  </Text>
                  <Text style={[styles.rowDesc, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
                    {FEATURE_LABELS[key].description}
                  </Text>
                </View>
                <Switch
                  value={roleFeatures?.[key] === true}
                  disabled={savingKey !== null}
                  onValueChange={(v) => toggle(key, v)}
                  trackColor={{ true: colors.primary }}
                />
              </View>
            ))}
          </FlatCard>

          <Text style={[styles.note, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
            Owner accounts (Dealer / Super Admin) always have full access and are not affected by these switches.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: layout.headerHeight, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: layout.listInset },
  backBtn: { width: size.iconButton, height: size.iconButton, borderRadius: size.iconButton / 2, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  retryBtn: { paddingHorizontal: space.xxl, minHeight: size.button, justifyContent: 'center', borderRadius: radius.sm },
  scroll: { padding: layout.screenPadding, gap: space.sm },
  hint: { ...font.caption },
  roleRow: { gap: 8, paddingVertical: 2 },
  roleChip: { minHeight: size.chip, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: size.chip / 2, borderWidth: 1 },
  roleDesc: { ...font.caption },
  group: { overflow: 'hidden' },
  row: { minHeight: layout.headerHeight, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: layout.screenPadding, paddingVertical: space.sm },
  rowBorder: { borderBottomWidth: 1 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { ...font.bodyStrong },
  rowDesc: { ...font.caption },
  note: { ...font.caption, textAlign: 'center', paddingHorizontal: 8 },
});
