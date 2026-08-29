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

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const handleNavigate = async (path: 'register' | 'phone') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const accepted = await AsyncStorage.getItem('avarpus_terms_accepted');
      if (accepted === 'true') {
        router.push(`/(auth)/${path}` as any);
      } else {
        router.push(`/(auth)/terms?next=${path}` as any);
      }
    } catch {
      router.push(`/(auth)/terms?next=${path}` as any);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={[colors.background, 'rgba(15, 98, 254, 0.08)', colors.background]}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <View style={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.center}>
          <View style={styles.logoContainer}>
            <LinearGradient
              colors={['rgba(15, 98, 254, 0.4)', 'transparent']}
              style={styles.glow}
              start={{ x: 0.5, y: 0.5 }}
              end={{ x: 0.5, y: 1 }}
            />
            <Image
              source={require('@/assets/images/avarpus-a-transparent-v2.png')}
              style={styles.logo}
              contentFit="contain"
              accessibilityLabel="Avarpus"
            />
          </View>
          <Text style={[styles.brand, { color: colors.foreground, textAlign: 'center' }]}>Welcome to Avarpus</Text>
          <Text style={[styles.tagline, { color: colors.gold }]}>Secure. Private. Connected.</Text>
        </View>

        <View style={styles.bottomBlock}>
          <Button
            title="Create Account"
            onPress={() => handleNavigate('register')}
            fullWidth
            size="lg"
            style={{ marginBottom: 16 }}
          />
          <Button
            title="Log In"
            onPress={() => handleNavigate('phone')}
            variant="outline"
            fullWidth
            size="lg"
            style={{ borderColor: colors.border }}
            textStyle={{ color: colors.foreground }}
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
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoContainer: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logo: { width: 130, height: 130 },
  glow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 70,
    transform: [{ scale: 1.5 }],
  },
  brand: { fontSize: 32, fontFamily: 'Inter_700Bold', letterSpacing: -0.5, marginBottom: 8 },
  tagline: { fontSize: 14, fontFamily: 'Inter_500Medium', letterSpacing: 0.2 },
  bottomBlock: { width: '100%', alignItems: 'center', paddingBottom: 10 },
  termsWrapper: { marginTop: 24, alignItems: 'center' },
  termsText: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
});
