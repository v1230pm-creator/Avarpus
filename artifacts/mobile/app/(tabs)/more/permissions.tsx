import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
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
        <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
          Only the shop owner can manage staff permissions.
        </Text>
      </View>
    );
  }

  const roleFeatures = matrix?.[selectedRole];
  const visibleKeys = roleFeatures ? FEATURE_ORDER.filter((k) => k in roleFeatures) : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.card }]}>
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Staff Permissions</Text>
      </View>

      {!matrix && !loadError && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      )}

      {loadError && (
        <View style={styles.center}>
          <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 12 }}>
            Could not load permissions.
          </Text>
          <TouchableOpacity onPress={load} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={{ color: '#FFF', fontFamily: 'Inter_600SemiBold' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {matrix && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}>
          <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Choose a role, then switch features on or off. Changes apply to staff devices within a minute.
          </Text>

          {/* Role selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roleRow}>
            {ROLES.map((r) => {
              const active = r.key === selectedRole;
              return (
                <TouchableOpacity
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
                      fontFamily: 'Inter_600SemiBold',
                      fontSize: 13,
                    }}
                  >
                    {r.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={[styles.roleDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
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
                  <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                    {FEATURE_LABELS[key].label}
                  </Text>
                  <Text style={[styles.rowDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
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

          <Text style={[styles.note, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Owner accounts (Dealer / Super Admin) always have full access and are not affected by these switches.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 16 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  scroll: { padding: 12, gap: 8 },
  hint: { fontSize: 13, lineHeight: 19 },
  roleRow: { gap: 8, paddingVertical: 2 },
  roleChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
  roleDesc: { fontSize: 12 },
  group: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  rowBorder: { borderBottomWidth: 1 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15 },
  rowDesc: { fontSize: 12 },
  note: { fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 8 },
});
