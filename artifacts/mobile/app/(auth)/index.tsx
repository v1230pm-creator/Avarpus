import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { authOtpRequest } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type LoginTab = 'email' | 'mobile';

// Stable random particle data (seeded once)
const PARTICLES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  x: (i * 73 + 17) % SCREEN_W,
  startY: (i * 113 + 31) % SCREEN_H,
  size: (i % 3) + 1.5,
  duration: 7000 + (i % 5) * 1500,
  delay: i * 600,
  opacity: 0.08 + (i % 4) * 0.04,
}));

function Particle({ data }: { data: typeof PARTICLES[0] }) {
  const anim = useRef(new Animated.Value(data.startY)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: -30, duration: data.duration, useNativeDriver: true, delay: data.delay }),
        Animated.timing(anim, { toValue: SCREEN_H + 30, duration: 0, useNativeDriver: true }),
      ]),
    );
    const fade = Animated.loop(
      Animated.sequence([
        Animated.timing(opacityAnim, { toValue: data.opacity, duration: data.duration * 0.4, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: data.duration * 0.6, useNativeDriver: true }),
      ]),
    );
    loop.start();
    fade.start();
    return () => { loop.stop(); fade.stop(); };
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: data.x,
        width: data.size,
        height: data.size,
        borderRadius: data.size / 2,
        backgroundColor: '#4DA3FF',
        transform: [{ translateY: anim }],
        opacity: opacityAnim,
      }}
    />
  );
}

function GlowCircle({ style }: { style: object }) {
  return <View pointerEvents="none" style={[styles.glowCircle, style]} />;
}

function SecurityBadge({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) {
  return (
    <View style={styles.secBadge}>
      <Feather name={icon} size={12} color="#3A8FF7" />
      <Text style={[styles.secBadgeText, { fontFamily: 'Inter_500Medium' }]}>{label}</Text>
    </View>
  );
}

function RememberMeRow({ checked, onToggle, onForgot }: { checked: boolean; onToggle: () => void; onForgot: () => void }) {
  return (
    <View style={styles.rememberRow}>
      <TouchableOpacity onPress={onToggle} style={styles.checkboxRow} activeOpacity={0.7}>
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked && <Feather name="check" size={11} color="#FFFFFF" />}
        </View>
        <Text style={[styles.rememberText, { fontFamily: 'Inter_400Regular' }]}>Remember me</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onForgot} activeOpacity={0.7}>
        <Text style={[styles.forgotText, { fontFamily: 'Inter_500Medium' }]}>Forgot Password?</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function LoginScreen() {
  const { login, signedOutNotice, clearSignedOutNotice } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<LoginTab>('email');

  // Email form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);

  // Mobile form
  const [mobile, setMobile] = useState('');
  const [mobileFocused, setMobileFocused] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Entry animations
  const headerY = useSharedValue(30);
  const headerOpacity = useSharedValue(0);
  const cardY = useSharedValue(48);
  const cardOpacity = useSharedValue(0);
  const badgesOpacity = useSharedValue(0);

  // Tab indicator
  const tabX = useSharedValue(activeTab === 'email' ? 0 : 1);

  useEffect(() => {
    headerY.value = withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) });
    headerOpacity.value = withTiming(1, { duration: 700 });
    badgesOpacity.value = withDelay(200, withTiming(1, { duration: 600 }));
    cardY.value = withDelay(150, withSpring(0, { damping: 20, stiffness: 140 }));
    cardOpacity.value = withDelay(150, withTiming(1, { duration: 600 }));
  }, []);

  const headerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: headerY.value }],
    opacity: headerOpacity.value,
  }));
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardY.value }],
    opacity: cardOpacity.value,
  }));
  const badgesStyle = useAnimatedStyle(() => ({ opacity: badgesOpacity.value }));

  // scroll padding (24×2) + card padding (24×2) + tab internal padding (2×2) = 100
  const tabW = (SCREEN_W - 100) / 2;

  const tabIndicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(tabX.value === 0 ? 0 : tabW, { duration: 250, easing: Easing.out(Easing.cubic) }) }],
  }));

  const switchTab = (tab: LoginTab) => {
    setActiveTab(tab);
    tabX.value = tab === 'email' ? 0 : 1;
    setError('');
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password');
      return;
    }
    setLoading(true);
    setError('');
    clearSignedOutNotice();
    const result = await login(email.trim(), password, rememberMe);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Invalid credentials. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(auth)/biometric');
    }
  };

  const [otpLoading, setOtpLoading] = useState(false);

  const handleSendOtp = async () => {
    if (!mobile.trim() || mobile.length < 10) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    setError('');
    setOtpLoading(true);
    try {
      const res = await authOtpRequest({ mobile: mobile.trim() });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push({
        pathname: '/(auth)/otp',
        params: { mobile: mobile.trim(), rememberMe: rememberMe ? '1' : '0' },
      });
    } catch (err: any) {
      setError(err?.data?.message ?? 'Could not send OTP. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setOtpLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* Background */}
      <LinearGradient
        colors={['#0B0F1A', '#0E1422']}
        locations={[0, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Glow circles */}
      <GlowCircle style={{ top: -160, left: -100, width: 340, height: 340, backgroundColor: '#3A8FF7', opacity: 0.05 }} />
      <GlowCircle style={{ top: SCREEN_H * 0.3, right: -140, width: 280, height: 280, backgroundColor: '#2F80ED', opacity: 0.02 }} />
      <GlowCircle style={{ bottom: -120, left: SCREEN_W * 0.2, width: 240, height: 240, backgroundColor: '#3A8FF7', opacity: 0.03 }} />
      <GlowCircle style={{ top: SCREEN_H * 0.15, left: SCREEN_W * 0.5, width: 180, height: 180, backgroundColor: '#3A8FF7', opacity: 0.02 }} />

      {/* Particles */}
      {Platform.OS !== 'web' && PARTICLES.map((p) => <Particle key={p.id} data={p} />)}

              <KeyboardAwareScrollViewCompat
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, flexGrow: 1 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Centering wrapper: keep justifyContent OFF the scroll
              contentContainerStyle — with keyboard-controller on Android it
              causes layout jumps that can blur the focused input. */}
          <View style={{ flexGrow: 1, justifyContent: 'center', gap: 22 }}>
          {/* ── Logo ────────────────────────────────────────── */}
          <Reanimated.View style={[styles.logoWrap, headerStyle]}>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Image
                source={require('@/assets/images/vmc-text.png')}
                style={styles.logoImg}
                contentFit="contain"
              />
              <Text style={[styles.electronicText, { fontFamily: 'Inter_500Medium' }]}>ELECTRONIC</Text>
              <Image
                source={require('@/assets/images/vmc-hands.png')}
                style={styles.handsImg}
                contentFit="contain"
              />
            </View>
            <Text style={[styles.tagline, { fontFamily: 'Inter_400Regular' }]}>Business Management System</Text>
          </Reanimated.View>

          {/* ── Glass Card ──────────────────────────────────── */}
          <Reanimated.View style={[styles.cardOuter, cardStyle]}>
            {Platform.OS === 'ios' ? (
              <BlurView intensity={25} tint="dark" style={StyleSheet.absoluteFill} />
            ) : null}
            <View style={styles.cardInner}>
              {/* Card header */}
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { fontFamily: 'Inter_700Bold' }]}>Welcome Back</Text>
                <Text style={[styles.cardSub, { fontFamily: 'Inter_400Regular' }]}>
                  Sign in to manage your business securely.
                </Text>
              </View>

              {/* Tabs */}
              <View style={styles.tabContainer}>
                <Reanimated.View style={[styles.tabIndicator, { width: tabW }, tabIndicatorStyle]} />
                <TouchableOpacity
                  onPress={() => switchTab('email')}
                  style={[styles.tabBtn, { width: tabW }]}
                  activeOpacity={0.8}
                >
                  <Feather name="mail" size={14} color={activeTab === 'email' ? '#FFFFFF' : '#A8B3C7'} />
                  <Text style={[styles.tabText, {
                    color: activeTab === 'email' ? '#FFFFFF' : '#A8B3C7',
                    fontFamily: activeTab === 'email' ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  }]}>Email</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => switchTab('mobile')}
                  style={[styles.tabBtn, { width: tabW }]}
                  activeOpacity={0.8}
                >
                  <Feather name="smartphone" size={14} color={activeTab === 'mobile' ? '#FFFFFF' : '#A8B3C7'} />
                  <Text style={[styles.tabText, {
                    color: activeTab === 'mobile' ? '#FFFFFF' : '#A8B3C7',
                    fontFamily: activeTab === 'mobile' ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  }]}>Mobile OTP</Text>
                </TouchableOpacity>
              </View>

              {/* Signed-out notice (e.g. session revoked from another device) */}
              {!!signedOutNotice && !error && (
                <View style={[styles.otpInfo, { borderColor: 'rgba(47, 128, 237, 0.16)' }]}>
                  <Feather name="info" size={13} color="#4DA3FF" />
                  <Text style={[styles.otpInfoText, { fontFamily: 'Inter_400Regular' }]}>{signedOutNotice}</Text>
                </View>
              )}

              {/* Error */}
              {!!error && (
                <View style={styles.errorBox}>
                  <Feather name="alert-circle" size={14} color="#EF4444" />
                  <Text style={[styles.errorText, { fontFamily: 'Inter_400Regular' }]}>{error}</Text>
                </View>
              )}

              {/* ── Email Form ── */}
              {activeTab === 'email' && (
                <View style={styles.form}>
                  {/* Email */}
                  <View style={styles.fieldWrap}>
                    <Text style={[styles.fieldLabel, { fontFamily: 'Inter_500Medium' }]}>Email Address</Text>
                    <View collapsable={false} style={[styles.inputRow, emailFocused && styles.inputFocused]}>
                      <Feather name="mail" size={16} color={emailFocused ? '#3A8FF7' : '#7F8BA3'} />
                      <TextInput
                        value={email}
                        onChangeText={setEmail}
                        placeholder="Enter email id"
                        placeholderTextColor="#7F8BA3"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        onFocus={() => setEmailFocused(true)}
                        onBlur={() => setEmailFocused(false)}
                        style={[styles.textInput, { fontFamily: 'Inter_400Regular', color: '#F5F7FA' }]}
                      />
                    </View>
                  </View>

                  {/* Password */}
                  <View style={styles.fieldWrap}>
                    <Text style={[styles.fieldLabel, { fontFamily: 'Inter_500Medium' }]}>Password</Text>
                    <View collapsable={false} style={[styles.inputRow, passFocused && styles.inputFocused]}>
                      <Feather name="lock" size={16} color={passFocused ? '#3A8FF7' : '#7F8BA3'} />
                      <TextInput
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Enter password"
                        placeholderTextColor="#7F8BA3"
                        secureTextEntry={!showPassword}
                        onFocus={() => setPassFocused(true)}
                        onBlur={() => setPassFocused(false)}
                        returnKeyType="done"
                        onSubmitEditing={handleSignIn}
                        style={[styles.textInput, { fontFamily: 'Inter_400Regular', color: '#F5F7FA' }]}
                      />
                      <TouchableOpacity onPress={() => setShowPassword((v) => !v)} activeOpacity={0.7}>
                        <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color="#7F8BA3" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <RememberMeRow
                    checked={rememberMe}
                    onToggle={() => setRememberMe((v) => !v)}
                    onForgot={() => router.push('/(auth)/forgot')}
                  />

                  {/* Sign In */}
                  <GradientButton title="Sign In" onPress={handleSignIn} loading={loading} icon="arrow-right" />

                  {/* OTP alternative */}
                  <TouchableOpacity
                    onPress={() => switchTab('mobile')}
                    style={styles.altBtn}
                    activeOpacity={0.7}
                  >
                    <Feather name="smartphone" size={15} color="#4DA3FF" />
                    <Text style={[styles.altBtnText, { fontFamily: 'Inter_500Medium' }]}>Login with OTP</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Mobile OTP Form ── */}
              {activeTab === 'mobile' && (
                <View style={styles.form}>
                  <View style={styles.fieldWrap}>
                    <Text style={[styles.fieldLabel, { fontFamily: 'Inter_500Medium' }]}>Mobile Number</Text>
                    <View collapsable={false} style={[styles.inputRow, mobileFocused && styles.inputFocused]}>
                      {/* Country code */}
                      <View style={styles.countryCode}>
                        
                        <Text style={[styles.countryDial, { fontFamily: 'Inter_600SemiBold' }]}>+91</Text>
                        <View style={styles.codeDivider} />
                      </View>
                      <TextInput
                        value={mobile}
                        onChangeText={(t) => setMobile(t.replace(/[^0-9]/g, '').slice(0, 10))}
                        placeholder="Enter mobile number"
                        placeholderTextColor="#7F8BA3"
                        keyboardType="phone-pad"
                        maxLength={10}
                        onFocus={() => setMobileFocused(true)}
                        onBlur={() => setMobileFocused(false)}
                        style={[styles.textInput, { fontFamily: 'Inter_400Regular', color: '#F5F7FA' }]}
                      />
                      <Text style={[styles.digitCount, { fontFamily: 'Inter_400Regular' }]}>{mobile.length}/10</Text>
                    </View>
                  </View>

                  <View style={[styles.otpInfo, { borderColor: 'rgba(47, 128, 237, 0.16)' }]}>
                    <Feather name="info" size={13} color="#4DA3FF" />
                    <Text style={[styles.otpInfoText, { fontFamily: 'Inter_400Regular' }]}>
                      A 6-digit OTP will be sent to your registered mobile number.
                    </Text>
                  </View>

                  <TouchableOpacity
                    onPress={() => setRememberMe(!rememberMe)}
                    style={styles.checkboxRow}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                      {rememberMe && <Feather name="check" size={11} color="#FFFFFF" />}
                    </View>
                    <Text style={[styles.rememberText, { fontFamily: 'Inter_400Regular' }]}>Remember me</Text>
                  </TouchableOpacity>

                  <GradientButton title="Send OTP" onPress={handleSendOtp} loading={otpLoading} icon="send" />

                  <TouchableOpacity
                    onPress={() => switchTab('email')}
                    style={styles.altBtn}
                    activeOpacity={0.7}
                  >
                    <Feather name="mail" size={15} color="#4DA3FF" />
                    <Text style={[styles.altBtnText, { fontFamily: 'Inter_500Medium' }]}>Sign in with Email instead</Text>
                  </TouchableOpacity>
                </View>
              )}

            </View>
          </Reanimated.View>

          {/* ── Bottom ──────────────────────────────────────── */}
          <View style={styles.bottomSection}>
            <TouchableOpacity
              onPress={() => router.push('/(auth)/register')}
              activeOpacity={0.7}
            >
              <Text style={[styles.registerText, { fontFamily: 'Inter_400Regular' }]}>
                Don't have an account?{' '}
                <Text style={[styles.registerLink, { fontFamily: 'Inter_600SemiBold' }]}>Create Account</Text>
              </Text>
            </TouchableOpacity>

            <View style={styles.legalRow}>
              <TouchableOpacity activeOpacity={0.7}>
                <Text style={[styles.legalText, { fontFamily: 'Inter_400Regular' }]}>Privacy Policy</Text>
              </TouchableOpacity>
              <View style={styles.legalDot} />
              <TouchableOpacity activeOpacity={0.7}>
                <Text style={[styles.legalText, { fontFamily: 'Inter_400Regular' }]}>Terms & Conditions</Text>
              </TouchableOpacity>
            </View>
          </View>
          </View>
        </KeyboardAwareScrollViewCompat>
    </View>
  );
}

// Blue gradient CTA button
function GradientButton({ title, onPress, loading, icon }: { title: string; onPress: () => void; loading: boolean; icon: keyof typeof Feather.glyphMap }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Reanimated.View style={animStyle}>
      <TouchableOpacity
        onPress={onPress}
        disabled={loading}
        onPressIn={() => { scale.value = withSpring(0.97, { damping: 15 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 15 }); }}
        activeOpacity={1}
      >
        <LinearGradient
          colors={['#2F80ED', '#3A8FF7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradBtn}
        >
          {loading ? (
            <LoadingDots />
          ) : (
            <>
              <Text style={[styles.gradBtnText, { fontFamily: 'Inter_600SemiBold' }]}>{title}</Text>
              <Feather name={icon} size={18} color="#FFFFFF" />
            </>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </Reanimated.View>
  );
}

function LoadingDots() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makeDot = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: -6, duration: 300, delay, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(300),
        ]),
      );
    const a1 = makeDot(dot1, 0);
    const a2 = makeDot(dot2, 120);
    const a3 = makeDot(dot3, 240);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
      {[dot1, dot2, dot3].map((d, i) => (
        <Animated.View
          key={i}
          style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFFFFF', transform: [{ translateY: d }] }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  glowCircle: { position: 'absolute', borderRadius: 999 },
  scroll: { paddingHorizontal: 24, gap: 22 },

  // Logo
  logoWrap: { alignItems: 'center', gap: 2 },
  logoImg: { width: 200, height: 50 },
  electronicText: { fontSize: 13, color: '#A8B3C7', letterSpacing: 5, marginTop: 4 },
  adminBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: 'rgba(47, 128, 237, 0.10)', borderWidth: 1, borderColor: 'rgba(47, 128, 237, 0.16)',
  },
  adminBadgeText: { fontSize: 11, color: '#3A8FF7', letterSpacing: 1.5 },
  handsImg: { width: 190, height: 40, marginTop: 2 },

  // Header
  header: { alignItems: 'center', gap: 8 },
  monogram: {
    width: 72, height: 72, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
    shadowColor: '#3A8FF7', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
    elevation: 10, marginBottom: 4,
  },
  monogramText: { fontSize: 22, color: '#FFFFFF', letterSpacing: 1 },
  goldDot: {
    position: 'absolute', top: -3, right: -3,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#3A8FF7',
    borderWidth: 2, borderColor: '#0B0F1A',
  },
  appName: { fontSize: 30, color: '#F5F7FA', letterSpacing: -0.5 },
  tagline: { fontSize: 13, color: '#A8B3C7', letterSpacing: 0.2 },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  versionDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#3A8FF7' },
  version: { fontSize: 11, color: '#3A8FF7', letterSpacing: 0.5 },

  // Security badges
  secRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 0, backgroundColor: 'rgba(17, 27, 45, 0.68)', borderRadius: 30,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', paddingVertical: 10, paddingHorizontal: 16,
  },
  secBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  secBadgeText: { fontSize: 11, color: '#A8B3C7' },
  secDivider: { width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 12 },

  // Glass card
  cardOuter: {
    borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: Platform.OS === 'ios' ? 'rgba(20, 30, 48, 0.58)' : 'rgba(20, 30, 48, 0.58)',
    shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cardInner: { padding: 24, gap: 16 },
  cardHeader: { gap: 4 },
  cardTitle: { fontSize: 22, color: '#F5F7FA' },
  cardSub: { fontSize: 13, color: '#A8B3C7', lineHeight: 19 },

  // Tabs
  tabContainer: {
    flexDirection: 'row', backgroundColor: 'rgba(17, 27, 45, 0.68)', borderRadius: 12,
    padding: 2, position: 'relative', height: 44, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  tabIndicator: {
    position: 'absolute', top: 2, left: 2, bottom: 2,
    backgroundColor: '#3A8FF7', borderRadius: 10,
  },
  tabBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, zIndex: 1 },
  tabText: { fontSize: 13 },

  // Error
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.10)', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.16)',
  },
  errorText: { fontSize: 12, color: '#EF4444', flex: 1, lineHeight: 18 },

  // Form
  form: { gap: 14 },
  fieldWrap: { gap: 7 },
  fieldLabel: { fontSize: 12, color: '#A8B3C7', letterSpacing: 0.3 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(17, 27, 45, 0.68)', borderRadius: 12, paddingHorizontal: 14, height: 52,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  inputFocused: { borderColor: '#3A8FF7', shadowColor: '#3A8FF7', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  textInput: { flex: 1, fontSize: 14, height: '100%' as any },
  countryCode: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countryFlag: { fontSize: 16 },
  countryDial: { fontSize: 13, color: '#F5F7FA' },
  codeDivider: { width: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.10)', marginLeft: 6 },
  digitCount: { fontSize: 11, color: '#7F8BA3' },

  // Remember Me
  rememberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: {
    width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(17, 27, 45, 0.68)', alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#3A8FF7', borderColor: '#3A8FF7' },
  rememberText: { fontSize: 13, color: '#A8B3C7' },
  forgotText: { fontSize: 13, color: '#4DA3FF' },

  // Gradient button
  gradBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    height: 54, borderRadius: 14,
    shadowColor: '#3A8FF7', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  gradBtnText: { fontSize: 16, color: '#FFFFFF' },

  // Alt button
  altBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(17, 27, 45, 0.68)',
  },
  altBtnText: { fontSize: 13, color: '#4DA3FF' },

  // OTP info
  otpInfo: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(20, 30, 48, 0.58)', borderRadius: 10, padding: 12, borderWidth: 1,
  },
  otpInfoText: { fontSize: 12, color: '#A8B3C7', flex: 1, lineHeight: 18 },

  // Bottom
  bottomSection: { alignItems: 'center', gap: 14 },
  registerText: { fontSize: 13, color: '#A8B3C7', textAlign: 'center' },
  registerLink: { color: '#4DA3FF' },
  legalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legalText: { fontSize: 11, color: 'rgba(255,255,255,0.10)' },
  legalDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.10)' },
});
