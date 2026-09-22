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
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

const CHAT_SETTINGS_KEY = 'avarpus_chat_settings';

type ChatSettings = {
  enterIsSend: boolean;
  mediaVisibility: boolean;
  stickerSuggestions: boolean;
  keepChatsArchived: boolean;
  fontSize: 'Small' | 'Medium' | 'Large';
};

const DEFAULT_SETTINGS: ChatSettings = {
  enterIsSend: false,
  mediaVisibility: true,
  stickerSuggestions: true,
  keepChatsArchived: true,
  fontSize: 'Medium',
};

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
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}>
        <Text style={[styles.settingTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.backgroundSecondary, true: colors.primary }}
        thumbColor={value ? colors.foreground : colors.mutedForeground}
        ios_backgroundColor={colors.backgroundSecondary}
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityState={{ checked: value }}
      />
    </View>
  );
}

function ActionRow({
  icon,
  title,
  onPress,
  colors,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  onPress: () => void;
  colors: any;
}) {
  return (
    <TouchableOpacity
      style={styles.actionRow}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
       <Feather name={icon} size={size.inlineIcon} color={colors.mutedForeground} />
      <Text style={[styles.actionTitle, { color: colors.foreground }]}>{title}</Text>
    </TouchableOpacity>
  );
}

export default function ChatsSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_SETTINGS);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  useEffect(() => {
    let active = true;
    void storage.get<Partial<ChatSettings>>(CHAT_SETTINGS_KEY).then((saved) => {
      if (active && saved) {
        setSettings({ ...DEFAULT_SETTINGS, ...saved });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const updateSetting = useCallback(
    <K extends keyof ChatSettings>(key: K, value: ChatSettings[K]) => {
      setSettings((current) => {
        const next = { ...current, [key]: value };
        void storage.set(CHAT_SETTINGS_KEY, next);
        return next;
      });
    },
    [],
  );

  const showUnavailable = useCallback((title: string, message: string) => {
    Alert.alert(title, message);
  }, []);

  const chooseFontSize = useCallback(() => {
    Alert.alert('Font size', 'Choose the message text size.', [
      ...(['Small', 'Medium', 'Large'] as const).map((size) => ({
        text: size,
        onPress: () => updateSetting('fontSize', size),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [updateSetting]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={size.headerIcon} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Chats</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Chat settings</Text>
        <ToggleRow
          title="Enter is send"
          subtitle="Enter key will send your message"
          value={settings.enterIsSend}
          onValueChange={(value) => updateSetting('enterIsSend', value)}
          colors={colors}
        />
        <ToggleRow
          title="Media visibility"
          subtitle="Show newly downloaded media in your device's gallery"
          value={settings.mediaVisibility}
          onValueChange={(value) => updateSetting('mediaVisibility', value)}
          colors={colors}
        />
        <TouchableOpacity
          style={styles.settingRow}
          onPress={chooseFontSize}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Font size"
        >
          <View style={styles.settingCopy}>
            <Text style={[styles.settingTitle, { color: colors.foreground }]}>Font size</Text>
            <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>
              {settings.fontSize}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() =>
            showUnavailable(
              'Voice message transcripts',
              'Voice message transcription will be available when supported on this device.',
            )
          }
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Voice message transcripts"
        >
          <View style={styles.settingCopy}>
            <Text style={[styles.settingTitle, { color: colors.foreground }]}>
              Voice message transcripts
            </Text>
            <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>
              Read new voice messages.
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
        <ToggleRow
          title="Sticker suggestions"
          subtitle="See suggested stickers as you type a message"
          value={settings.stickerSuggestions}
          onValueChange={(value) => updateSetting('stickerSuggestions', value)}
          colors={colors}
        />

        <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Archived chats</Text>
        <ToggleRow
          title="Keep chats archived"
          subtitle="Archive chats will remain archived when you receive a new message"
          value={settings.keepChatsArchived}
          onValueChange={(value) => updateSetting('keepChatsArchived', value)}
          colors={colors}
        />

        <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />
        <ActionRow
          icon="upload-cloud"
          title="Chat backup"
          onPress={() => router.push('/(tabs)/more/chat-backup')}
          colors={colors}
        />
        <ActionRow
          icon="hard-drive"
          title="Storage and data"
          onPress={() => router.push('/(tabs)/more/chat-storage')}
          colors={colors}
        />
        <ActionRow
          icon="file-text"
          title="Transfer chats"
          onPress={() =>
            showUnavailable(
              'Transfer chats',
              'Chat transfer will be available when device-to-device migration is supported.',
            )
          }
          colors={colors}
        />
        <ActionRow
          icon="rotate-ccw"
          title="Chat history"
          onPress={() =>
            showUnavailable(
              'Chat history',
              'Chat history tools are not available yet.',
            )
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    ...font.title,
    marginLeft: space.sm,
  },
  sectionLabel: {
    ...font.overline,
    marginTop: space.xxl,
    marginBottom: space.sm,
    paddingHorizontal: layout.screenPadding,
  },
  settingRow: {
    minHeight: 64,
    paddingVertical: layout.rowPaddingVertical,
    paddingHorizontal: layout.screenPadding,
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingCopy: { flex: 1, paddingRight: space.lg },
  settingTitle: {
    ...font.bodyStrong,
  },
  settingSubtitle: {
    ...font.caption,
  },
  sectionDivider: {
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionRow: {
    minHeight: 64,
    paddingHorizontal: layout.screenPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxl,
  },
  actionTitle: {
    ...font.bodyStrong,
  },
});