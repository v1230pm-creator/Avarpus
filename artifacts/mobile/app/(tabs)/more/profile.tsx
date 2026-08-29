import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Avatar } from '@/components/ui/Avatar';
import { FlatCard, useStaggerAnim } from '@/components/ui/Glass';
import { ROLE_LABELS } from '@/utils/helpers';
import { authMeUpdate, getChatRoomsListQueryKey } from '@workspace/api-client-react';

// ── My Profile ──────────────────────────────────────────────────────────────
// Self-service account screen for every signed-in user: edit name and mobile.

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState(user?.name ?? '');
  const [mobile, setMobile] = useState(user?.mobile ?? '');
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    setName(user?.name ?? '');
    setMobile(user?.mobile ?? '');
  }, [user?.id, user?.name, user?.mobile]);

  const anims = useStaggerAnim(1);
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const notify = (title: string, msg: string) => {
    if (Platform.OS === 'web') window.alert(`${title}\n${msg}`);
    else Alert.alert(title, msg);
  };

  const saveProfile = async () => {
    const trimmedName = name.normalize('NFC').trim();
    if (!trimmedName) return notify('Error', 'Name cannot be empty');
    if (Array.from(trimmedName).length > 120) return notify('Error', 'Name must be 120 characters or fewer');
    if (/[\u0000-\u001F\u007F-\u009F\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069<>]/u.test(trimmedName)) {
      return notify('Error', 'Name contains unsupported characters');
    }
    if (mobile && !/^\d{10}$/.test(mobile)) return notify('Error', 'Mobile must be a 10-digit number');
    setSavingProfile(true);
    try {
      await authMeUpdate({ name: trimmedName, ...(mobile ? { mobile } : {}) });
      await refreshUser();
      await queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notify('Saved', 'Profile updated');
    } catch (e: any) {
      notify('Error', e?.response?.data?.message || 'Could not update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>My Profile</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <FlatCard animValue={anims[0]} style={styles.card}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <Avatar name={user?.name ?? 'User'} size={64} />
              <Text style={[styles.email, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{user?.email}</Text>
              <View style={[styles.roleBadge, { backgroundColor: colors.primary + '15' }]}>
                <Text style={{ color: colors.primary, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
                  {ROLE_LABELS[user?.role ?? 'reception'] ?? user?.role}
                </Text>
              </View>
            </View>
            <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>NAME</Text>
            <TextInput value={name} onChangeText={(value) => setName(value.slice(0, 120))} maxLength={120} style={inputStyle} placeholder="Your name" placeholderTextColor={colors.mutedForeground} />
            <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>MOBILE</Text>
            <TextInput value={mobile} onChangeText={(t) => setMobile(t.replace(/[^0-9]/g, '').slice(0, 10))} style={inputStyle} placeholder="10-digit mobile" placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" />
            <TouchableOpacity onPress={saveProfile} disabled={savingProfile} activeOpacity={0.85} style={[styles.button, { backgroundColor: colors.primary, opacity: savingProfile ? 0.6 : 1 }]}>
              {savingProfile ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.buttonText}>Save Profile</Text>}
            </TouchableOpacity>
          </FlatCard>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20 },
  card: { padding: 16, marginBottom: 16 },
  email: { fontSize: 13, marginTop: 8 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginTop: 6 },
  label: { fontSize: 11, letterSpacing: 0.6, marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: Platform.OS === 'web' ? 12 : 10, fontSize: 15, fontFamily: 'Inter_500Medium' },
  button: { marginTop: 18, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
