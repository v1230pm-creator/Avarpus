import React, { useMemo, useState } from 'react';
import { FlatList, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { User } from '@/types';
import { ROLE_LABELS } from '@/utils/helpers';

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#DC2626',
  dealer: '#7C3AED',
  reception: '#0284C7',
  technician: '#059669',
  store_manager: '#D97706',
  accountant: '#64748B',
};

function StaffCard({ staff }: { staff: User }) {
  const colors = useColors();
  const roleColor = ROLE_COLORS[staff.role] ?? colors.primary;
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <Avatar name={staff.name} size={52} />
      <View style={styles.cardContent}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{staff.name}</Text>
          <View style={[styles.statusDot, { backgroundColor: staff.isActive ? colors.success : colors.mutedForeground }]} />
        </View>
        <Text style={[styles.email, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{staff.email}</Text>
        {staff.mobile && <Text style={[styles.mobile, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{staff.mobile}</Text>}
        <View style={styles.badges}>
          <View style={[styles.roleBadge, { backgroundColor: roleColor + '1A' }]}>
            <Text style={[styles.roleText, { color: roleColor, fontFamily: 'Inter_600SemiBold' }]}>{ROLE_LABELS[staff.role]}</Text>
          </View>
          {staff.designation && (
            <View style={[styles.desBadge, { backgroundColor: colors.muted }]}>
              <Text style={[styles.desText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{staff.designation}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

export default function StaffScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { users } = useData();
  const [search, setSearch] = useState('');

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const filtered = useMemo(() => {
    const staff = users.filter((u) => u.role !== 'super_admin');
    if (!search.trim()) return staff;
    const q = search.toLowerCase();
    return staff.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || ROLE_LABELS[u.role].toLowerCase().includes(q));
  }, [users, search]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 14, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Staff</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{filtered.length} members</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.searchWrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.input, borderColor: colors.border }]}>
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

      <FlatList
        data={filtered}
        keyExtractor={(u) => u.id}
        contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<EmptyState icon="users" title="No staff found" description="No staff members match your search" />}
        renderItem={({ item }) => <StaffCard staff={item} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22 },
  headerSub: { fontSize: 13 },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  searchInput: { flex: 1, height: 44, fontSize: 14 },
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  card: { flexDirection: 'row', gap: 14, padding: 14, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, elevation: 1 },
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
});
