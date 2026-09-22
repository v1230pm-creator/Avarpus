import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button } from '@/components/ui/Button';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { onBlue } from '@/constants/brand';
import { font, fontFamily } from '@/constants/typography';

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const logoFloat = useSharedValue(0);
  const logoEntrance = useSharedValue(0);
  const titleEntrance = useSharedValue(0);
  const detailEntrance = useSharedValue(0);
  const actionEntrance = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      logoEntrance.value = 1;
      titleEntrance.value = 1;
      detailEntrance.value = 1;
      actionEntrance.value = 1;
      return;
    }
    logoEntrance.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    titleEntrance.value = withDelay(160, withTiming(1, { duration: 560, easing: Easing.out(Easing.cubic) }));
    detailEntrance.value = withDelay(320, withTiming(1, { duration: 560, easing: Easing.out(Easing.cubic) }));
    actionEntrance.value = withDelay(500, withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }));
    logoFloat.value = withRepeat(
      withDelay(
        900,
        withSequence(
          withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        ),
      ),
      -1,
      true,
    );
  }, [actionEntrance, detailEntrance, logoEntrance, logoFloat, reducedMotion, titleEntrance]);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: 16 * (1 - logoEntrance.value) - 5 * logoFloat.value },
      { scale: 0.88 + logoEntrance.value * 0.12 + logoFloat.value * 0.025 },
    ],
    opacity: logoEntrance.value,
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleEntrance.value,
    transform: [{ translateY: 14 * (1 - titleEntrance.value) }],
  }));
  const detailStyle = useAnimatedStyle(() => ({
    opacity: detailEntrance.value,
    transform: [{ translateY: 12 * (1 - detailEntrance.value) }],
  }));
  const actionStyle = useAnimatedStyle(() => ({
    opacity: actionEntrance.value,
    transform: [{ translateY: 18 * (1 - actionEntrance.value) }],
  }));

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
    <View style={[styles.root, { backgroundColor: onBlue.background }]}>
      <View style={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.center}>
          <Animated.View style={[styles.logoContainer, logoStyle]}>
            <Image
              // The transparent mark, not the disc-backed logo. That asset
              // bakes in its own slightly different blue, which reads as a
              // shadow on this surface and visually clips the bubble tail.
              source={require('@/assets/images/avarpus-splash-mark.png')}
              style={styles.logo}
              contentFit="contain"
              accessibilityLabel="Avarpus"
            />
          </Animated.View>
          <Animated.View style={[styles.titleGroup, titleStyle]}>
            <Text style={[styles.welcome, { color: onBlue.textSecondary }]}>Welcome to</Text>
            <Text style={[styles.brand, { color: onBlue.text }]}>Avarpus</Text>
          </Animated.View>
          <Animated.View style={[styles.detailsGroup, detailStyle]}>
            <Text style={[styles.eyebrow, { color: onBlue.text }]}>SECURE BUSINESS NETWORK</Text>
            <View style={styles.taglineRow}>
              <View style={[styles.taglineLine, { backgroundColor: onBlue.line }]} />
              <Text style={[styles.tagline, { color: onBlue.textSecondary }]}>Secure · Private · Connected</Text>
              <View style={[styles.taglineLine, { backgroundColor: onBlue.line }]} />
            </View>
          </Animated.View>
        </View>

        <Animated.View style={[styles.bottomBlock, actionStyle]}>
          <View style={styles.buttonArea}>
            <Button
              title="Agree and Continue"
              onPress={handleLogin}
              variant="onBlue"
              fullWidth
              size="lg"
              style={styles.primaryButton}
            />
          </View>
          <View style={styles.termsWrapper}>
            <Text style={[styles.termsText, { color: onBlue.textMuted }]}>
              By continuing, you agree to our{'\n'}
              <Text style={styles.termsLink}>Terms & Privacy Policy</Text>
            </Text>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoContainer: {
    width: 150,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logo: { width: '100%', height: '100%' },
  titleGroup: { alignItems: 'center' },
  detailsGroup: { alignItems: 'center' },
  eyebrow: { ...font.overline, letterSpacing: 2.4, marginTop: 20 },
  welcome: { ...font.bodyStrong, letterSpacing: 0.2, marginBottom: 2 },
  brand: { ...font.display, fontFamily: fontFamily.semibold, letterSpacing: 2.2, textAlign: 'center' },
  taglineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  taglineLine: { width: 28, height: 1 },
  tagline: { ...font.smallStrong, letterSpacing: 0.8 },
  bottomBlock: { width: '100%', alignItems: 'center' },
  buttonArea: { width: '100%', height: 64, paddingHorizontal: 5, paddingBottom: 10 },
  primaryButton: { borderRadius: 28, minHeight: 54, maxHeight: 54 },
  termsWrapper: { marginTop: 24, alignItems: 'center' },
  termsText: { ...font.smallStrong, textAlign: 'center' },
  termsLink: { color: '#FFFFFF', fontFamily: fontFamily.semibold, textDecorationLine: 'underline' },
});
