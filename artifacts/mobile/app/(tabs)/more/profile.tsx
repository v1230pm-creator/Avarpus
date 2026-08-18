import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Avatar } from '@/components/ui/Avatar';
import { GlassCard, ScreenGlow, useStaggerAnim } from '@/components/ui/Glass';
import { ROLE_LABELS } from '@/utils/helpers';
import { authMeUpdate, authChangePassword } from '@workspace/api-client-react';

// ── My Profile ──────────────────────────────────────────────────────────────
// Self-service account screen for every signed-in user: edit name/mobile and
// change the account password (current password required; other devices are
// signed out on change). Password RESET for a forgotten password lives on the
// login screen ("Forgot Password?").

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const [name, setName] = useState(user?.name ?? '');
  const [mobile, setMobile] = useState(user?.mobile ?? '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  const anims = useStaggerAnim(3);
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const notify = (title: string, msg: string) => {
    if (Platform.OS === 'web') window.alert(`${title}\n${msg}`);
    else Alert.alert(title, msg);
  };

  const saveProfile = async () => {
    if (!name.trim()) return notify('Error', 'Name cannot be empty');
    if (mobile && !/^\d{10}$/.test(mobile)) return notify('Error', 'Mobile must be a 10-digit number');
    setSavingProfile(true);
    try {
      await authMeUpdate({ name: name.trim(), ...(mobile ? { mobile } : {}) });
      await refreshUser();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notify('Saved', 'Profile updated');
    } catch (e: any) {
      notify('Error', e?.response?.data?.message || 'Could not update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (!currentPw || !newPw) return notify('Error', 'Enter your current and new password');
    if (newPw !== confirmPw) return notify('Error', 'New passwords do not match');
    if (newPw.length < 8 || !/[A-Z]/.test(newPw) || !/[a-z]/.test(newPw) || !/[0-9]/.test(newPw)) {
      return notify('Error', 'Password must be 8+ characters with uppercase, lowercase and a number');
    }
    setSavingPw(true);
    try {
      await authChangePassword({ currentPassword: currentPw, newPassword: newPw });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notify('Password changed', 'Other devices have been signed out.');
    } catch (e: any) {
      notify('Error', e?.response?.data?.message || 'Could not change password');
    } finally {
      setSavingPw(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenGlow />
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>My Profile</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <GlassCard animValue={anims[0]} style={styles.card}>
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
            <TextInput value={name} onChangeText={setName} style={inputStyle} placeholder="Your name" placeholderTextColor={colors.mutedForeground} />
            <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>MOBILE</Text>
            <TextInput value={mobile} onChangeText={(t) => setMobile(t.replace(/[^0-9]/g, '').slice(0, 10))} style={inputStyle} placeholder="10-digit mobile" placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" />
            <TouchableOpacity onPress={saveProfile} disabled={savingProfile} activeOpacity={0.85} style={[styles.button, { backgroundColor: colors.primary, opacity: savingProfile ? 0.6 : 1 }]}>
              {savingProfile ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.buttonText}>Save Profile</Text>}
            </TouchableOpacity>
          </GlassCard>

          <GlassCard animValue={anims[1]} style={styles.card}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Change Password</Text>
            <Text style={[styles.sectionHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              8+ characters with uppercase, lowercase and a number. Other devices are signed out after the change.
            </Text>
            <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>CURRENT PASSWORD</Text>
            <TextInput value={currentPw} onChangeText={setCurrentPw} style={inputStyle} secureTextEntry={!showPw} placeholder="Current password" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" />
            <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>NEW PASSWORD</Text>
            <TextInput value={newPw} onChangeText={setNewPw} style={inputStyle} secureTextEntry={!showPw} placeholder="New password" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" />
            <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>CONFIRM NEW PASSWORD</Text>
            <TextInput value={confirmPw} onChangeText={setConfirmPw} style={inputStyle} secureTextEntry={!showPw} placeholder="Repeat new password" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" />
            <TouchableOpacity onPress={() => setShowPw(!showPw)} style={styles.showRow} activeOpacity={0.7}>
              <Feather name={showPw ? 'eye-off' : 'eye'} size={16} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_500Medium' }}>{showPw ? 'Hide' : 'Show'} passwords</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={changePassword} disabled={savingPw} activeOpacity={0.85} style={[styles.button, { backgroundColor: colors.primary, opacity: savingPw ? 0.6 : 1 }]}>
              {savingPw ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.buttonText}>Change Password</Text>}
            </TouchableOpacity>
          </GlassCard>

          <GlassCard animValue={anims[2]} style={styles.card}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Forgot your password?</Text>
            <Text style={[styles.sectionHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              If you can't remember your current password, sign out and use "Forgot Password?" on the login screen — an OTP is sent to your registered email.
            </Text>
          </GlassCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22 },
  card: { padding: 18, marginBottom: 16 },
  email: { fontSize: 13, marginTop: 8 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginTop: 6 },
  label: { fontSize: 11, letterSpacing: 0.6, marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: Platform.OS === 'web' ? 12 : 10, fontSize: 15, fontFamily: 'Inter_500Medium' },
  button: { marginTop: 18, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  sectionTitle: { fontSize: 16, marginBottom: 6 },
  sectionHint: { fontSize: 13, lineHeight: 18 },
  showRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
});
