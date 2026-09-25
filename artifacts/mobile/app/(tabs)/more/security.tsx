import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { useColors } from '@/hooks/useColors';
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';
import { Card } from '@/components/ui/Card';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { FadeInView, useStaggerAnim } from '@/components/ui/Glass';
import {
  clearLegacyMpinData,
  completeUnlockSuccess,
  isBiometricLockEnabled,
  setBiometricLockEnabled,
} from '@/utils/appLock';

export default function SecurityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [deviceAuthAvailable, setDeviceAuthAvailable] = useState(false);
  const [methodLabel, setMethodLabel] = useState('Biometric or device password');
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const anims = useStaggerAnim(2);

  const refresh = useCallback(async () => {
    try {
      await clearLegacyMpinData();
      const [lockEnabled, level, types] = await Promise.all([
        isBiometricLockEnabled(),
        LocalAuthentication.getEnrolledLevelAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
      ]);
      const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
      setEnabled(lockEnabled);
      setDeviceAuthAvailable(level !== LocalAuthentication.SecurityLevel.NONE);
      if (hasFace) setMethodLabel('Face ID or device password');
      else if (hasFingerprint) setMethodLabel('Fingerprint or device password');
      else setMethodLabel('Device password');
    } catch {
      setBanner({ kind: 'error', text: 'Could not read device security settings.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showBanner = (kind: 'success' | 'error', text: string) => {
    setBanner({ kind, text });
    setTimeout(() => setBanner(null), 3500);
  };

  const authenticate = async (promptMessage: string) =>
    LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use device password',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });

  const toggleLock = async (value: boolean) => {
    if (busy) return;
    Haptics.selectionAsync();
    setBusy(true);
    setBanner(null);
    try {
      if (value && !deviceAuthAvailable) {
        showBanner('error', 'Set up a fingerprint, Face ID, PIN, pattern, or password in Android settings first.');
        return;
      }
      const result = await authenticate(
        value ? 'Enable Avarpus app lock' : 'Turn off Avarpus app lock',
      );
      if (!result.success) return;

      await setBiometricLockEnabled(value);
      if (value) await completeUnlockSuccess();
      await refresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showBanner('success', value ? 'App lock enabled.' : 'App lock turned off.');
    } catch {
      showBanner('error', 'Could not update app lock. Try again.');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '22' }]}
        >
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Security
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {!!banner && (
          <View
            style={[
              styles.banner,
              {
                backgroundColor: (banner.kind === 'success' ? colors.success : colors.destructive) + '15',
                borderColor: (banner.kind === 'success' ? colors.success : colors.destructive) + '33',
              },
            ]}
          >
            <Feather
              name={banner.kind === 'success' ? 'check-circle' : 'alert-circle'}
              size={16}
              color={banner.kind === 'success' ? colors.success : colors.destructive}
            />
            <Text
              style={[
                styles.bannerText,
                {
                  color: banner.kind === 'success' ? colors.success : colors.destructive,
                  fontFamily: fontFamily.semibold,
                },
              ]}
            >
              {banner.text}
            </Text>
          </View>
        )}

        {loading ? (
          <AvarpusSpinner size={20} style={{ marginTop: 40 }} />
        ) : (
          <>
            <FadeInView animValue={anims[0]}>
              <Card>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                      App lock
                    </Text>
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                      Unlock with {methodLabel.toLowerCase()}. Avarpus no longer stores or asks for an MPIN.
                    </Text>
                  </View>
                  <Switch
                    value={enabled}
                    onValueChange={toggleLock}
                    disabled={busy}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </Card>
            </FadeInView>

            <FadeInView animValue={anims[1]}>
              <Card>
                <View style={styles.infoRow}>
                  <View style={[styles.infoIcon, { backgroundColor: colors.primary + '15' }]}>
                    <Feather name="smartphone" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                      Uses Android device security
                    </Text>
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                      Android controls the authentication prompt. Depending on your phone setup, it can offer fingerprint, face unlock, PIN, pattern, or device password.
                    </Text>
                  </View>
                </View>
              </Card>
            </FadeInView>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: layout.headerHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.listInset },
  backBtn: { width: size.iconButton, height: size.iconButton, borderRadius: size.iconButton / 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  scroll: { paddingHorizontal: layout.screenPadding, paddingTop: space.lg, paddingBottom: 100, gap: space.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  bannerText: { ...font.captionStrong, flex: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { ...font.bodyStrong },
  rowSub: { ...font.caption, marginTop: space.xs },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoIcon: { width: size.avatarSm, height: size.avatarSm, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
