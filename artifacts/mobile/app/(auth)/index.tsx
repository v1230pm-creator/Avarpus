import React, { useState } from 'react';
import {
  Image,
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
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

const DEMO_ACCOUNTS = [
  { role: 'Super Admin', email: 'superadmin@vmc.com', password: 'Admin@123' },
  { role: 'Dealer / Owner', email: 'dealer@vmc.com', password: 'Dealer@123' },
  { role: 'Reception Staff', email: 'reception@vmc.com', password: 'Staff@123' },
  { role: 'Technician', email: 'tech@vmc.com', password: 'Tech@123' },
  { role: 'Store Manager', email: 'store@vmc.com', password: 'Store@123' },
  { role: 'Accountant', email: 'accounts@vmc.com', password: 'Accts@123' },
];

export default function LoginScreen() {
  const colors = useColors();
  const { login } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [credential, setCredential] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDemo, setShowDemo] = useState(false);

  const handleLogin = async () => {
    if (!credential.trim() || !password.trim()) {
      setError('Please enter your email/mobile and password');
      return;
    }
    setLoading(true);
    setError('');
    const result = await login(credential.trim(), password);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Invalid credentials. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    }
  };

  const fillDemo = (email: string, pwd: string) => {
    setCredential(email);
    setPassword(pwd);
    setShowDemo(false);
    setError('');
  };

  return (
    <LinearGradient colors={['#060A14', '#0D1528', '#060A14']} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingTop: insets.top + 48,
              paddingBottom: insets.bottom + 48,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Branding */}
          <View style={styles.brand}>
            <View style={styles.logoContainer}>
              <Image
                source={require('@/assets/images/icon.png')}
                style={styles.logo}
              />
            </View>
            <Text style={[styles.appName, { fontFamily: 'Inter_700Bold' }]}>
              VMC Electronic
            </Text>
            <Text style={[styles.tagline, { fontFamily: 'Inter_400Regular' }]}>
              Business Management System
            </Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { fontFamily: 'Inter_700Bold' }]}>
              Welcome Back
            </Text>
            <Text style={[styles.cardSub, { fontFamily: 'Inter_400Regular' }]}>
              Sign in to your workspace
            </Text>

            {!!error && (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={15} color="#F87171" />
                <Text style={[styles.errorText, { fontFamily: 'Inter_400Regular' }]}>
                  {error}
                </Text>
              </View>
            )}

            <View style={{ gap: 14, marginTop: 4 }}>
              <Input
                label="Email or Mobile"
                value={credential}
                onChangeText={setCredential}
                placeholder="name@company.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                leftIcon="user"
              />
              <Input
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Enter password"
                isPassword
                leftIcon="lock"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
            </View>

            <TouchableOpacity style={styles.forgotRow}>
              <Text style={[styles.forgotText, { fontFamily: 'Inter_500Medium' }]}>
                Forgot Password?
              </Text>
            </TouchableOpacity>

            <Button
              title="Sign In"
              onPress={handleLogin}
              loading={loading}
              fullWidth
              size="lg"
            />

            {/* Demo Accounts */}
            <TouchableOpacity
              onPress={() => setShowDemo(!showDemo)}
              style={styles.demoToggle}
              activeOpacity={0.7}
            >
              <Text style={[styles.demoToggleText, { fontFamily: 'Inter_500Medium' }]}>
                Use Demo Account
              </Text>
              <Feather
                name={showDemo ? 'chevron-up' : 'chevron-down'}
                size={16}
                color="#60A5FA"
              />
            </TouchableOpacity>

            {showDemo && (
              <View style={styles.demoList}>
                {DEMO_ACCOUNTS.map((acc, idx) => (
                  <TouchableOpacity
                    key={acc.role}
                    onPress={() => fillDemo(acc.email, acc.password)}
                    style={[
                      styles.demoItem,
                      idx < DEMO_ACCOUNTS.length - 1 && styles.demoItemBorder,
                    ]}
                    activeOpacity={0.7}
                  >
                    <View style={styles.demoLeft}>
                      <Text style={[styles.demoRole, { fontFamily: 'Inter_600SemiBold' }]}>
                        {acc.role}
                      </Text>
                      <Text style={[styles.demoEmail, { fontFamily: 'Inter_400Regular' }]}>
                        {acc.email}
                      </Text>
                    </View>
                    <View style={styles.demoRight}>
                      <Text style={[styles.demoPwd, { fontFamily: 'Inter_400Regular' }]}>
                        {acc.password}
                      </Text>
                      <Feather name="chevron-right" size={14} color="#3B82F6" />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <TouchableOpacity
            onPress={() => router.push('/(auth)/register')}
            style={styles.registerRow}
          >
            <Text style={[styles.registerText, { fontFamily: 'Inter_400Regular' }]}>
              Don't have an account?{' '}
              <Text style={{ color: '#60A5FA', fontFamily: 'Inter_600SemiBold' }}>
                Register
              </Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, gap: 28 },
  brand: { alignItems: 'center', gap: 10 },
  logoContainer: {
    width: 88,
    height: 88,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E40AF44',
    backgroundColor: '#1A2340',
  },
  logo: { width: '100%', height: '100%' },
  appName: { fontSize: 30, color: '#F1F5F9', letterSpacing: -0.5 },
  tagline: { fontSize: 13, color: '#64748B' },
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 24,
    gap: 16,
  },
  cardTitle: { fontSize: 22, color: '#F1F5F9' },
  cardSub: { fontSize: 14, color: '#64748B', marginTop: -8 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#7F1D1D22',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#EF444433',
  },
  errorText: { fontSize: 13, color: '#F87171', flex: 1 },
  forgotRow: { alignSelf: 'flex-end', marginTop: -4 },
  forgotText: { fontSize: 13, color: '#60A5FA' },
  demoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderStyle: 'dashed',
  },
  demoToggleText: { fontSize: 13, color: '#60A5FA' },
  demoList: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    overflow: 'hidden',
  },
  demoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#0B1120',
  },
  demoItemBorder: { borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  demoLeft: { flex: 1, gap: 2 },
  demoRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  demoRole: { fontSize: 13, color: '#F1F5F9' },
  demoEmail: { fontSize: 11, color: '#64748B' },
  demoPwd: { fontSize: 11, color: '#3B82F6' },
  registerRow: { alignItems: 'center' },
  registerText: { fontSize: 14, color: '#64748B' },
});
