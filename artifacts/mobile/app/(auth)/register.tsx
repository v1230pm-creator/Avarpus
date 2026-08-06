import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { storage, KEYS } from '@/utils/storage';
import { User } from '@/types';

export default function RegisterScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Full name is required';
    if (!email.trim() || !email.includes('@')) e.email = 'Valid email is required';
    if (!mobile.trim() || mobile.length !== 10) e.mobile = 'Valid 10-digit mobile required';
    if (!password || password.length < 6) e.password = 'Password must be at least 6 characters';
    if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const users = (await storage.get<User[]>(KEYS.USERS)) ?? [];
      const exists = users.some((u) => u.email === email.toLowerCase() || u.mobile === mobile);
      if (exists) {
        setErrors({ email: 'Account with this email or mobile already exists' });
        setLoading(false);
        return;
      }
      const newUser: User = {
        id: `u${Date.now()}`,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        mobile: mobile.trim(),
        role: 'reception',
        isActive: false, // Pending approval
        joinDate: new Date().toISOString().split('T')[0],
        designation: 'Staff',
        password,
      };
      await storage.set(KEYS.USERS, [...users, newUser]);
      router.back();
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={['#060A14', '#0D1528', '#060A14']} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Feather name="arrow-left" size={22} color="#F1F5F9" />
            </TouchableOpacity>
            <View>
              <Text style={[styles.title, { fontFamily: 'Inter_700Bold' }]}>Create Account</Text>
              <Text style={[styles.subtitle, { fontFamily: 'Inter_400Regular' }]}>
                Request staff access
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Input label="Full Name" value={name} onChangeText={setName} placeholder="Your full name" leftIcon="user" error={errors.name} />
            <Input label="Email Address" value={email} onChangeText={setEmail} placeholder="name@company.com" keyboardType="email-address" autoCapitalize="none" leftIcon="mail" error={errors.email} />
            <Input label="Mobile Number" value={mobile} onChangeText={setMobile} placeholder="10-digit mobile" keyboardType="phone-pad" leftIcon="phone" error={errors.mobile} />
            <Input label="Password" value={password} onChangeText={setPassword} placeholder="Min. 6 characters" isPassword leftIcon="lock" error={errors.password} />
            <Input label="Confirm Password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Re-enter password" isPassword leftIcon="lock" error={errors.confirmPassword} />

            <View style={[styles.infoBox, { backgroundColor: '#1E40AF22', borderColor: '#3B82F644' }]}>
              <Feather name="info" size={15} color="#60A5FA" />
              <Text style={[styles.infoText, { color: '#93C5FD', fontFamily: 'Inter_400Regular' }]}>
                Your account will be pending admin approval before you can log in.
              </Text>
            </View>

            <Button title="Create Account" onPress={handleRegister} loading={loading} fullWidth size="lg" />
          </View>

          <TouchableOpacity onPress={() => router.back()} style={styles.loginRow}>
            <Text style={[styles.loginText, { color: '#64748B', fontFamily: 'Inter_400Regular' }]}>
              Already have an account?{' '}
              <Text style={{ color: '#60A5FA', fontFamily: 'Inter_600SemiBold' }}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, gap: 24 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, color: '#F1F5F9' },
  subtitle: { fontSize: 13, color: '#64748B' },
  card: {
    backgroundColor: '#0F172A', borderRadius: 20,
    borderWidth: 1, borderColor: '#1E293B', padding: 24, gap: 14,
  },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  infoText: { fontSize: 12, flex: 1, lineHeight: 18 },
  loginRow: { alignItems: 'center' },
  loginText: { fontSize: 14 },
});
