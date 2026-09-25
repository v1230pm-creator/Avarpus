import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';
import { Avatar } from '@/components/ui/Avatar';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { authMeUpdate, requestProfileUploadUrl, getChatRoomsListQueryKey, type ProfileUploadUrlRequestContentType } from '@workspace/api-client-react';

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState(user?.name ?? '');
  const [profilePhoto, setProfilePhoto] = useState(user?.profilePhoto ?? null);
  const [about, setAbout] = useState(user?.profileAbout ?? '');
  const [username, setUsername] = useState(user?.profileUsername ?? '');
  const [links, setLinks] = useState((user?.profileLinks ?? []).join('\n'));

  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    setName(user?.name ?? '');
    setProfilePhoto(user?.profilePhoto ?? null);
    setAbout(user?.profileAbout ?? '');
    setUsername(user?.profileUsername ?? '');
    setLinks((user?.profileLinks ?? []).join('\n'));
  }, [user?.id, user?.name, user?.mobile, user?.profileAbout, user?.profileUsername, user?.profileLinks]);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  const notify = (title: string, msg: string) => {
    if (Platform.OS === 'web') window.alert(`${title}\n${msg}`);
    else Alert.alert(title, msg);
  };

  const handlePhotoOptions = () => {
    if (Platform.OS === 'web') {
      pickImage('gallery');
      return;
    }
    Alert.alert('Profile Photo', 'Choose an option', [
      { text: 'Camera', onPress: () => pickImage('camera') },
      { text: 'Gallery', onPress: () => pickImage('gallery') },
      { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const pickImage = async (source: 'camera' | 'gallery') => {
    try {
      let result;
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      };

      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          return notify('Permission Denied', 'Camera access is required.');
        }
        result = await ImagePicker.launchCameraAsync(options);
      } else {
        result = await ImagePicker.launchImageLibraryAsync(options);
      }

      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];

      setUploadingPhoto(true);

      // The picker always crops/re-encodes, so the result is JPEG or PNG; the
      // server only issues profile upload URLs for these types and verifies
      // the bytes afterwards.
      const contentType: ProfileUploadUrlRequestContentType =
        asset.mimeType === 'image/png' || asset.mimeType === 'image/webp' ? asset.mimeType : 'image/jpeg';
      const fileInfo = await FileSystem.getInfoAsync(asset.uri);
      const size = asset.fileSize ?? (fileInfo.exists ? fileInfo.size ?? 0 : 0);
      const fileName = asset.fileName || `profile-photo-${Date.now()}.jpg`;

      const { uploadURL, objectPath } = await requestProfileUploadUrl({
        name: fileName,
        size,
        contentType,
      });

      if (Platform.OS === 'web') {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        const uploadResponse = await fetch(uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: blob,
        });
        if (!uploadResponse.ok) {
          throw new Error(`Upload failed (HTTP ${uploadResponse.status})`);
        }
      } else {
        const uploadResult = await FileSystem.createUploadTask(uploadURL, asset.uri, {
          httpMethod: 'PUT',
          headers: { 'Content-Type': contentType },
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        }).uploadAsync();
        if (!uploadResult || uploadResult.status < 200 || uploadResult.status >= 300) {
          throw new Error(`Upload failed (HTTP ${uploadResult?.status ?? 'unknown'})`);
        }
      }

      const updated = await authMeUpdate({ profilePhoto: objectPath });
      // Use the final server-owned path immediately. refreshUser is still
      // called below to update the shared identity, but the profile screen
      // must not stay on the old avatar if that refresh is briefly delayed.
      setProfilePhoto(updated.user.profilePhoto ?? null);
      await refreshUser();

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      notify('Error', e?.response?.data?.message || e.message || 'Could not upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const saveProfile = async () => {
    const trimmedName = name.normalize('NFC').trim();
    if (!trimmedName) return notify('Error', 'Name cannot be empty');
    if (Array.from(trimmedName).length > 120) return notify('Error', 'Name must be 120 characters or fewer');

    if (username && !/^[a-z0-9_]{3,30}$/i.test(username)) {
      return notify('Error', 'Username must be 3-30 characters (letters, numbers, underscores)');
    }

    setSavingProfile(true);
    try {
      const parsedLinks = links
        .split(/[\n,]+/)
        .map(l => l.trim())
        .filter(l => l.length > 0);

      await authMeUpdate({
        name: trimmedName,
        profileAbout: about.trim() || null,
        profileUsername: username.trim() || null,
        profileLinks: parsedLinks.length > 0 ? parsedLinks : null
      });
      await refreshUser();
      await queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notify('Saved', 'Profile updated');
    } catch (e: any) {
      notify('Error', e?.response?.data?.message || 'Could not update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.avatarSection}>
          <View style={styles.avatarWrapper}>
            {uploadingPhoto ? (
              <View style={[styles.avatarPlaceholder, { backgroundColor: colors.backgroundSecondary }]}>
                <AvarpusSpinner size={40} />
              </View>
            ) : (
              <Avatar name={user?.name ?? 'User'} url={profilePhoto} size={size.avatar * 2} />
            )}

            <TouchableOpacity
              style={[styles.cameraBadge, { backgroundColor: colors.success, borderColor: colors.background }]}
              activeOpacity={0.8}
              onPress={handlePhotoOptions}
              disabled={uploadingPhoto}
            >
              <Feather name="camera" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.fieldsSection}>
          <View style={styles.fieldRow}>
            <View style={styles.fieldIcon}>
              <Feather name="user" size={size.headerIcon} color={colors.mutedForeground} />
            </View>
            <View style={[styles.fieldContent, { borderBottomColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Name</Text>
              <TextInput
                style={[styles.fieldInput, { color: colors.foreground }]}
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={colors.placeholder}
              />
            </View>
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.fieldIcon}>
              <Feather name="info" size={size.headerIcon} color={colors.mutedForeground} />
            </View>
            <View style={[styles.fieldContent, { borderBottomColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>About</Text>
              <TextInput
                style={[styles.fieldInput, { color: about ? colors.foreground : colors.success }]}
                value={about}
                onChangeText={setAbout}
                placeholder="Set About"
                placeholderTextColor={colors.success}
              />
            </View>
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.fieldIcon}>
              <Feather name="at-sign" size={size.headerIcon} color={colors.mutedForeground} />
            </View>
            <View style={[styles.fieldContent, { borderBottomColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Username</Text>
              <TextInput
                style={[styles.fieldInput, { color: username ? colors.foreground : colors.success }]}
                value={username}
                onChangeText={setUsername}
                placeholder="Reserve username"
                placeholderTextColor={colors.success}
                autoCapitalize="none"
              />
            </View>
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.fieldIcon}>
              <Feather name="phone" size={size.headerIcon} color={colors.mutedForeground} />
            </View>
            <View style={[styles.fieldContent, { borderBottomColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Phone</Text>
              <Text style={[styles.fieldInput, { color: colors.foreground }]} testID="profile-mobile-readonly">
                {user?.mobile || '—'}
              </Text>
              <Text style={{ ...font.caption, color: colors.mutedForeground, marginTop: 2 }}>
                This is your sign-in number. To use a different number, sign in with it.
              </Text>
            </View>
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.fieldIcon}>
              <Feather name="link" size={size.headerIcon} color={colors.mutedForeground} />
            </View>
            <View style={[styles.fieldContent, { borderBottomColor: 'transparent' }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Links</Text>
              <TextInput
                style={[styles.fieldInput, { color: links ? colors.foreground : colors.success }]}
                value={links}
                onChangeText={setLinks}
                placeholder="Add links"
                placeholderTextColor={colors.success}
                autoCapitalize="none"
                multiline
              />
            </View>
          </View>
        </View>

        <View style={styles.saveSection}>
          <TouchableOpacity
            onPress={saveProfile}
            disabled={savingProfile}
            activeOpacity={0.85}
            style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: savingProfile ? 0.6 : 1 }]}
          >
            {savingProfile ? (
              <AvarpusSpinner color="#FFF" size={20} />
            ) : (
              <Text style={styles.saveBtnText}>Save Profile</Text>
            )}
          </TouchableOpacity>
        </View>

      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: layout.headerHeight,
    paddingHorizontal: space.sm,
  },
  backBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.title },
  avatarSection: {
    alignItems: 'center',
    paddingVertical: space.xxl,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatarPlaceholder: {
    width: size.avatar * 2,
    height: size.avatar * 2,
    borderRadius: size.avatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: size.avatarSm,
    height: size.avatarSm,
    borderRadius: size.avatarSm / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
  },
  fieldsSection: {
    paddingHorizontal: layout.screenPadding,
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  fieldIcon: {
    width: 48,
    paddingTop: 16,
    alignItems: 'flex-start',
  },
  fieldContent: {
    flex: 1,
    borderBottomWidth: 1,
    paddingVertical: 8,
    paddingBottom: 16,
  },
  fieldLabel: {
    ...font.label,
    marginBottom: 4,
  },
  fieldInput: {
    ...font.input,
    padding: 0,
    minHeight: 24,
  },
  saveSection: {
    padding: space.xxl,
    marginTop: 20,
  },
  saveBtn: {
    borderRadius: 12,
    minHeight: size.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    ...font.button,
  },
});