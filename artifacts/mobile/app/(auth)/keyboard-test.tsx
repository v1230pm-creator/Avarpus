import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * TEMPORARY diagnostic screen (Android keyboard bug).
 *
 * Minimal by design: no ScrollView, no KeyboardAvoidingView, no animations,
 * no gesture wrappers — just two plain TextInputs plus an on-screen event log
 * so the exact focus/blur/keyboard sequence can be read off a release APK
 * where console logs are not visible.
 *
 * If inputs work here but not on the login screen, the conflict is inside the
 * login screen's structure. If they fail here too, the cause is global/native
 * (provider or Android window config).
 */
export default function KeyboardTestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<string[]>([]);
  const startRef = useRef(Date.now());

  const log = (label: string) => {
    const t = ((Date.now() - startRef.current) / 1000).toFixed(2);
    setEvents((prev) => [`${t}s  ${label}`, ...prev].slice(0, 14));
  };

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => log('KEYBOARD SHOW'));
    const hide = Keyboard.addListener('keyboardDidHide', () => log('KEYBOARD HIDE'));
    return () => { show.remove(); hide.remove(); };
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>{'< Back'}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Keyboard Test ({Platform.OS})</Text>
      <Text style={styles.sub}>Tap each box and type. Events appear below.</Text>

      <Text style={styles.label}>Email (plain TextInput)</Text>
      <TextInput
        placeholder="test email"
        placeholderTextColor="#64748B"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={() => log('EMAIL FOCUS')}
        onBlur={() => log('EMAIL BLUR')}
        style={styles.input}
      />

      <Text style={styles.label}>Password (plain TextInput)</Text>
      <TextInput
        placeholder="test password"
        placeholderTextColor="#64748B"
        secureTextEntry
        onFocus={() => log('PASSWORD FOCUS')}
        onBlur={() => log('PASSWORD BLUR')}
        style={styles.input}
      />

      <Text style={styles.label}>Event log (newest first)</Text>
      <View style={styles.logBox}>
        {events.length === 0 && <Text style={styles.logLine}>— no events yet —</Text>}
        {events.map((e, i) => (
          <Text key={`${e}-${i}`} style={styles.logLine}>{e}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060A14', paddingHorizontal: 20, gap: 8 },
  back: { paddingVertical: 8 },
  backText: { color: '#60A5FA', fontSize: 15 },
  title: { color: '#F1F5F9', fontSize: 20, fontWeight: '700' },
  sub: { color: '#94A3B8', fontSize: 13, marginBottom: 8 },
  label: { color: '#94A3B8', fontSize: 12, marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#F1F5F9',
    fontSize: 15,
  },
  logBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#0B1220',
  },
  logLine: { color: '#7DD3FC', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 2 },
});
