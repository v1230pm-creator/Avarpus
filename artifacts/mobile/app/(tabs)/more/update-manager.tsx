import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { FlatCard, useStaggerAnim } from '@/components/ui/Glass';
import { formatBytes } from '@/utils/appVersion';
import {
  listAppUpdates,
  createAppUpdate,
  updateAppUpdate,
  publishAppUpdate,
  unpublishAppUpdate,
  appUpdateUploadUrl,
  type AppUpdateAdmin,
} from '@workspace/api-client-react';

// ── Admin: App Update Manager (super_admin only) ───────────────────────────
// Upload an APK, fill release details, save as draft, then publish. Size and
// SHA-256 checksum are computed server-side from the uploaded file. This
// module never touches any business data.

const UPDATE_TYPES = ['optional', 'recommended', 'critical'] as const;

type FormState = {
  id: string | null;
  version: string;
  buildNumber: string;
  releaseDate: string;
  updateType: (typeof UPDATE_TYPES)[number];
  minAndroidVersion: string;
  notesText: string;
  demoVideoUrl: string;
  apkPath: string | null;
};

const emptyForm: FormState = {
  id: null,
  version: '',
  buildNumber: '',
  releaseDate: new Date().toISOString().slice(0, 10),
  updateType: 'optional',
  minAndroidVersion: '',
  notesText: '',
  demoVideoUrl: '',
  apkPath: null,
};

export default function UpdateManagerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const anims = useStaggerAnim(3);

  const [releases, setReleases] = useState<AppUpdateAdmin[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isSuperAdmin = user?.role === 'super_admin';

  const load = useCallback(async () => {
    try {
      const res = await listAppUpdates();
      setReleases(res.updates as AppUpdateAdmin[]);
    } catch {
      setReleases([]);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) load();
  }, [isSuperAdmin, load]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const openNew = () => {
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (rel: AppUpdateAdmin) => {
    const notes = Array.isArray(rel.releaseNotes)
      ? (rel.releaseNotes as unknown[]).filter((n) => typeof n === 'string').join('\n')
      : '';
    setForm({
      id: rel.id,
      version: rel.version,
      buildNumber: String(rel.buildNumber),
      releaseDate: rel.releaseDate ?? '',
      updateType: (UPDATE_TYPES as readonly string[]).includes(rel.updateType)
        ? (rel.updateType as FormState['updateType'])
        : 'optional',
      minAndroidVersion: rel.minAndroidVersion ?? '',
      notesText: notes,
      demoVideoUrl: rel.demoVideoUrl ?? '',
      apkPath: rel.apkPath ?? null,
    });
    setFormOpen(true);
  };

  const handlePickApk = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.android.package-archive', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      if (!asset.name.toLowerCase().endsWith('.apk')) {
        Alert.alert('Invalid file', 'Please select an .apk file.');
        return;
      }
      setUploading(true);
      setUploadPct(0);
      const { uploadURL, objectPath } = await appUpdateUploadUrl();
      if (Platform.OS === 'web') {
        const resp = await fetch(asset.uri);
        const blob = await resp.blob();
        const put = await fetch(uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/vnd.android.package-archive' },
          body: blob,
        });
        if (!put.ok) throw new Error('upload-failed');
      } else {
        const info = await FileSystem.getInfoAsync(asset.uri);
        if (!info.exists) throw new Error('missing');
        const uploadTask = FileSystem.createUploadTask(
          uploadURL,
          asset.uri,
          {
            httpMethod: 'PUT',
            headers: { 'Content-Type': 'application/vnd.android.package-archive' },
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          },
          (p) => {
            if (p.totalBytesExpectedToSend > 0) {
              setUploadPct(p.totalBytesSent / p.totalBytesExpectedToSend);
            }
          },
        );
        const result = await uploadTask.uploadAsync();
        if (!result || result.status < 200 || result.status >= 300) throw new Error('upload-failed');
      }
      set({ apkPath: objectPath });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Upload failed', 'Could not upload the APK. Please try again.');
    } finally {
      setUploading(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const buildNumber = Number.parseInt(form.buildNumber, 10);
    if (!/^\d+\.\d+\.\d+$/.test(form.version.trim())) {
      Alert.alert('Invalid version', 'Version must be in X.Y.Z format, e.g. 1.2.0');
      return;
    }
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) {
      Alert.alert('Invalid build number', 'Build number must be a positive whole number.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        version: form.version.trim(),
        buildNumber,
        releaseDate: form.releaseDate.trim() || null,
        updateType: form.updateType,
        minAndroidVersion: form.minAndroidVersion.trim() || null,
        releaseNotes: form.notesText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
        demoVideoUrl: form.demoVideoUrl.trim() || null,
        ...(form.apkPath ? { apkPath: form.apkPath } : {}),
      };
      if (form.id) {
        await updateAppUpdate(form.id, payload as any);
      } else {
        await createAppUpdate(payload as any);
      }
      setFormOpen(false);
      setForm(emptyForm);
      await load();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Could not save', e?.data?.error ?? 'Please check the details and try again.');
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  const handlePublish = useCallback(
    (rel: AppUpdateAdmin) => {
      Alert.alert(
        'Publish Update',
        `Are you sure you want to publish v${rel.version} (Build ${rel.buildNumber}) to users?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Publish',
            style: 'destructive',
            onPress: async () => {
              setBusyId(rel.id);
              try {
                await publishAppUpdate(rel.id);
                await load();
              } catch (e: any) {
                Alert.alert('Could not publish', e?.data?.error ?? 'Please try again.');
              } finally {
                setBusyId(null);
              }
            },
          },
        ],
      );
    },
    [load],
  );

  const handleUnpublish = useCallback(
    async (rel: AppUpdateAdmin) => {
      setBusyId(rel.id);
      try {
        await unpublishAppUpdate(rel.id);
        await load();
      } catch {
        Alert.alert('Could not unpublish', 'Please try again.');
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  if (!isSuperAdmin) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Access denied.</Text>
      </View>
    );
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          App Update Manager
        </Text>
        <TouchableOpacity onPress={openNew} style={[styles.addBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
          <Feather name="plus" size={18} color="#FFF" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {formOpen && (
          <FlatCard animValue={anims[0]} style={styles.card}>
            <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {form.id ? 'Edit Release' : 'New Release'}
            </Text>

            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>Version (X.Y.Z)</Text>
                <TextInput style={inputStyle} value={form.version} onChangeText={(v) => set({ version: v })} placeholder="1.1.0" placeholderTextColor={colors.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>Build Number</Text>
                <TextInput style={inputStyle} value={form.buildNumber} onChangeText={(v) => set({ buildNumber: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="2" placeholderTextColor={colors.mutedForeground} />
              </View>
            </View>

            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>Release Date</Text>
                <TextInput style={inputStyle} value={form.releaseDate} onChangeText={(v) => set({ releaseDate: v })} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>Min Android</Text>
                <TextInput style={inputStyle} value={form.minAndroidVersion} onChangeText={(v) => set({ minAndroidVersion: v })} placeholder="8.0 (optional)" placeholderTextColor={colors.mutedForeground} />
              </View>
            </View>

            <View>
              <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>Update Type</Text>
              <View style={styles.typeRow}>
                {UPDATE_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => set({ updateType: t })}
                    style={[
                      styles.typeChip,
                      { borderColor: form.updateType === t ? colors.primary : colors.border, backgroundColor: form.updateType === t ? colors.primary + '1A' : 'transparent' },
                    ]}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: form.updateType === t ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_600SemiBold', fontSize: 12, textTransform: 'capitalize' }}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View>
              <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
                What&apos;s New (one point per line)
              </Text>
              <TextInput
                style={[...inputStyle, styles.notesInput]}
                value={form.notesText}
                onChangeText={(v) => set({ notesText: v })}
                placeholder={'Added advanced dealer ledger\nFixed invoice printing issue'}
                placeholderTextColor={colors.mutedForeground}
                multiline
              />
            </View>

            <View>
              <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>Demo Video URL (optional)</Text>
              <TextInput style={inputStyle} value={form.demoVideoUrl} onChangeText={(v) => set({ demoVideoUrl: v })} placeholder="https://…" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" />
            </View>

            <TouchableOpacity
              onPress={handlePickApk}
              disabled={uploading}
              style={[styles.uploadBtn, { borderColor: form.apkPath ? '#34D399' : colors.border }]}
              activeOpacity={0.7}
            >
              {uploading ? (
                <>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[styles.uploadText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    Uploading… {Math.round(uploadPct * 100)}%
                  </Text>
                </>
              ) : form.apkPath ? (
                <>
                  <Feather name="check-circle" size={16} color="#34D399" />
                  <Text style={[styles.uploadText, { color: '#34D399', fontFamily: 'Inter_600SemiBold' }]}>
                    APK uploaded — tap to replace
                  </Text>
                </>
              ) : (
                <>
                  <Feather name="upload" size={16} color={colors.primary} />
                  <Text style={[styles.uploadText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                    Upload APK file
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Size and SHA-256 checksum are calculated automatically on the server after upload.
            </Text>
            <View style={[styles.releaseWarning, { backgroundColor: '#F59E0B14', borderColor: '#F59E0B55' }]}>
              <Feather name="alert-triangle" size={16} color="#F59E0B" />
              <Text style={[styles.releaseWarningText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                Build a fresh APK from the latest GitHub branch. Version and Build Number must exactly match the
                expo.dev build details. Reusing or renaming an old APK will not include new features and is blocked.
              </Text>
            </View>

            <View style={styles.btnRow}>
              <TouchableOpacity onPress={() => setFormOpen(false)} style={[styles.smallBtn, { borderColor: colors.border }]} activeOpacity={0.8}>
                <Text style={[styles.smallBtnText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving || uploading}
                style={[styles.smallBtn, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
                activeOpacity={0.8}
              >
                {saving ? <ActivityIndicator size="small" color="#FFF" /> : (
                  <Text style={[styles.smallBtnText, { color: '#FFF', fontFamily: 'Inter_600SemiBold' }]}>
                    {form.id ? 'Save Changes' : 'Save as Draft'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </FlatCard>
        )}

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
          RELEASES & UPDATE HISTORY
        </Text>

        {releases === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : releases.length === 0 ? (
          <FlatCard animValue={anims[1]} style={[styles.card, { alignItems: 'center' }]}>
            <Feather name="package" size={28} color={colors.mutedForeground} />
            <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center' }]}>
              No releases yet. Tap + to create your first update release.
            </Text>
          </FlatCard>
        ) : (
          releases.map((rel) => {
            const statusColor =
              rel.status === 'published' ? '#34D399' : rel.status === 'draft' ? '#F59E0B' : colors.mutedForeground;
            return (
              <FlatCard key={rel.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                    v{rel.version} (Build {rel.buildNumber})
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusColor + '1A' }]}>
                    <Text style={{ color: statusColor, fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'capitalize' }}>
                      {rel.status}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {rel.releaseDate ?? '—'} · {formatBytes(rel.apkSize)} · {rel.updateType} · {rel.downloadCount} downloads
                  {rel.publishedByName ? ` · by ${rel.publishedByName}` : ''}
                </Text>
                {!rel.apkPath && (
                  <Text style={[styles.hint, { color: '#F59E0B', fontFamily: 'Inter_400Regular' }]}>
                    No APK uploaded yet — upload one before publishing.
                  </Text>
                )}
                <View style={styles.btnRow}>
                  <TouchableOpacity onPress={() => openEdit(rel)} style={[styles.smallBtn, { borderColor: colors.border }]} activeOpacity={0.8}>
                    <Feather name="edit-2" size={13} color={colors.foreground} />
                    <Text style={[styles.smallBtnText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Edit</Text>
                  </TouchableOpacity>
                  {rel.status === 'published' ? (
                    <TouchableOpacity
                      onPress={() => handleUnpublish(rel)}
                      disabled={busyId === rel.id}
                      style={[styles.smallBtn, { borderColor: colors.destructive + '55' }]}
                      activeOpacity={0.8}
                    >
                      {busyId === rel.id ? <ActivityIndicator size="small" color={colors.destructive} /> : (
                        <>
                          <Feather name="eye-off" size={13} color={colors.destructive} />
                          <Text style={[styles.smallBtnText, { color: colors.destructive, fontFamily: 'Inter_600SemiBold' }]}>Unpublish</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => handlePublish(rel)}
                      disabled={busyId === rel.id || !rel.apkPath}
                      style={[styles.smallBtn, { backgroundColor: rel.apkPath ? '#34D399' : colors.border, borderColor: 'transparent' }]}
                      activeOpacity={0.8}
                    >
                      {busyId === rel.id ? <ActivityIndicator size="small" color="#FFF" /> : (
                        <>
                          <Feather name="upload-cloud" size={13} color="#FFF" />
                          <Text style={[styles.smallBtnText, { color: '#FFF', fontFamily: 'Inter_600SemiBold' }]}>Publish</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </FlatCard>
            );
          })
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 16 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, flex: 1 },
  addBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 14 },
  card: { padding: 16, gap: 12 },
  cardTitle: { fontSize: 15 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { fontSize: 11, letterSpacing: 1 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 11.5, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  notesInput: { minHeight: 90, textAlignVertical: 'top' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed' },
  uploadText: { fontSize: 13.5 },
  hint: { fontSize: 12, lineHeight: 17 },
  releaseWarning: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 11, borderRadius: 12, borderWidth: 1 },
  releaseWarningText: { flex: 1, fontSize: 12, lineHeight: 17 },
  btnRow: { flexDirection: 'row', gap: 10 },
  smallBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 11, borderRadius: 12, borderWidth: 1 },
  smallBtnText: { fontSize: 13 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 12 },
});
