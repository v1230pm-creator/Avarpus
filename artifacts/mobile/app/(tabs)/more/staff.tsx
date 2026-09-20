import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Platform, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { staffList, staffActivate, staffReject } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { FlatCard, FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { ROLE_LABELS } from '@/utils/helpers';

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#F87171',
  dealer: '#8B5CF6',
  owner: '#8B5CF6',
  reception: '#4DA3FF',
  technician: '#34D399',
  store_manager: '#F59E0B',
  accountant: '#A8B3C7',
  dealer_owner: '#F472B6',
  dealer_staff: '#FB7185',
};

type StaffUser = {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: string;
  isActive: boolean;
  designation?: string;
  profilePhoto?: string | null;
  /** Invited with a Staff ID + claim code; joins on their own, never approved here. */
  invitePending?: boolean;
};

function StaffCard({
  staff,
  onEdit,
  onPermissions,
}: {
  staff: StaffUser;
  onEdit?: () => void;
  onPermissions?: () => void;
}) {
  const colors = useColors();
  const roleColor = ROLE_COLORS[staff.role] ?? colors.primary;
  return (
    <FlatCard style={styles.card}>
      <Avatar name={staff.name} url={staff.profilePhoto} size={52} />
      <View style={styles.cardContent}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{staff.name}</Text>
          <View style={[styles.statusDot, { backgroundColor: staff.isActive ? colors.success : colors.mutedForeground }]} />
        </View>
        <Text style={[styles.email, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{staff.email}</Text>
        {!!staff.mobile && <Text style={[styles.mobile, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{staff.mobile}</Text>}
        <View style={styles.badges}>
          <View style={[styles.roleBadge, { backgroundColor: roleColor + '1A' }]}>
            <Text style={[styles.roleText, { color: roleColor, fontFamily: 'Inter_600SemiBold' }]}>{ROLE_LABELS[staff.role] ?? staff.role}</Text>
          </View>
          {staff.designation && (
            <View style={[styles.desBadge, { backgroundColor: colors.muted }]}>
              <Text style={[styles.desText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{staff.designation}</Text>
            </View>
          )}
        </View>
      </View>
      {(onEdit || onPermissions) && (
        <View style={styles.cardActions}>
          {onPermissions && (
            <TouchableOpacity
              onPress={onPermissions}
              accessibilityLabel={`Permission settings for ${staff.name}`}
              style={[styles.editBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}
              activeOpacity={0.8}
            >
              <Feather name="shield" size={16} color={colors.primary} />
            </TouchableOpacity>
          )}
          {onEdit && (
            <TouchableOpacity
              onPress={onEdit}
              accessibilityLabel={`Edit ${staff.name}`}
              style={[styles.editBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}
              activeOpacity={0.8}
            >
              <Feather name="edit-2" size={16} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </FlatCard>
  );
}

function PendingCard({
  staff,
  onApprove,
  onReject,
  busy,
}: {
  staff: StaffUser;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const roleColor = ROLE_COLORS[staff.role] ?? colors.primary;
  return (
    <FlatCard style={styles.pendingCard}>
      <TouchableOpacity
        style={styles.pendingRow}
        activeOpacity={0.8}
        onPress={() => { setExpanded((e) => !e); setConfirmReject(false); }}
      >
        <Avatar name={staff.name} url={staff.profilePhoto} size={44} />
        <View style={styles.cardContent}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{staff.name}</Text>
            <View style={[styles.pendingBadge, { backgroundColor: colors.warning + '1A' }]}>
              <Text style={[styles.pendingBadgeText, { color: colors.warning, fontFamily: 'Inter_600SemiBold' }]}>
                {staff.invitePending ? 'Invited' : 'Pending'}
              </Text>
            </View>
          </View>
          <Text style={[styles.email, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{staff.email}</Text>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
      </TouchableOpacity>
      {expanded && (
        <View style={styles.pendingDetails}>
          {!!staff.mobile && (
            <Text style={[styles.mobile, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Mobile: {staff.mobile}</Text>
          )}
          <View style={styles.badges}>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + '1A' }]}>
              <Text style={[styles.roleText, { color: roleColor, fontFamily: 'Inter_600SemiBold' }]}>{ROLE_LABELS[staff.role] ?? staff.role}</Text>
            </View>
            {staff.designation && (
              <View style={[styles.desBadge, { backgroundColor: colors.muted }]}>
                <Text style={[styles.desText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{staff.designation}</Text>
              </View>
            )}
          </View>
          {staff.invitePending && (
            <Text style={[styles.mobile, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Waiting for them to join: they sign in with mobile OTP, open Shop and enter the Staff ID and claim code you shared. No approval is needed. Add them again to issue fresh codes.
            </Text>
          )}
          <View style={styles.actionRow}>
            {!staff.invitePending && (
              <TouchableOpacity
                disabled={busy}
                onPress={onApprove}
                style={[styles.actionBtn, { backgroundColor: colors.success, opacity: busy ? 0.6 : 1 }]}
                activeOpacity={0.85}
              >
                <Feather name="check" size={15} color="#FFFFFF" />
                <Text style={[styles.actionBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Approve</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              disabled={busy}
              onPress={() => {
                if (confirmReject) { onReject(); } else { setConfirmReject(true); }
              }}
              style={[
                styles.actionBtn,
                confirmReject
                  ? { backgroundColor: colors.destructive, opacity: busy ? 0.6 : 1 }
                  : { backgroundColor: colors.destructive + '1A', opacity: busy ? 0.6 : 1 },
              ]}
              activeOpacity={0.85}
            >
              <Feather name="x" size={15} color={confirmReject ? '#FFFFFF' : colors.destructive} />
              <Text
                style={[
                  styles.actionBtnText,
                  { fontFamily: 'Inter_600SemiBold', color: confirmReject ? '#FFFFFF' : colors.destructive },
                ]}
              >
                {confirmReject ? (staff.invitePending ? 'Confirm cancel' : 'Confirm Reject') : (staff.invitePending ? 'Cancel invite' : 'Reject')}
              </Text>
            </TouchableOpacity>
          </View>
          {confirmReject && (
            <Text style={[styles.rejectHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {staff.invitePending
                ? 'Cancelling withdraws the invitation. Their personal Avarpus account is not affected.'
                : 'Rejecting permanently removes this registration.'}
            </Text>
          )}
        </View>
      )}
    </FlatCard>
  );
}

export default function StaffScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, canAccess } = useAuth();
  const [search, setSearch] = useState('');
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const canManage = user?.role === 'dealer' || user?.role === 'super_admin';

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await staffList();
      setStaff(res.staff as StaffUser[]);
      setLoaded(true);
    } catch (err: any) {
      setError(err?.data?.message ?? 'Could not load staff. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // Refresh whenever the screen gains focus (e.g. after adding staff)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const anims = useStaggerAnim(2);

  const filtered = useMemo(() => {
    if (!search.trim()) return staff;
    const q = search.toLowerCase();
    return staff.filter((u) =>
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (ROLE_LABELS[u.role] ?? u.role).toLowerCase().includes(q),
    );
  }, [staff, search]);

  const pending = useMemo(() => filtered.filter((u) => !u.isActive), [filtered]);
  const active = useMemo(() => filtered.filter((u) => u.isActive), [filtered]);

  const handleApprove = useCallback(async (id: string) => {
    setBusyId(id);
    setActionError('');
    try {
      await staffActivate(id);
      await load();
    } catch (err: any) {
      setActionError(err?.data?.message ?? 'Could not approve this account. Please try again.');
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const handleReject = useCallback(async (id: string) => {
    setBusyId(id);
    setActionError('');
    try {
      await staffReject(id);
      await load();
    } catch (err: any) {
      setActionError(err?.data?.message ?? 'Could not reject this account. Please try again.');
    } finally {
      setBusyId(null);
    }
  }, [load]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <FadeInView animValue={anims[0]}>
        <View style={[styles.header, { paddingTop: topPad + 14 }]}>
          <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Staff</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{filtered.length} members</Text>
          </View>
          {canManage ? (
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/more/staff-add')}
              style={[styles.addBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.85}
            >
              <Feather name="user-plus" size={16} color="#FFFFFF" />
              <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Add Staff</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        <View style={styles.searchWrap}>
          <View style={[styles.searchBar, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '22' }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search staff..."
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
            />
            {!!search && <TouchableOpacity onPress={() => setSearch('')}><Feather name="x" size={16} color={colors.mutedForeground} /></TouchableOpacity>}
          </View>
        </View>
      </FadeInView>

      {loading && !loaded ? (
        <DataLoadingState message="Loading staff…" />
      ) : error && !loaded ? (
        <DataErrorState onRetry={() => { setLoading(true); load(); }} />
      ) : (
      <>
      {!!error && <DataErrorBanner onRetry={load} />}
      <FlatList
        data={canManage ? active : filtered}
        keyExtractor={(u) => u.id}
        contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
        ListHeaderComponent={
          canManage && pending.length > 0 ? (
            <View style={styles.pendingSection}>
              <Text style={[styles.sectionTitle, { color: colors.warning, fontFamily: 'Inter_600SemiBold' }]}>
                {pending.every((u) => u.invitePending) ? 'Invited' : 'Pending Approvals'} ({pending.length})
              </Text>
              {!!actionError && (
                <Text style={[styles.actionErrorText, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>{actionError}</Text>
              )}
              {pending.map((u) => (
                <PendingCard
                  key={u.id}
                  staff={u}
                  busy={busyId === u.id}
                  onApprove={() => handleApprove(u.id)}
                  onReject={() => handleReject(u.id)}
                />
              ))}
              {active.length > 0 && (
                <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold', marginTop: 12 }]}>
                  Active Staff
                </Text>
              )}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title="No staff yet"
            description={canManage ? 'Tap "Add Staff" to create your first staff account.' : 'No staff members found.'}
          />
        }
        renderItem={({ item }) => (
          <StaffCard
            staff={item}
            onPermissions={
              canManage && ['reception', 'technician', 'store_manager', 'accountant', 'dealer_owner', 'dealer_staff'].includes(item.role)
                ? () =>
                    router.push({
                      pathname: '/(tabs)/more/staff-permissions',
                      params: { id: item.id, name: item.name },
                    })
                : undefined
            }
            onEdit={
              canManage && ['reception', 'technician', 'store_manager', 'accountant'].includes(item.role)
                ? () =>
                    router.push({
                      pathname: '/(tabs)/more/staff-edit',
                      params: {
                        id: item.id,
                        name: item.name,
                        email: item.email,
                        mobile: item.mobile,
                        role: item.role,
                        designation: item.designation ?? '',
                      },
                    })
                : undefined
            }
          />
        )}
      />
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20 },
  headerSub: { fontSize: 13 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 12, marginTop: 3 },
  addBtnText: { fontSize: 13, color: '#FFFFFF' },
  searchWrap: { paddingHorizontal: 12, paddingVertical: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
  searchInput: { flex: 1, height: 46, fontSize: 14 },
  list: { paddingHorizontal: 12, paddingTop: 12, gap: 8 },
  card: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' },
  cardContent: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  email: { fontSize: 12 },
  mobile: { fontSize: 12 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  roleText: { fontSize: 11 },
  desBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  desText: { fontSize: 11 },
  editBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cardActions: { gap: 8 },
  pendingSection: { gap: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6 },
  actionErrorText: { fontSize: 12 },
  pendingCard: { padding: 12, gap: 0 },
  pendingRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  pendingBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  pendingBadgeText: { fontSize: 10 },
  pendingDetails: { marginTop: 12, gap: 8 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: 12 },
  actionBtnText: { fontSize: 13, color: '#FFFFFF' },
  rejectHint: { fontSize: 11 },
});
