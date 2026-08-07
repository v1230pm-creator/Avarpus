import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
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
import { useAuth } from '@/context/AuthContext';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const DEMO_ACCOUNTS = [
  { role: 'Super Admin',    email: 'superadmin@vmc.com', password: 'Admin@123' },
  { role: 'Dealer / Owner', email: 'dealer@vmc.com',     password: 'Dealer@123' },
  { role: 'Reception',      email: 'reception@vmc.com',  password: 'Staff@123' },
  { role: 'Technician',     email: 'tech@vmc.com',       password: 'Tech@123' },
  { role: 'Store Manager',  email: 'store@vmc.com',      password: 'Store@123' },
  { role: 'Accountant',     email: 'accounts@vmc.com',   password: 'Accts@123' },
];

type LoginTab = 'email' | 'mobile';

// Stable random particle data (seeded once)
const PARTICLES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  x: (i * 73 + 17) % SCREEN_W,
  startY: (i * 113 + 31) % SCREEN_H,
  size: (i % 3) + 1.5,
  duration: 7000 + (i % 5) * 1500,
  delay: i * 600,
  opacity: 0.12 + (i % 4) * 0.06,
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
      style={{
        position: 'absolute',
        left: data.x,
        width: data.size,
        height: data.size,
        borderRadius: data.size / 2,
        backgroundColor: '#60A5FA',
        transform: [{ translateY: anim }],
        opacity: opacityAnim,
      }}
    />
  );
}

function GlowCircle({ style }: { style: object }) {
  return <View style={[styles.glowCircle, style]} />;
}

function SecurityBadge({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) {
  return (
    <View style={styles.secBadge}>
      <Feather name={icon} size={12} color="#D4AF37" />
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
  const { login } = useAuth();
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
  const [showDemo, setShowDemo] = useState(false);

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

  const tabIndicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(tabX.value === 0 ? 0 : (SCREEN_W - 48 - 4) / 2, { duration: 250, easing: Easing.out(Easing.cubic) }) }],
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
    const result = await login(email.trim(), password);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Invalid credentials. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    }
  };

  const handleSendOtp = () => {
    if (!mobile.trim() || mobile.length < 10) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    setError('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/(auth)/otp');
  };

  const fillDemo = (acc: typeof DEMO_ACCOUNTS[0]) => {
    setEmail(acc.email);
    setPassword(acc.password);
    setActiveTab('email');
    tabX.value = 0;
    setShowDemo(false);
    setError('');
  };

  const tabW = (SCREEN_W - 48 - 4) / 2;

  return (
    <View style={styles.root}>
      {/* Background */}
      <LinearGradient
        colors={['#050912', '#091525', '#030710']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Glow circles */}
      <GlowCircle style={{ top: -160, left: -100, width: 340, height: 340, backgroundColor: '#2563EB', opacity: 0.1 }} />
      <GlowCircle style={{ top: SCREEN_H * 0.3, right: -140, width: 280, height: 280, backgroundColor: '#1D4ED8', opacity: 0.08 }} />
      <GlowCircle style={{ bottom: -120, left: SCREEN_W * 0.2, width: 240, height: 240, backgroundColor: '#3B82F6', opacity: 0.06 }} />
      <GlowCircle style={{ top: SCREEN_H * 0.15, left: SCREEN_W * 0.5, width: 180, height: 180, backgroundColor: '#D4AF37', opacity: 0.04 }} />

      {/* Particles */}
      {Platform.OS !== 'web' && PARTICLES.map((p) => <Particle key={p.id} data={p} />)}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
                  <Feather name="mail" size={14} color={activeTab === 'email' ? '#FFFFFF' : '#64748B'} />
                  <Text style={[styles.tabText, {
                    color: activeTab === 'email' ? '#FFFFFF' : '#64748B',
                    fontFamily: activeTab === 'email' ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  }]}>Email</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => switchTab('mobile')}
                  style={[styles.tabBtn, { width: tabW }]}
                  activeOpacity={0.8}
                >
                  <Feather name="smartphone" size={14} color={activeTab === 'mobile' ? '#FFFFFF' : '#64748B'} />
                  <Text style={[styles.tabText, {
                    color: activeTab === 'mobile' ? '#FFFFFF' : '#64748B',
                    fontFamily: activeTab === 'mobile' ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  }]}>Mobile OTP</Text>
                </TouchableOpacity>
              </View>

              {/* Error */}
              {!!error && (
                <View style={styles.errorBox}>
                  <Feather name="alert-circle" size={14} color="#F87171" />
                  <Text style={[styles.errorText, { fontFamily: 'Inter_400Regular' }]}>{error}</Text>
                </View>
              )}

              {/* ── Email Form ── */}
              {activeTab === 'email' && (
                <View style={styles.form}>
                  {/* Email */}
                  <View style={styles.fieldWrap}>
                    <Text style={[styles.fieldLabel, { fontFamily: 'Inter_500Medium' }]}>Email Address</Text>
                    <View style={[styles.inputRow, emailFocused && styles.inputFocused]}>
                      <Feather name="mail" size={16} color={emailFocused ? '#3B82F6' : '#475569'} />
                      <TextInput
                        value={email}
                        onChangeText={setEmail}
                        placeholder="name@company.com"
                        placeholderTextColor="#475569"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        onFocus={() => setEmailFocused(true)}
                        onBlur={() => setEmailFocused(false)}
                        style={[styles.textInput, { fontFamily: 'Inter_400Regular', color: '#F1F5F9' }]}
                      />
                    </View>
                  </View>

                  {/* Password */}
                  <View style={styles.fieldWrap}>
                    <Text style={[styles.fieldLabel, { fontFamily: 'Inter_500Medium' }]}>Password</Text>
                    <View style={[styles.inputRow, passFocused && styles.inputFocused]}>
                      <Feather name="lock" size={16} color={passFocused ? '#3B82F6' : '#475569'} />
                      <TextInput
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Enter password"
                        placeholderTextColor="#475569"
                        secureTextEntry={!showPassword}
                        onFocus={() => setPassFocused(true)}
                        onBlur={() => setPassFocused(false)}
                        returnKeyType="done"
                        onSubmitEditing={handleSignIn}
                        style={[styles.textInput, { fontFamily: 'Inter_400Regular', color: '#F1F5F9' }]}
                      />
                      <TouchableOpacity onPress={() => setShowPassword((v) => !v)} activeOpacity={0.7}>
                        <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color="#475569" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <RememberMeRow
                    checked={rememberMe}
                    onToggle={() => setRememberMe((v) => !v)}
                    onForgot={() => {}}
                  />

                  {/* Sign In */}
                  <GradientButton title="Sign In" onPress={handleSignIn} loading={loading} icon="arrow-right" />

                  {/* OTP alternative */}
                  <TouchableOpacity
                    onPress={() => switchTab('mobile')}
                    style={styles.altBtn}
                    activeOpacity={0.7}
                  >
                    <Feather name="smartphone" size={15} color="#60A5FA" />
                    <Text style={[styles.altBtnText, { fontFamily: 'Inter_500Medium' }]}>Continue with OTP instead</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Mobile OTP Form ── */}
              {activeTab === 'mobile' && (
                <View style={styles.form}>
                  <View style={styles.fieldWrap}>
                    <Text style={[styles.fieldLabel, { fontFamily: 'Inter_500Medium' }]}>Mobile Number</Text>
                    <View style={[styles.inputRow, mobileFocused && styles.inputFocused]}>
                      {/* Country code */}
                      <View style={styles.countryCode}>
                        <Text style={[styles.countryFlag, { fontFamily: 'Inter_400Regular' }]}>🇮🇳</Text>
                        <Text style={[styles.countryDial, { fontFamily: 'Inter_600SemiBold' }]}>+91</Text>
                        <View style={styles.codeDivider} />
                      </View>
                      <TextInput
                        value={mobile}
                        onChangeText={(t) => setMobile(t.replace(/[^0-9]/g, '').slice(0, 10))}
                        placeholder="Enter mobile number"
                        placeholderTextColor="#475569"
                        keyboardType="phone-pad"
                        maxLength={10}
                        onFocus={() => setMobileFocused(true)}
                        onBlur={() => setMobileFocused(false)}
                        style={[styles.textInput, { fontFamily: 'Inter_400Regular', color: '#F1F5F9' }]}
                      />
                      <Text style={[styles.digitCount, { fontFamily: 'Inter_400Regular' }]}>{mobile.length}/10</Text>
                    </View>
                  </View>

                  <View style={[styles.otpInfo, { borderColor: '#2563EB33' }]}>
                    <Feather name="info" size={13} color="#60A5FA" />
                    <Text style={[styles.otpInfoText, { fontFamily: 'Inter_400Regular' }]}>
                      A 6-digit OTP will be sent to your registered mobile number.
                    </Text>
                  </View>

                  <GradientButton title="Send OTP" onPress={handleSendOtp} loading={false} icon="send" />

                  <TouchableOpacity
                    onPress={() => switchTab('email')}
                    style={styles.altBtn}
                    activeOpacity={0.7}
                  >
                    <Feather name="mail" size={15} color="#60A5FA" />
                    <Text style={[styles.altBtnText, { fontFamily: 'Inter_500Medium' }]}>Sign in with Email instead</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Demo Accounts ── */}
              <TouchableOpacity
                onPress={() => { setShowDemo((v) => !v); Haptics.selectionAsync(); }}
                style={styles.demoToggle}
                activeOpacity={0.7}
              >
                <View style={styles.demoDots}>
                  <View style={[styles.demoDot, { backgroundColor: '#2563EB' }]} />
                  <View style={[styles.demoDot, { backgroundColor: '#D4AF37' }]} />
                  <View style={[styles.demoDot, { backgroundColor: '#10B981' }]} />
                </View>
                <Text style={[styles.demoToggleText, { fontFamily: 'Inter_500Medium' }]}>
                  {showDemo ? 'Hide' : 'Use'} Demo Account
                </Text>
                <Feather name={showDemo ? 'chevron-up' : 'chevron-down'} size={15} color="#60A5FA" />
              </TouchableOpacity>

              {showDemo && (
                <View style={styles.demoList}>
                  {DEMO_ACCOUNTS.map((acc, idx) => (
                    <TouchableOpacity
                      key={acc.role}
                      onPress={() => fillDemo(acc)}
                      activeOpacity={0.75}
                      style={[
                        styles.demoItem,
                        idx < DEMO_ACCOUNTS.length - 1 && styles.demoItemBorder,
                      ]}
                    >
                      <View style={[styles.demoAvatar, { backgroundColor: ROLE_COLORS[idx] + '22' }]}>
                        <Text style={[styles.demoAvatarText, { color: ROLE_COLORS[idx], fontFamily: 'Inter_700Bold' }]}>
                          {acc.role[0]}
                        </Text>
                      </View>
                      <View style={styles.demoInfo}>
                        <Text style={[styles.demoRole, { fontFamily: 'Inter_600SemiBold' }]}>{acc.role}</Text>
                        <Text style={[styles.demoEmail, { fontFamily: 'Inter_400Regular' }]}>{acc.email}</Text>
                      </View>
                      <View style={styles.demoRight}>
                        <Text style={[styles.demoPwd, { fontFamily: 'Inter_400Regular' }]}>{acc.password}</Text>
                        <Feather name="corner-down-left" size={13} color="#3B82F6" />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </Reanimated.View>

          {/* ── Bottom ──────────────────────────────────────── */}
          <View style={styles.bottomSection}>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')} activeOpacity={0.7}>
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
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// Role avatar colors
const ROLE_COLORS = ['#DC2626', '#7C3AED', '#0284C7', '#059669', '#D97706', '#64748B'];

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
          colors={['#1D4ED8', '#2563EB', '#3B82F6']}
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

  // Header
  header: { alignItems: 'center', gap: 8 },
  monogram: {
    width: 72, height: 72, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
    shadowColor: '#2563EB', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
    elevation: 10, marginBottom: 4,
  },
  monogramText: { fontSize: 22, color: '#FFFFFF', letterSpacing: 1 },
  goldDot: {
    position: 'absolute', top: -3, right: -3,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#D4AF37',
    borderWidth: 2, borderColor: '#050912',
  },
  appName: { fontSize: 30, color: '#F1F5F9', letterSpacing: -0.5 },
  tagline: { fontSize: 13, color: '#64748B', letterSpacing: 0.2 },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  versionDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#D4AF37' },
  version: { fontSize: 11, color: '#D4AF37', letterSpacing: 0.5 },

  // Security badges
  secRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 0, backgroundColor: '#0D1C35', borderRadius: 30,
    borderWidth: 1, borderColor: '#1E3A5F55', paddingVertical: 10, paddingHorizontal: 16,
  },
  secBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  secBadgeText: { fontSize: 11, color: '#94A3B8' },
  secDivider: { width: 1, height: 14, backgroundColor: '#1E3A5F', marginHorizontal: 12 },

  // Glass card
  cardOuter: {
    borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1E3A5F66',
    backgroundColor: Platform.OS === 'ios' ? '#0B1526AA' : '#0D1B2E',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 30, shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  cardInner: { padding: 24, gap: 16 },
  cardHeader: { gap: 4 },
  cardTitle: { fontSize: 22, color: '#F1F5F9' },
  cardSub: { fontSize: 13, color: '#64748B', lineHeight: 19 },

  // Tabs
  tabContainer: {
    flexDirection: 'row', backgroundColor: '#0A1628', borderRadius: 12,
    padding: 2, position: 'relative', height: 44, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1E3A5F44',
  },
  tabIndicator: {
    position: 'absolute', top: 2, left: 2, bottom: 2,
    backgroundColor: '#2563EB', borderRadius: 10,
  },
  tabBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, zIndex: 1 },
  tabText: { fontSize: 13 },

  // Error
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#7F1D1D22', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#EF444433',
  },
  errorText: { fontSize: 12, color: '#F87171', flex: 1, lineHeight: 18 },

  // Form
  form: { gap: 14 },
  fieldWrap: { gap: 7 },
  fieldLabel: { fontSize: 12, color: '#94A3B8', letterSpacing: 0.3 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#0A1628', borderRadius: 12, paddingHorizontal: 14, height: 52,
    borderWidth: 1, borderColor: '#1E3A5F66',
  },
  inputFocused: { borderColor: '#2563EB', shadowColor: '#2563EB', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  textInput: { flex: 1, fontSize: 14, height: '100%' as any },
  countryCode: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countryFlag: { fontSize: 16 },
  countryDial: { fontSize: 13, color: '#F1F5F9' },
  codeDivider: { width: 1, height: 18, backgroundColor: '#1E3A5F', marginLeft: 6 },
  digitCount: { fontSize: 11, color: '#475569' },

  // Remember Me
  rememberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: {
    width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: '#334155',
    backgroundColor: '#0A1628', alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  rememberText: { fontSize: 13, color: '#94A3B8' },
  forgotText: { fontSize: 13, color: '#60A5FA' },

  // Gradient button
  gradBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    height: 54, borderRadius: 14,
    shadowColor: '#2563EB', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  gradBtnText: { fontSize: 16, color: '#FFFFFF' },

  // Alt button
  altBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: '#1E3A5F66', backgroundColor: '#0A1628',
  },
  altBtnText: { fontSize: 13, color: '#60A5FA' },

  // OTP info
  otpInfo: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#0D1E3A', borderRadius: 10, padding: 12, borderWidth: 1,
  },
  otpInfoText: { fontSize: 12, color: '#94A3B8', flex: 1, lineHeight: 18 },

  // Demo accounts
  demoToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: '#1E3A5F44', borderStyle: 'dashed',
    backgroundColor: '#080F1D',
  },
  demoDots: { flexDirection: 'row', gap: 3 },
  demoDot: { width: 5, height: 5, borderRadius: 3 },
  demoToggleText: { fontSize: 12, color: '#60A5FA' },
  demoList: { borderRadius: 12, borderWidth: 1, borderColor: '#1E3A5F55', overflow: 'hidden' },
  demoItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, backgroundColor: '#070E1C',
  },
  demoItemBorder: { borderBottomWidth: 1, borderBottomColor: '#1E3A5F44' },
  demoAvatar: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  demoAvatarText: { fontSize: 14 },
  demoInfo: { flex: 1, gap: 2 },
  demoRole: { fontSize: 12, color: '#F1F5F9' },
  demoEmail: { fontSize: 11, color: '#64748B' },
  demoRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  demoPwd: { fontSize: 10, color: '#3B82F6' },

  // Bottom
  bottomSection: { alignItems: 'center', gap: 14 },
  registerText: { fontSize: 13, color: '#64748B', textAlign: 'center' },
  registerLink: { color: '#60A5FA' },
  legalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legalText: { fontSize: 11, color: '#334155' },
  legalDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#334155' },
});
