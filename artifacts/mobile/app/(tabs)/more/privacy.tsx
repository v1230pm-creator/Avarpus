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
  disappearingMessages: string;
  defaultMessageTimer: string;
  groups: string;
  liveLocation: string;
  calls: string;
  contacts: string;
  chatLock: boolean;
  cameraEffects: boolean;
};

const DEFAULT_SETTINGS: PrivacySettings = {
  lastSeen: 'Nobody',
  profilePhoto: 'Everyone',
  about: 'Nobody',
  links: 'My contacts',
  status: 'My contacts',
  readReceipts: false,
  disappearingMessages: 'Off',
  defaultMessageTimer: 'Off',
  groups: 'Everyone',
  liveLocation: 'None',
  calls: 'Everyone',
  contacts: 'My contacts',
  chatLock: false,
  cameraEffects: true,
};

const PERSONAL_ROWS: Array<{
  key: 'lastSeen' | 'profilePhoto' | 'about' | 'links' | 'status';
  title: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  options: string[];
}> = [
  { key: 'lastSeen', title: 'Last seen and online', icon: 'clock', options: ['Everyone', 'My contacts', 'Nobody'] },
  { key: 'profilePhoto', title: 'Profile picture', icon: 'image', options: ['Everyone', 'My contacts', 'Nobody'] },
  { key: 'about', title: 'About', icon: 'info', options: ['Everyone', 'My contacts', 'Nobody'] },
  { key: 'links', title: 'Links', icon: 'link', options: ['Everyone', 'My contacts', 'Nobody'] },
  { key: 'status', title: 'Status', icon: 'circle', options: ['My contacts', 'My contacts except…', 'Only share with…'] },
];

function ChoiceRow({
  title,
  subtitle,
  icon,
  value,
  onPress,
  colors,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  value: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${value}`}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primary + '14' }]}>
        <Feather name={icon} size={19} color={colors.primary} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

function SwitchRow({
  title,
  subtitle,
  icon,
  value,
  onValueChange,
  colors,
  disabled = false,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  value: boolean;
  onValueChange: (value: boolean) => void;
  colors: ReturnType<typeof useColors>;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.primary + '14' }]}>
        <Feather name={icon} size={19} color={colors.primary} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary + '70' }}
        thumbColor={value ? colors.primary : colors.mutedForeground}
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

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      storage.get<Partial<PrivacySettings>>(PRIVACY_SETTINGS_KEY),
      isBiometricLockEnabled(),
    ]).then(([saved, appLock]) => {
      if (!mounted) return;
      setSettings({ ...DEFAULT_SETTINGS, ...(saved ?? {}) });
      setAppLockEnabled(appLock);
    });
    return () => {
      mounted = false;
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

  const chooseValue = useCallback(
    <K extends keyof PrivacySettings>(key: K, title: string, options: string[]) => {
      Alert.alert(title, undefined, [
        ...options.map((option) => ({
          text: option,
          onPress: () => updateSetting(key, option as PrivacySettings[K]),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    },
    [updateSetting],
  );

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 10 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to Settings"
        >
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Privacy</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Choose who can see your information and how your messages are handled.
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Personal information</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {PERSONAL_ROWS.map((item) => (
            <ChoiceRow
              key={item.key}
              title={item.title}
              subtitle={settings[item.key]}
              icon={item.icon}
              value={settings[item.key]}
              colors={colors}
              onPress={() => chooseValue(item.key, item.title, item.options)}
            />
          ))}
          <SwitchRow
            title="Read receipts"
            subtitle={settings.readReceipts ? 'Enabled' : 'Disabled'}
            icon="check-circle"
            value={settings.readReceipts}
            colors={colors}
            onValueChange={(value) => updateSetting('readReceipts', value)}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Messages and calls</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ChoiceRow
            title="Disappearing messages"
            subtitle={settings.disappearingMessages}
            icon="clock"
            value={settings.disappearingMessages}
            colors={colors}
            onPress={() => chooseValue('disappearingMessages', 'Disappearing messages', ['Off', '24 hours', '7 days', '90 days'])}
          />
          <ChoiceRow
            title="Default message timer"
            subtitle={settings.defaultMessageTimer}
            icon="clock"
            value={settings.defaultMessageTimer}
            colors={colors}
            onPress={() => chooseValue('defaultMessageTimer', 'Default message timer', ['Off', '24 hours', '7 days', '90 days'])}
          />
          <ChoiceRow
            title="Groups"
            subtitle={settings.groups}
            icon="users"
            value={settings.groups}
            colors={colors}
            onPress={() => chooseValue('groups', 'Groups', ['Everyone', 'My contacts', 'My contacts except…'])}
          />
          <ChoiceRow
            title="Live location"
            subtitle={settings.liveLocation}
            icon="map-pin"
            value={settings.liveLocation}
            colors={colors}
            onPress={() => chooseValue('liveLocation', 'Live location', ['None', 'While using the app'])}
          />
          <ChoiceRow
            title="Calls"
            subtitle={settings.calls}
            icon="phone"
            value={settings.calls}
            colors={colors}
            onPress={() => chooseValue('calls', 'Calls', ['Everyone', 'My contacts', 'Nobody'])}
          />
          <ChoiceRow
            title="Contacts"
            subtitle={settings.contacts}
            icon="book-open"
            value={settings.contacts}
            colors={colors}
            onPress={() => chooseValue('contacts', 'Contacts', ['My contacts', 'Nobody'])}
          />
          <SwitchRow
            title="Chat lock"
            subtitle={settings.chatLock ? 'Locked chats are protected' : 'Off'}
            icon="lock"
            value={settings.chatLock}
            colors={colors}
            onValueChange={(value) => updateSetting('chatLock', value)}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>More privacy options</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SwitchRow
            title="App lock"
            subtitle={appLockEnabled ? 'Enabled on this device' : 'Disabled'}
            icon="shield"
            value={appLockEnabled}
            colors={colors}
            disabled
            onValueChange={() => router.push('/(tabs)/more/security')}
          />
          <SwitchRow
            title="Allow camera effects"
            subtitle={settings.cameraEffects ? 'Enabled' : 'Disabled'}
            icon="camera"
            value={settings.cameraEffects}
            colors={colors}
            onValueChange={(value) => updateSetting('cameraEffects', value)}
          />
          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.border }]}
            onPress={() => Alert.alert('Advanced privacy', 'Advanced call and link preview controls are not available yet.')}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.primary + '14' }]}>
              <Feather name="sliders" size={19} color={colors.primary} />
            </View>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Advanced</Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => Alert.alert('Privacy checkup', 'Review the settings above to complete your privacy checkup.')}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.primary + '14' }]}>
              <Feather name="check-square" size={19} color={colors.primary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Privacy checkup</Text>
              <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
                Review your privacy choices
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  backButton: { padding: 10, marginRight: 6 },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  headerSpacer: { flex: 1 },
  intro: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
  },
  sectionLabel: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    fontFamily: 'Inter_600SemiBold',
  },
  card: {
    marginHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowCopy: { flex: 1, paddingVertical: 10 },
  rowTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  rowSubtitle: { marginTop: 4, fontSize: 13, fontFamily: 'Inter_400Regular' },
});