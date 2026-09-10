import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button } from '@/components/ui/Button';
import { onBlue } from '@/constants/brand';

export default function TermsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const insets = useSafeAreaInsets();
  const colors = {
    foreground: onBlue.text,
    textMuted: onBlue.textSecondary,
    border: onBlue.line,
  };

  return (
    <View style={[styles.root, { backgroundColor: onBlue.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back to welcome">
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.wordmark, { color: colors.foreground }]}>AVARPUS</Text>
        </View>

        <View style={styles.content}>
          <Text style={[styles.eyebrow, { color: onBlue.textSecondary }]}>Before you continue</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Terms and Conditions</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            A quick summary of the rules that keep Avarpus safe and useful for every shop.
          </Text>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <TermSection title="Use of your account" text="Keep your sign-in details private and use Avarpus only for your own authorised business operations." colors={colors} />
          <TermSection title="Your business information" text="You are responsible for the accuracy of customer, repair, inventory, and financial information entered by your team." colors={colors} />
          <TermSection title="Secure access" text="We use mobile verification and access controls to help protect your workspace. Never share verification codes with anyone." colors={colors} />

          <View style={styles.buttonArea}>
            <Button
              title="Agree & Continue"
              variant="onBlue"
              onPress={async () => {
                await AsyncStorage.setItem('avarpus_terms_accepted', 'true');
                const nextRoute = params.next === 'register' ? '/(auth)/register' : '/(auth)/phone';
                router.replace(nextRoute as any);
              }}
              fullWidth
              size="lg"
              style={styles.primaryButton}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function TermSection({ title, text, colors }: { title: string; text: string; colors: { foreground: string; textMuted: string; border: string } }) {
  return (
    <View style={[styles.section, { borderBottomColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.sectionText, { color: colors.textMuted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' },
  wordmark: { fontSize: 12, letterSpacing: 2.4, fontFamily: 'Inter_700Bold' },
  content: { flex: 1, justifyContent: 'center', paddingVertical: 28, gap: 14 },
  eyebrow: { fontSize: 12, letterSpacing: 1.5, fontFamily: 'Inter_700Bold', textTransform: 'uppercase' },
  title: { fontSize: 28, lineHeight: 34, letterSpacing: -0.6, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  subtitle: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_500Medium' },
  divider: { height: 1, marginVertical: 14 },
  section: { paddingBottom: 16, marginBottom: 2, borderBottomWidth: 1 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 5 },
  sectionText: { fontSize: 14.5, lineHeight: 21, fontFamily: 'Inter_500Medium' },
  buttonArea: { width: '100%', height: 64, paddingHorizontal: 5, paddingBottom: 10, marginTop: 4 },
  primaryButton: { borderRadius: 28, minHeight: 54, maxHeight: 54 },
});
