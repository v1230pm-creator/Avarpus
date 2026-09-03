import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { storage } from '@/utils/storage';
import { isBiometricLockEnabled } from '@/utils/appLock';

const PRIVACY_SETTINGS_KEY = 'avarpus_privacy_settings';

type PrivacySettings = {
  lastSeen: string;
  profilePhoto: string;
  about: string;
  links: string;
  status: string;
  readReceipts: boolean;
  messageTimer: string;
  groups: string;
  cameraEffects: boolean;
};

const DEFAULT_SETTINGS: PrivacySettings = {
  lastSeen: 'Nobody',
  profilePhoto: 'Everyone',
  about: 'Nobody',
  links: 'My contacts',
  status: 'My contacts',
  readReceipts: false,
  messageTimer: 'Off',
  groups: 'Everyone',
  cameraEffects: false,
};

function SectionLabel({ children, colors }: { children: string; colors: any }) {
  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
      {children}
    </Text>
  );
}

function ChoiceRow({
  title,
  value,
  onPress,
  colors,
}: {
  title: string;
  value?: string;
  onPress: () => void;
  colors: any;
}) {
  return (
    <TouchableOpacity
      style={styles.choiceRow}
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text>
        {!!value && <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>{value}</Text>}
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

function InfoRow({
  title,
  subtitle,
  onPress,
  colors,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  colors: any;
}) {
  const content = (
    <View style={styles.choiceRow}>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>}
      </View>
      {!!onPress && <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
    </View>
  );
  return onPress ? (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {content}
    </TouchableOpacity>
  ) : (
    content
  );
}

function ToggleRow({
  title,
  subtitle,
  value,
  onValueChange,
  colors,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  colors: any;
}) {
  return (
    <View style={styles.choiceRow}>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.backgroundSecondary, true: colors.success }}
        thumbColor={value ? colors.foreground : colors.mutedForeground}
        ios_backgroundColor={colors.backgroundSecondary}
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityState={{ checked: value }}
      />
    </View>
  );
}

export default function PrivacyScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<PrivacySettings>(DEFAULT_SETTINGS);
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  useEffect(() => {
    let active = true;
    void Promise.all([
      storage.get<Partial<PrivacySettings>>(PRIVACY_SETTINGS_KEY),
      isBiometricLockEnabled(),
    ]).then(([saved, lockEnabled]) => {
      if (!active) return;
      if (saved) setSettings({ ...DEFAULT_SETTINGS, ...saved });
      setAppLockEnabled(lockEnabled);
    });
    return () => {
      active = false;
    };
  }, []);

  const updateSetting = useCallback(
    <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) => {
      setSettings((current) => {
        const next = { ...current, [key]: value };
        void storage.set(PRIVACY_SETTINGS_KEY, next);
        return next;
      });
    },
    [],
  );

  const chooseSetting = useCallback(
    (
      title: string,
      key: 'lastSeen' | 'profilePhoto' | 'about' | 'links' | 'status' | 'messageTimer' | 'groups',
      options: string[],
    ) => {
      Alert.alert(title, undefined, [
        ...options.map((value) => ({
          text: value,
          onPress: () => updateSetting(key, value),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    },
    [updateSetting],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 10, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Privacy</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
      >
        <SectionLabel colors={colors}>Who can see my personal info</SectionLabel>
        <ChoiceRow
          title="Last seen and online"
          value={settings.lastSeen}
          colors={colors}
          onPress={() => chooseSetting('Last seen and online', 'lastSeen', ['Everyone', 'My contacts', 'Nobody'])}
        />
        <ChoiceRow
          title="Profile picture"
          value={settings.profilePhoto}
          colors={colors}
          onPress={() => chooseSetting('Profile picture', 'profilePhoto', ['Everyone', 'My contacts', 'Nobody'])}
        />
        <ChoiceRow
          title="About"
          value={settings.about}
          colors={colors}
          onPress={() => chooseSetting('About', 'about', ['Everyone', 'My contacts', 'Nobody'])}
        />
        <ChoiceRow
          title="Links"
          value={settings.links}
          colors={colors}
          onPress={() => chooseSetting('Links', 'links', ['Everyone', 'My contacts', 'Nobody'])}
        />
        <ChoiceRow
          title="Status"
          value={settings.status}
          colors={colors}
          onPress={() => chooseSetting('Status', 'status', ['Everyone', 'My contacts', 'Nobody'])}
        />
        <ToggleRow
          title="Read receipts"
          subtitle="If turned off, you won't send or receive Read receipts. Read receipts are always sent for group chats."
          value={settings.readReceipts}
          onValueChange={(value) => updateSetting('readReceipts', value)}
          colors={colors}
        />

        <View style={[styles.divider, { borderTopColor: colors.border }]} />
        <SectionLabel colors={colors}>Disappearing messages</SectionLabel>
        <ChoiceRow
          title="Default message timer"
          value={settings.messageTimer}
          colors={colors}
          onPress={() =>
            chooseSetting('Default message timer', 'messageTimer', ['Off', '24 hours', '7 days', '90 days'])
          }
        />
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
          Start new chats with disappearing messages set to your timer
        </Text>

        <View style={[styles.divider, { borderTopColor: colors.border }]} />
        <ChoiceRow
          title="Groups"
          value={settings.groups}
          colors={colors}
          onPress={() => chooseSetting('Groups', 'groups', ['Everyone', 'My contacts', 'My contacts except…'])}
        />
        <InfoRow
          title="Live location"
          colors={colors}
          onPress={() =>
            Alert.alert('Live location', 'Live location sharing will be available when location sharing is enabled.')
          }
        />
        <InfoRow title="Calls" subtitle="Silence unknown callers" colors={colors} onPress={() => {}} />
        <InfoRow
          title="Contacts"
          subtitle="Blocked accounts, Avarpus contacts"
          colors={colors}
          onPress={() => Alert.alert('Contacts', 'Blocked accounts and contact matching are managed from this section.')}
        />
        <InfoRow
          title="App lock"
          subtitle={appLockEnabled ? 'Enabled' : 'Disabled'}
          colors={colors}
          onPress={() => router.push('/(tabs)/more/security')}
        />
        <InfoRow
          title="Chat lock"
          colors={colors}
          onPress={() => Alert.alert('Chat lock', 'Chat lock will be available in a future update.')}
        />
        <ToggleRow
          title="Allow camera effects"
          subtitle="Use effects in the camera and video calls."
          value={settings.cameraEffects}
          onValueChange={(value) => updateSetting('cameraEffects', value)}
          colors={colors}
        />
        <TouchableOpacity
          style={styles.learnMore}
          onPress={() => Alert.alert('Camera effects', 'Camera effects are available when video calls are enabled.')}
          accessibilityRole="button"
          accessibilityLabel="Learn more about camera effects"
        >
          <Text style={[styles.learnMoreText, { color: colors.primary }]}>Learn more</Text>
        </TouchableOpacity>
        <InfoRow
          title="Advanced"
          subtitle="Protect IP address in calls, Disable link previews"
          colors={colors}
          onPress={() => Alert.alert('Advanced privacy', 'Advanced call and link preview controls will appear here.')}
        />

        <View style={[styles.divider, { borderTopColor: colors.border }]} />
        <InfoRow
          title="Privacy checkup"
          subtitle="Control your privacy and choose the right settings for you."
          colors={colors}
          onPress={() => Alert.alert('Privacy checkup', 'Your privacy settings are ready to review.')}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: { padding: 8, marginRight: 8 },
  headerTitle: { fontSize: 21, fontFamily: 'Inter_500Medium' },
  headerSpacer: { flex: 1 },
  sectionLabel: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 7,
  },
  choiceRow: {
    minHeight: 70,
    paddingHorizontal: 24,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowCopy: { flex: 1 },
  rowTitle: { fontSize: 16, fontFamily: 'Inter_500Medium' },
  rowSubtitle: { fontSize: 14, lineHeight: 19, marginTop: 2, fontFamily: 'Inter_400Regular' },
  divider: { borderTopWidth: 1, marginTop: 8 },
  helperText: {
    paddingHorizontal: 24,
    marginTop: -8,
    paddingBottom: 10,
    fontSize: 13,
    lineHeight: 18,
  },
  learnMore: { paddingHorizontal: 24, marginTop: -9, marginBottom: 4 },
  learnMoreText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
});