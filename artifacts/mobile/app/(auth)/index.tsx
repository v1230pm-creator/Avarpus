import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

function PremiumWaves() {
  return (
    <View pointerEvents="none" style={styles.waves}>
      <Svg width="100%" height="100%" viewBox="0 0 420 520" preserveAspectRatio="none">
        <Defs>
          <SvgGradient id="welcomeWave" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#0F62FE" stopOpacity="0" />
            <Stop offset="0.28" stopColor="#258DFF" stopOpacity="0.7" />
            <Stop offset="0.55" stopColor="#77D5FF" stopOpacity="0.95" />
            <Stop offset="0.82" stopColor="#258DFF" stopOpacity="0.62" />
            <Stop offset="1" stopColor="#0F62FE" stopOpacity="0" />
          </SvgGradient>
        </Defs>
        <Path d="M-30 145 C65 58 132 225 230 139 S374 56 465 150" fill="none" stroke="url(#welcomeWave)" strokeWidth="1.4" />
        <Path d="M-35 166 C60 79 128 246 226 160 S370 77 460 171" fill="none" stroke="url(#welcomeWave)" strokeWidth="0.7" strokeDasharray="3 8" />
        <Path d="M-45 390 C48 303 122 470 218 384 S365 301 470 397" fill="none" stroke="url(#welcomeWave)" strokeWidth="1.1" />
        <Path d="M-45 411 C48 324 122 491 218 405 S365 322 470 418" fill="none" stroke="url(#welcomeWave)" strokeWidth="0.6" strokeDasharray="2 9" />
      </Svg>
    </View>
  );
}

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const handleLogin = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const accepted = await AsyncStorage.getItem('avarpus_terms_accepted');
      if (accepted === 'true') {
        router.push('/(auth)/phone');
      } else {
        router.push('/(auth)/terms?next=phone');
      }
    } catch {
      router.push('/(auth)/terms?next=phone');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={[colors.background, 'rgba(4, 38, 94, 0.36)', colors.background]}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <PremiumWaves />
      <View style={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.center}>
          <View style={styles.logoContainer}>
            <Image
              source={require('@/assets/images/avarpus-a-transparent-v2.png')}
              style={styles.logo}
              contentFit="contain"
              accessibilityLabel="Avarpus"
            />
          </View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>SECURE BUSINESS NETWORK</Text>
          <Text style={[styles.welcome, { color: colors.mutedForeground }]}>Welcome to</Text>
          <Text style={[styles.brand, { color: colors.foreground }]}>AVARPUS</Text>
          <View style={styles.taglineRow}>
            <View style={[styles.taglineLine, { backgroundColor: colors.gold }]} />
            <Text style={[styles.tagline, { color: colors.gold }]}>Secure · Private · Connected</Text>
            <View style={[styles.taglineLine, { backgroundColor: colors.gold }]} />
          </View>
        </View>

        <View style={styles.bottomBlock}>
          <Button
            title="Log In"
            onPress={handleLogin}
            fullWidth
            size="lg"
          />
          <View style={styles.termsWrapper}>
            <Text style={[styles.termsText, { color: colors.mutedForeground }]}>
              By continuing, you agree to our{'\n'}
              <Text style={{ color: colors.primary, fontFamily: 'Inter_500Medium' }}>Terms & Privacy Policy</Text>
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  waves: { ...StyleSheet.absoluteFillObject, opacity: 0.85 },
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoContainer: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logo: { width: 138, height: 138 },
  eyebrow: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 2.4, marginBottom: 18 },
  welcome: { fontSize: 17, fontFamily: 'Inter_500Medium', letterSpacing: 0.2, marginBottom: 2 },
  brand: { fontSize: 38, fontFamily: 'Inter_700Bold', letterSpacing: 5, textAlign: 'center' },
  taglineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  taglineLine: { width: 28, height: StyleSheet.hairlineWidth, opacity: 0.75 },
  tagline: { fontSize: 11, fontFamily: 'Inter_500Medium', letterSpacing: 0.8 },
  bottomBlock: { width: '100%', alignItems: 'center', paddingBottom: 10 },
  termsWrapper: { marginTop: 24, alignItems: 'center' },
  termsText: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
});
