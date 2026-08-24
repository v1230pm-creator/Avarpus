import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');

  const handleContinue = async () => {
    if (!accepted) {
      setError('Please agree to the Terms and Conditions to continue.');
      return;
    }
    setError('');
    await AsyncStorage.setItem('avarpus_terms_accepted', 'true');
    router.push('/(auth)/sim-verify');
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topbar}>
          <Text style={[styles.wordmark, { color: colors.primary }]}>AVARPUS</Text>
          <Text style={[styles.step, { color: colors.textMuted }]}>1 of 2</Text>
        </View>

        <View style={styles.hero}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>A calmer way to run your shop</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Welcome to Avarpus</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Your trusted workspace for repairs, customers, inventory, and the people who keep your business moving.
          </Text>
        </View>

        <View style={styles.action}>
          <View style={styles.trustLine}>
            <Feather name="shield" size={20} color={colors.primary} />
            <Text style={[styles.trustText, { color: colors.foreground }]}>Private, secure, and built for your business</Text>
          </View>

          <TouchableOpacity
            onPress={() => router.push('/(auth)/terms')}
            style={styles.termsLink}
            activeOpacity={0.7}
            accessibilityRole="link"
          >
            <Text style={[styles.termsText, { color: colors.textMuted }]}>Read the </Text>
            <Text style={[styles.termsText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Terms and Conditions</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setAccepted(!accepted);
              setError('');
            }}
            style={styles.checkboxRow}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
          >
            <View style={[styles.checkbox, { borderColor: accepted ? colors.primary : colors.border, backgroundColor: accepted ? colors.primary : colors.input }]}>
              {accepted && <Feather name="check" size={13} color="#FFFFFF" />}
            </View>
            <Text style={[styles.consentText, { color: colors.foreground }]}>I agree to the Terms and Conditions</Text>
          </TouchableOpacity>

          {!!error && (
            <View style={[styles.alertBox, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '30' }]}>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text style={[styles.alertText, { color: colors.destructive }]}>{error}</Text>
            </View>
          )}

          <Button title="Continue" onPress={handleContinue} fullWidth size="lg" />
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textMuted }]}>© {new Date().getFullYear()} Avarpus</Text>
          <Text style={[styles.footerText, { color: colors.textMuted }]}>Business operations, made simple.</Text>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, gap: 30 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { fontSize: 12, letterSpacing: 2.4, fontFamily: 'Inter_700Bold' },
  step: { fontSize: 12, letterSpacing: 1, fontFamily: 'Inter_500Medium', textTransform: 'uppercase' },
  hero: { flex: 1, justifyContent: 'center', paddingVertical: 24, gap: 12 },
  eyebrow: { fontSize: 12, letterSpacing: 1.5, fontFamily: 'Inter_700Bold', textTransform: 'uppercase' },
  title: { fontSize: 44, lineHeight: 48, letterSpacing: -1.5, fontFamily: 'Inter_700Bold' },
  subtitle: { maxWidth: 520, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_400Regular' },
  action: { gap: 16 },
  trustLine: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  trustText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_600SemiBold' },
  termsLink: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  termsText: { fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' },
  consentText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' },
  alertBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 8, borderWidth: 1 },
  alertText: { fontSize: 13, flex: 1, fontFamily: 'Inter_500Medium', lineHeight: 18 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 4 },
  footerText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
});
