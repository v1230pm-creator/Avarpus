import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  authLoginHistory,
  authRevokeOtherSessions,
  authRevokeSession,
  authSessions,
  type LoginEvent,
  type SessionInfo,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import {
  DEFAULT_INACTIVITY_MINUTES,
  INACTIVITY_OPTIONS,
  getInactivityTimeoutMinutes,
  inactivityLabel,
  setInactivityTimeoutMinutes,
} from '@/utils/sessionPrefs';
import { getAppBuildNumber, getAppVersion } from '@/utils/appVersion';

function formatLoginTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const currentVersion = getAppVersion();
  const currentBuild = getAppBuildNumber();

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const [companyName, setCompanyName] = useState('Avarpus');
  const [phone, setPhone] = useState('+91 98765 43210');
  const [email, setEmail] = useState('support@avarpus.app');
  const [address, setAddress] = useState('123 Tech Street, Bengaluru, Karnataka 560001');
  const [gst, setGst] = useState('29ABCDE1234F1Z5');
  const [currency, setCurrency] = useState('INR');
  const [saved, setSaved] = useState(false);

  // Security & session
  const [inactivityMin, setInactivityMin] = useState<number>(DEFAULT_INACTIVITY_MINUTES);
  const [history, setHistory] = useState<LoginEvent[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [sessionsError, setSessionsError] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  // Sample data
  const { hasSampleData, loadSampleData, clearSampleData } = useData();
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const onLoadSample = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSampleBusy(true);
    setSampleError(null);
    try {
      await loadSampleData();
    } catch (e) {
      setSampleError(e instanceof Error ? e.message : 'Could not load sample data');
    } finally {
      setSampleBusy(false);
    }
  };

  const onClearSample = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSampleBusy(true);
    setSampleError(null);
    try {
      await clearSampleData();
    } catch (e) {
      setSampleError(e instanceof Error ? e.message : 'Could not clear sample data');
    } finally {
      setSampleBusy(false);
    }
  };

  const loadSessions = () => {
    authSessions()
      .then((res) => { setSessions(res.sessions); setSessionsError(false); })
      .catch(() => setSessionsError(true));
  };

  useEffect(() => {
    getInactivityTimeoutMinutes().then(setInactivityMin).catch(() => {});
    authLoginHistory()
      .then((res) => setHistory(res.events))
      .catch(() => setHistoryError(true));
    loadSessions();
  }, []);

  const revokeSession = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRevokingId(id);
    try {
      await authRevokeSession(id);
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? prev);
    } catch {
      setSessionsError(true);
    } finally {
      setRevokingId(null);
    }
  };

  const revokeOthers = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRevokingOthers(true);
    try {
      await authRevokeOtherSessions();
      setSessions((prev) => prev?.filter((s) => s.current) ?? prev);
    } catch {
      setSessionsError(true);
    } finally {
      setRevokingOthers(false);
    }
  };

  const selectInactivity = async (minutes: number) => {
    Haptics.selectionAsync();
    setInactivityMin(minutes);
    await setInactivityTimeoutMinutes(minutes);
  };

  const handleSave = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const anims = useStaggerAnim(6);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>


      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        <FadeInView animValue={anims[0]} style={styles.section}>
        {/* Company Info */}
        <View style={[styles.sectionHeader, { borderLeftColor: colors.primary }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Company Information</Text>
        </View>

        <Input label="Company Name" value={companyName} onChangeText={setCompanyName} leftIcon="briefcase" />
        <Input label="Phone" value={phone} onChangeText={setPhone} leftIcon="phone" keyboardType="phone-pad" />
        <Input label="Email" value={email} onChangeText={setEmail} leftIcon="mail" keyboardType="email-address" />
        <Input label="Address" value={address} onChangeText={setAddress} leftIcon="map-pin" multiline numberOfLines={2} style={{ height: 72, textAlignVertical: 'top', paddingTop: 10 } as any} />
        <Input label="GST Number" value={gst} onChangeText={setGst} leftIcon="file-text" autoCapitalize="characters" />
        </FadeInView>

        <FadeInView animValue={anims[1]} style={styles.section}>
        {/* App Config */}
        <View style={[styles.sectionHeader, { borderLeftColor: colors.primary }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>App Configuration</Text>
        </View>

        <Card>
          <View style={styles.configRow}>
            <View>
              <Text style={[styles.configLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Currency</Text>
              <Text style={[styles.configSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Default: INR (Indian Rupee)</Text>
            </View>
            <View style={[styles.currencyBadge, { backgroundColor: colors.primary + '15' }]}>
              <Text style={[styles.currencyText, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>₹ INR</Text>
            </View>
          </View>
        </Card>

        <Card>
          <View style={styles.configRow}>
            <View>
              <Text style={[styles.configLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>App Version</Text>
              <Text style={[styles.configSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Avarpus</Text>
            </View>
            <Text style={[styles.versionText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              v{currentVersion} (Build {currentBuild})
            </Text>
          </View>
        </Card>
        </FadeInView>

        <FadeInView animValue={anims[2]} style={styles.section}>
        {/* Security & Session */}
        <View style={[styles.sectionHeader, { borderLeftColor: colors.primary }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Security &amp; Session</Text>
        </View>

        <Card>
          <View style={styles.configRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.configLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Backup email identity</Text>
              <Text style={[styles.configSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                {user?.email ?? 'No backup email is saved for this account.'}
              </Text>
              <Text style={[styles.configSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Kept only for account recovery and to protect your existing account data. Sign-in uses mobile OTP.
              </Text>
            </View>
            <Feather name="mail" size={20} color={colors.primary} />
          </View>
        </Card>

        <TouchableOpacity onPress={() => router.push('/(tabs)/more/security')} activeOpacity={0.8}>
          <Card>
            <View style={styles.configRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.configLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Biometric app lock</Text>
                <Text style={[styles.configSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  Enable device biometric or password authentication when reopening the app.
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </View>
          </Card>
        </TouchableOpacity>

        <Card>
          <Text style={[styles.configLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Auto-lock after inactivity</Text>
          <Text style={[styles.configSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Locks with device authentication when app lock is enabled, or signs you out when it is off.
          </Text>
          <View style={styles.timeoutRow}>
            {INACTIVITY_OPTIONS.map((min) => {
              const active = inactivityMin === min;
              return (
                <TouchableOpacity
                  key={min}
                  onPress={() => selectInactivity(min)}
                  style={[
                    styles.timeoutChip,
                    {
                      backgroundColor: active ? colors.primary : colors.primary + '12',
                      borderColor: active ? colors.primary : colors.primary + '22',
                    },
                  ]}
                >
                  <Text style={[styles.timeoutChipText, {
                    color: active ? '#FFFFFF' : colors.foreground,
                    fontFamily: 'Inter_600SemiBold',
                  }]}>
                    {inactivityLabel(min)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        <Card>
          <Text style={[styles.configLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Active sessions</Text>
          <Text style={[styles.configSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Devices currently signed in to your account.
          </Text>
          {sessions === null && !sessionsError && (
            <ActivityIndicator style={{ marginTop: 14 }} color={colors.primary} />
          )}
          {sessionsError && (
            <Text style={[styles.historyEmpty, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Couldn't load sessions. Check your connection and try again.
            </Text>
          )}
          {sessions !== null && sessions.map((s, i) => (
            <View
              key={s.id}
              style={[styles.historyRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <View style={[styles.historyIcon, { backgroundColor: (s.current ? colors.success : colors.primary) + '15' }]}>
                <Feather name="smartphone" size={14} color={s.current ? colors.success : colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.historyMethod, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {s.deviceInfo || 'Unknown device'}
                  {s.current ? '  ·  This device' : ''}
                </Text>
                <Text style={[styles.historyTime, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  Signed in {formatLoginTime(s.createdAt)}
                </Text>
              </View>
              {!s.current && (
                <TouchableOpacity
                  onPress={() => revokeSession(s.id)}
                  disabled={revokingId === s.id}
                  style={[styles.revokeBtn, { borderColor: colors.destructive + '33', backgroundColor: colors.destructive + '11' }]}
                >
                  {revokingId === s.id ? (
                    <ActivityIndicator size="small" color={colors.destructive} />
                  ) : (
                    <Text style={[styles.revokeBtnText, { color: colors.destructive, fontFamily: 'Inter_600SemiBold' }]}>
                      Sign out
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ))}
          {sessions !== null && sessions.some((s) => !s.current) && (
            <TouchableOpacity
              onPress={revokeOthers}
              disabled={revokingOthers}
              style={[styles.revokeAllBtn, { borderColor: colors.destructive + '55', backgroundColor: colors.destructive + '11' }]}
            >
              {revokingOthers ? (
                <ActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <>
                  <Feather name="log-out" size={15} color={colors.destructive} />
                  <Text style={[styles.revokeBtnText, { color: colors.destructive, fontFamily: 'Inter_600SemiBold' }]}>
                    Sign out all other devices
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </Card>

        <Card>
          <Text style={[styles.configLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Login history</Text>
          <Text style={[styles.configSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Recent sign-ins to your account.
          </Text>
          {history === null && !historyError && (
            <ActivityIndicator style={{ marginTop: 14 }} color={colors.primary} />
          )}
          {historyError && (
            <Text style={[styles.historyEmpty, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Couldn't load login history. Check your connection and try again.
            </Text>
          )}
          {history !== null && history.length === 0 && (
            <Text style={[styles.historyEmpty, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              No logins recorded yet.
            </Text>
          )}
          {history !== null && history.map((e, i) => (
            <View
              key={e.id}
              style={[styles.historyRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <View style={[styles.historyIcon, { backgroundColor: colors.primary + '15' }]}>
                <Feather name={e.method === 'otp' ? 'smartphone' : 'key'} size={14} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.historyMethod, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {e.method === 'otp' ? 'Mobile OTP' : e.method === 'device_key' ? 'Device key' : 'Archived sign-in method'}
                  {e.deviceInfo ? `  ·  ${e.deviceInfo}` : ''}
                  {e.rememberMe ? '  ·  Remembered' : ''}
                </Text>
                <Text style={[styles.historyTime, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {formatLoginTime(e.createdAt)}
                </Text>
              </View>
            </View>
          ))}
        </Card>
        </FadeInView>

        <FadeInView animValue={anims[3]} style={styles.section}>
        {/* Sample data */}
        <View style={[styles.sectionHeader, { borderLeftColor: colors.primary }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Sample Data</Text>
        </View>

        <Card>
          <Text style={[styles.configLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
            {hasSampleData ? 'Sample data is loaded' : 'Explore with sample data'}
          </Text>
          <Text style={[styles.configSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {hasSampleData
              ? 'Demo repairs, customers, stock and finance entries are mixed into your shop. Clearing removes only the sample records — your real data is untouched.'
              : 'Load labelled demo repairs, customers, stock and finance entries into your shop to try the app and reports. You can remove them anytime with one tap.'}
          </Text>
          <View style={styles.dangerActions}>
            {hasSampleData ? (
              <TouchableOpacity
                onPress={onClearSample}
                disabled={sampleBusy}
                style={[styles.dangerBtn, { backgroundColor: colors.destructive + '11', borderColor: colors.destructive + '33', opacity: sampleBusy ? 0.6 : 1 }]}
              >
                {sampleBusy ? (
                  <ActivityIndicator size="small" color={colors.destructive} />
                ) : (
                  <>
                    <Feather name="trash-2" size={16} color={colors.destructive} />
                    <Text style={[styles.dangerBtnText, { color: colors.destructive, fontFamily: 'Inter_600SemiBold' }]}>Clear sample data</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={onLoadSample}
                disabled={sampleBusy}
                style={[styles.dangerBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '22', opacity: sampleBusy ? 0.6 : 1 }]}
              >
                {sampleBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <Feather name="database" size={16} color={colors.primary} />
                    <Text style={[styles.dangerBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Load sample data</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
          {!!sampleError && (
            <Text style={[styles.historyEmpty, { color: colors.destructive, fontFamily: 'Inter_500Medium' }]}>
              {sampleError}
            </Text>
          )}
        </Card>
        </FadeInView>

        <FadeInView animValue={anims[4]} style={styles.section}>
        {/* Danger Zone */}
        <View style={[styles.sectionHeader, { borderLeftColor: colors.destructive }]}>
          <Text style={[styles.sectionTitle, { color: colors.destructive, fontFamily: 'Inter_700Bold' }]}>Data Management</Text>
        </View>

        <Card>
          <Text style={[styles.dangerDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Backup and restore your app data. All data is stored locally on this device.
          </Text>
          <View style={styles.dangerActions}>
            <TouchableOpacity style={[styles.dangerBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '22' }]}>
              <Feather name="download" size={16} color={colors.primary} />
              <Text style={[styles.dangerBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Backup Data</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.dangerBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '22' }]}>
              <Feather name="upload" size={16} color={colors.primary} />
              <Text style={[styles.dangerBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Restore</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {saved ? (
          <View style={[styles.savedBanner, { backgroundColor: colors.successLight, borderColor: colors.success + '33', borderRadius: colors.radius }]}>
            <Feather name="check-circle" size={16} color={colors.success} />
            <Text style={[styles.savedText, { color: colors.success, fontFamily: 'Inter_600SemiBold' }]}>Settings saved!</Text>
          </View>
        ) : (
          <Button title="Save Settings" onPress={handleSave} fullWidth size="lg" />
        )}
        </FadeInView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22 },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 20 },
  section: { gap: 16 },
  sectionHeader: { borderLeftWidth: 3, paddingLeft: 10, marginTop: 4, marginBottom: -4 },
  sectionTitle: { fontSize: 15 },
  configRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  configLabel: { fontSize: 15 },
  configSub: { fontSize: 12, marginTop: 2 },
  currencyBadge: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  currencyText: { fontSize: 14 },
  versionText: { fontSize: 14 },
  dangerDesc: { fontSize: 13, lineHeight: 20 },
  dangerActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  dangerBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  dangerBtnText: { fontSize: 13 },
  timeoutRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  timeoutChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  timeoutChipText: { fontSize: 13 },
  historyEmpty: { fontSize: 13, marginTop: 14 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, marginTop: 2 },
  historyIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  historyMethod: { fontSize: 13 },
  revokeBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, minWidth: 70, alignItems: 'center' },
  revokeBtnText: { fontSize: 12 },
  revokeAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 12 },
  historyTime: { fontSize: 12, marginTop: 2 },
  savedBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderWidth: 1 },
  savedText: { fontSize: 14 },
});
