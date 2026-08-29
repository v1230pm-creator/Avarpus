import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView, TextInput, Alert, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { Avatar } from '@/components/ui/Avatar';

const SETTINGS_ITEMS = [
  {
    id: 'linked_devices',
    icon: 'monitor',
    title: 'Linked devices',
    subtitle: 'Use WhatsApp on other devices',
    route: '/(tabs)/more/account'
  },
  {
    id: 'account',
    icon: 'key',
    title: 'Account',
    subtitle: 'Security notifications, change number',
    route: '/(tabs)/more/account'
  },
  {
    id: 'privacy',
    icon: 'lock',
    title: 'Privacy',
    subtitle: 'Blocked accounts, disappearing messages',
    route: '/(tabs)/more/security'
  },
  {
    id: 'lists',
    icon: 'users',
    title: 'Lists',
    subtitle: 'Manage people and groups',
  },
  {
    id: 'chats',
    icon: 'message-circle',
    title: 'Chats',
    subtitle: 'Chat history, backup',
  },
  {
    id: 'appearance',
    icon: 'aperture',
    title: 'Appearance',
    subtitle: 'Chat theme, app icon, app theme',
  },
  {
    id: 'broadcasts',
    icon: 'radio',
    title: 'Broadcasts',
    subtitle: 'Manage lists and send broadcasts',
  },
  {
    id: 'notifications',
    icon: 'bell',
    title: 'Notifications',
    subtitle: 'Message, group & call tones',
    route: '/(tabs)/more/notifications'
  },
  {
    id: 'storage_data',
    icon: 'database',
    title: 'Storage and data',
    subtitle: 'Network usage, auto-download',
  },
  {
    id: 'parental_controls',
    icon: 'shield',
    title: 'Parental controls',
    subtitle: 'Settings for your family',
  },
  {
    id: 'accessibility',
    icon: 'user',
    title: 'Accessibility',
    subtitle: 'Increase contrast, animation',
  },
  {
    id: 'app_language',
    icon: 'globe',
    title: 'App language',
    subtitle: "English (device's language)",
  },
  {
    id: 'help',
    icon: 'help-circle',
    title: 'Help and feedback',
    subtitle: 'Help centre, contact us, privacy policy',
  }
];

export default function SettingsOverviewScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const filteredItems = SETTINGS_ITEMS.filter(item =>
    item.title.toLowerCase().includes(search.toLowerCase()) ||
    item.subtitle.toLowerCase().includes(search.toLowerCase())
  );

  const handleQRClick = () => {
    Alert.alert('Not Available', 'Account QR code flow is not yet available.');
  };

  const handleItemPress = (item: typeof SETTINGS_ITEMS[0]) => {
    if (item.route) {
      router.push(item.route as any);
    } else {
      router.push(`/(tabs)/more/settings-detail?title=${encodeURIComponent(item.title)}&description=${encodeURIComponent(item.subtitle)}`);
    }
  };

  const renderHeader = () => {
    if (isSearching) {
      return (
        <View style={[styles.header, { paddingTop: topPad + 12 }]}>
          <TouchableOpacity
            onPress={() => {
              setIsSearching(false);
              setSearch('');
              Keyboard.dismiss();
            }}
            style={styles.headerIconBtn}
          >
            <Feather name="arrow-left" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search settings..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground, backgroundColor: colors.backgroundSecondary }]}
            autoFocus
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} style={styles.clearSearchBtn}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return (
      <View style={[styles.header, { paddingTop: topPad + 12, justifyContent: 'space-between' }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerIconBtn}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setIsSearching(true)} style={styles.headerIconBtn}>
            <Feather name="search" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleQRClick} style={styles.headerIconBtn}>
            <Feather name="grid" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(tabs)/more/profile')} style={styles.headerIconBtn}>
            <Feather name="edit-2" size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {renderHeader()}

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!isSearching && (
          <TouchableOpacity
            style={styles.profileSection}
            activeOpacity={0.7}
            onPress={() => router.push('/(tabs)/more/profile')}
          >
            <View style={styles.profileImageContainer}>
              <Avatar name={user?.name || 'User'} url={user?.profilePhoto} size={72} />
            </View>
            <View style={styles.profileNameContainer}>
              <Text style={[styles.profileName, { color: colors.foreground }]}>{user?.name || 'Avarpus User'}</Text>
              <View style={[styles.profileAddIcon, { borderColor: colors.success }]}>
                <Feather name="plus" size={12} color={colors.success} />
              </View>
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.listContainer}>
          {filteredItems.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              style={styles.listItem}
              activeOpacity={0.6}
              onPress={() => handleItemPress(item)}
            >
              <View style={styles.listIconContainer}>
                <Feather name={item.icon as any} size={22} color={colors.mutedForeground} />
              </View>
              <View style={styles.listTextContainer}>
                <Text style={[styles.listTitle, { color: colors.foreground }]}>{item.title}</Text>
                <Text style={[styles.listSubtitle, { color: colors.mutedForeground }]}>{item.subtitle}</Text>
              </View>
            </TouchableOpacity>
          ))}
          {filteredItems.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyStateText, { color: colors.mutedForeground }]}>No settings found for "{search}"</Text>
            </View>
          )}
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
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  headerIconBtn: {
    padding: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingRight: 40,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    marginLeft: 4,
  },
  clearSearchBtn: {
    position: 'absolute',
    right: 16,
    bottom: 18,
    padding: 4,
  },
  profileSection: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  profileImageContainer: {
    marginBottom: 16,
    position: 'relative',
  },
  profileNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 22,
    fontFamily: 'Inter_600SemiBold',
  },
  profileAddIcon: {
    marginLeft: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContainer: {
    paddingTop: 8,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  listIconContainer: {
    width: 32,
    alignItems: 'flex-start',
  },
  listTextContainer: {
    flex: 1,
  },
  listTitle: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    marginBottom: 2,
  },
  listSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
});