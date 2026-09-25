import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  StatusBar,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';
import { storage } from '@/utils/storage';
import { isBiometricLockEnabled } from '@/utils/appLock';

const PRIVACY_SETTINGS_KEY = 'avarpus_privacy_settings';

type PrivacySettings = {
  lastSeen: string;
  profilePicture: string;
  about: string;
  links: string;
  status: string;
  readReceipts: boolean;
  defaultMessageTimer: string;
  groups: string;
  liveLocation: string;
  calls: string;
  contacts: string;
  chatLock: string;
  cameraEffects: boolean;
};

const DEFAULT_SETTINGS: PrivacySettings = {
  lastSeen: 'Nobody',
  profilePicture: 'Everyone',
  about: 'Nobody',
  links: 'My contacts',
  status: 'My contacts',
  readReceipts: false,
  defaultMessageTimer: 'Off',
  groups: 'Everyone',
  liveLocation: '',
  calls: 'Silence unknown callers',
  contacts: 'Blocked accounts, WhatsApp contacts',
  chatLock: '',
  cameraEffects: false,
};

type ChoiceKey =
  | 'lastSeen'
  | 'profilePicture'
  | 'about'
  | 'links'
  | 'status'
  | 'defaultMessageTimer'
  | 'groups'
  | 'liveLocation'
  | 'calls'
  | 'contacts';

const CHOICES: Array<{
  key: ChoiceKey;
  title: string;
  subtitle?: (value: string) => string;
  options: string[];
}> = [
  { key: 'lastSeen', title: 'Last seen and online', options: ['Everyone', 'My contacts', 'Nobody'] },
  { key: 'profilePicture', title: 'Profile picture', options: ['Everyone', 'My contacts', 'Nobody'] },
  { key: 'about', title: 'About', options: ['Everyone', 'My contacts', 'Nobody'] },
  { key: 'links', title: 'Links', options: ['Everyone', 'My contacts', 'Nobody'] },
  { key: 'status', title: 'Status', options: ['My contacts', 'My contacts except…', 'Only share with…'] },
  {
    key: 'defaultMessageTimer',
    title: 'Default message timer',
    subtitle: () => 'Start new chats with disappearing messages set to your timer',
    options: ['Off', '24 hours', '7 days', '90 days'],
  },
  { key: 'groups', title: 'Groups', options: ['Everyone', 'My contacts', 'My contacts except…'] },
  { key: 'liveLocation', title: 'Live location', options: ['None', 'While using the app'] },
  { key: 'calls', title: 'Calls', options: ['Everyone', 'My contacts', 'Silence unknown callers'] },
  { key: 'contacts', title: 'Contacts', options: ['Blocked accounts, WhatsApp contacts', 'My contacts'] },
];

function ListRow({
  title,
  subtitle,
  value,
  onPress,
  colors,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const content = (
    <View style={styles.rowContent}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle}>{subtitle}</Text>
        ) : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
    </View>
  );

  if (!onPress) return <View style={styles.row}>{content}</View>;

  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}${value ? `, ${value}` : ''}`}
    >
      {content}
    </TouchableOpacity>
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
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowContent}>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text>
          {subtitle ? (
            <Text style={styles.rowSubtitle}>{subtitle}</Text>
          ) : null}
        </View>
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: '#465158', true: '#4F9D78' }}
          thumbColor={value ? '#D6F4E2' : '#AAB4B9'}
          ios_backgroundColor="#465158"
        />
      </View>
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
    <K extends ChoiceKey>(key: K, title: string, options: string[]) => {
      Alert.alert(title, undefined, [
        ...options.map((option) => ({
          text: option,
          onPress: () => updateSetting(key, option),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    },
    [updateSetting],
  );

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const darkBackground = '#0B1014';
  const divider = '#1C252A';
  const muted = '#899399';

  return (
    <View style={[styles.container, { backgroundColor: darkBackground }]}>
      <StatusBar barStyle="light-content" backgroundColor={darkBackground} />
      <View style={[styles.header, { paddingTop: topPad, borderBottomColor: divider }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to Settings"
        >
          <Feather name="arrow-left" size={size.headerIcon} color="#E9EEF1" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionHeading, { color: muted }]}>Who can see my personal info</Text>

        {CHOICES.slice(0, 5).map((item) => (
          <ListRow
            key={item.key}
            title={item.title}
            subtitle={item.subtitle?.(settings[item.key]) ?? settings[item.key]}
            onPress={() => chooseValue(item.key, item.title, item.options)}
            colors={colors}
          />
        ))}

        <ToggleRow
          title="Read receipts"
          subtitle="If turned off, you won't send or receive Read receipts. Read receipts are always sent for group chats."
          value={settings.readReceipts}
          onValueChange={(value) => updateSetting('readReceipts', value)}
          colors={colors}
        />

        <View style={[styles.divider, { backgroundColor: divider }]} />
        <Text style={[styles.sectionHeading, { color: muted }]}>Disappearing messages</Text>

        <ListRow
          title="Default message timer"
          subtitle="Start new chats with disappearing messages set to your timer"
          value={settings.defaultMessageTimer}
          onPress={() => chooseValue('defaultMessageTimer', 'Default message timer', CHOICES[5].options)}
          colors={colors}
        />

        <View style={[styles.divider, { backgroundColor: divider }]} />

        <ListRow
          title="Groups"
          subtitle={settings.groups}
          onPress={() => chooseValue('groups', 'Groups', CHOICES[6].options)}
          colors={colors}
        />
        <ListRow
          title="Live location"
          subtitle={settings.liveLocation || undefined}
          onPress={() => chooseValue('liveLocation', 'Live location', CHOICES[7].options)}
          colors={colors}
        />
        <ListRow
          title="Calls"
          subtitle={settings.calls}
          onPress={() => chooseValue('calls', 'Calls', CHOICES[8].options)}
          colors={colors}
        />
        <ListRow
          title="Contacts"
          subtitle={settings.contacts}
          onPress={() => chooseValue('contacts', 'Contacts', CHOICES[9].options)}
          colors={colors}
        />
        <ListRow
          title="App lock"
          subtitle={appLockEnabled ? 'Enabled' : 'Disabled'}
          onPress={() => router.push('/(tabs)/more/security')}
          colors={colors}
        />
        <ListRow
          title="Chat lock"
          subtitle={settings.chatLock || undefined}
          onPress={() =>
            Alert.alert('Chat lock', 'Chat lock controls will be available here.')
          }
          colors={colors}
        />

        <ToggleRow
          title="Allow camera effects"
          subtitle="Use effects in the camera and video calls.\nLearn more"
          value={settings.cameraEffects}
          onValueChange={(value) => updateSetting('cameraEffects', value)}
          colors={colors}
        />

        <ListRow
          title="Advanced"
          subtitle="Protect IP address in calls, Disable link previews"
          onPress={() =>
            Alert.alert('Advanced privacy', 'Advanced privacy controls will be available here.')
          }
          colors={colors}
        />

        <View style={[styles.divider, { backgroundColor: divider }]} />
        <ListRow
          title="Privacy checkup"
          subtitle="Control your privacy and choose the right settings for you."
          onPress={() =>
            Alert.alert('Privacy checkup', 'Review the settings above to complete your privacy checkup.')
          }
          colors={colors}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: size.iconButton,
    height: size.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#E9EEF1',
    ...font.title,
    marginLeft: 1,
  },
  sectionHeading: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.xxl,
    paddingBottom: 8,
    ...font.overline,
  },
  row: {
    minHeight: layout.headerHeight,
    paddingHorizontal: layout.screenPadding,
    justifyContent: 'center',
  },
  rowContent: {
    minHeight: layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowCopy: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  rowTitle: {
    color: '#E9EEF1',
    ...font.bodyStrong,
  },
  rowSubtitle: {
    color: '#899399',
    marginTop: 2,
    ...font.caption,
  },
  rowValue: {
    color: '#899399',
    maxWidth: 92,
    marginLeft: 12,
    textAlign: 'right',
    ...font.body,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
});