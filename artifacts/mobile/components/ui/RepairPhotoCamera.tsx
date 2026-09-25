import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions, type CameraType, type FlashMode } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { font } from '@/constants/typography';
import { hitSlop, layout, radius, size, space } from '@/constants/spacing';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';
import { prepareRepairPhoto } from '@/utils/repairPhoto';

export interface RepairPhotoKind {
  id: string;
  label: string;
}

export interface PickedRepairPhoto {
  /** JPEG in the app cache, ready to upload. */
  uri: string;
  kind: string;
}

/** How many gallery items each page brings in; the strip and the grid share the pages. */
const RECENTS_PAGE = 30;

type Step = 'camera' | 'gallery' | 'review';
type MediaAccess = 'idle' | 'loading' | 'granted' | 'limited' | 'denied' | 'unavailable' | 'error';

interface ReviewPhoto {
  uri: string;
  width?: number;
  height?: number;
  /** Camera captures are temp files this component owns; gallery items are not. */
  source: 'camera' | 'gallery';
  /** Where "back" from the review returns to. */
  returnTo: 'camera' | 'gallery';
}

const FLASH_ORDER: FlashMode[] = ['off', 'on', 'auto'];

/**
 * In-app camera for device photos on the intake form: the viewfinder opens
 * straight away with a strip of the newest gallery photos under it, a shutter,
 * and a camera flip — no mode rail, no settings, no video. The full gallery
 * is a grid inside the same modal, so nothing native is ever presented over
 * it. After a capture or a pick the picture is reviewed and given its
 * category, then handed back as a cache JPEG the form uploads unchanged.
 *
 * The chrome is fixed dark in both themes, like the photo viewer.
 */
export function RepairPhotoCamera({ visible, kinds, onClose, onPicked }: {
  visible: boolean;
  kinds: readonly RepairPhotoKind[];
  onClose: () => void;
  onPicked: (photo: PickedRepairPhoto) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const cameraRef = useRef<CameraView>(null);

  const [cameraPermission, requestCameraPermission, getCameraPermission] = useCameraPermissions();
  const [step, setStep] = useState<Step>('camera');
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [cameraReady, setCameraReady] = useState(false);
  const [review, setReview] = useState<ReviewPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mediaAccess, setMediaAccess] = useState<MediaAccess>('idle');
  const mediaAccessRef = useRef<MediaAccess>('idle');
  mediaAccessRef.current = mediaAccess;
  const [mediaCanAskAgain, setMediaCanAskAgain] = useState(true);
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [assetsCursor, setAssetsCursor] = useState<string | null>(null);
  const [assetsHasMore, setAssetsHasMore] = useState(false);
  const [assetsLoadingMore, setAssetsLoadingMore] = useState(false);

  const loadRecents = useCallback(async (askIfNeeded: boolean) => {
    if (Platform.OS === 'web') {
      setMediaAccess('unavailable');
      return;
    }
    setMediaAccess('loading');
    try {
      let permission = await MediaLibrary.getPermissionsAsync(false, ['photo']);
      if (!permission.granted && askIfNeeded && permission.canAskAgain) {
        permission = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      }
      setMediaCanAskAgain(permission.canAskAgain);
      if (!permission.granted) {
        setAssets([]);
        setAssetsCursor(null);
        setAssetsHasMore(false);
        setMediaAccess('denied');
        return;
      }
      const page = await MediaLibrary.getAssetsAsync({
        first: RECENTS_PAGE,
        mediaType: ['photo'],
        sortBy: [['creationTime', false]],
      });
      setAssets(page.assets);
      setAssetsCursor(page.endCursor || null);
      setAssetsHasMore(page.hasNextPage);
      setMediaAccess(permission.accessPrivileges === 'limited' ? 'limited' : 'granted');
    } catch {
      setAssets([]);
      setAssetsCursor(null);
      setAssetsHasMore(false);
      setMediaAccess('error');
    }
  }, []);

  const loadMoreRecents = useCallback(async () => {
    if (assetsLoadingMore || !assetsHasMore || !assetsCursor) return;
    setAssetsLoadingMore(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({
        first: RECENTS_PAGE,
        after: assetsCursor,
        mediaType: ['photo'],
        sortBy: [['creationTime', false]],
      });
      setAssets((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...page.assets.filter((a) => !seen.has(a.id))];
      });
      setAssetsCursor(page.endCursor || null);
      setAssetsHasMore(page.hasNextPage);
    } catch {
      setAssetsHasMore(false);
    } finally {
      setAssetsLoadingMore(false);
    }
  }, [assetsCursor, assetsHasMore, assetsLoadingMore]);

  // Every open starts on the viewfinder. Permissions are asked one at a time:
  // the camera first (a permanent denial becomes a Settings prompt instead of
  // a dead viewfinder), then the photo library, so two system dialogs never
  // race each other on a fresh install. Recents are re-read on every open —
  // photos taken in other apps since the last open belong at the front.
  // Camera readiness is only cleared where the viewfinder actually unmounts
  // (close, gallery grid); the review step keeps it mounted underneath so a
  // retake is instant.
  useEffect(() => {
    if (!visible) {
      setCameraReady(false);
      return;
    }
    setStep('camera');
    setReview(null);
    setError(null);
    setBusy(false);
    let cancelled = false;
    void (async () => {
      try {
        const current = await getCameraPermission();
        if (cancelled) return;
        if (current && !current.granted && current.canAskAgain) {
          await requestCameraPermission();
          if (cancelled) return;
        }
      } catch {
        // The hook already surfaces the permission state; a failed read only
        // means the request is skipped this open.
      }
      await loadRecents(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, getCameraPermission, requestCameraPermission, loadRecents]);

  // Coming back from Settings must not strand the user on a denial screen:
  // re-read both permissions whenever the app returns to the foreground while
  // the camera is open.
  useEffect(() => {
    if (!visible) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void getCameraPermission().catch(() => undefined);
      if (mediaAccessRef.current === 'denied' || mediaAccessRef.current === 'error') void loadRecents(false);
    });
    return () => subscription.remove();
  }, [visible, getCameraPermission, loadRecents]);

  const openGallery = () => {
    setCameraReady(false);
    setError(null);
    setStep('gallery');
  };

  const goBack = () => {
    if (busy) return;
    if (step === 'camera') {
      onClose();
      return;
    }
    if (review?.source === 'camera') {
      // The rejected capture is ours to delete.
      void FileSystem.deleteAsync(review.uri, { idempotent: true }).catch(() => undefined);
    }
    const returnTo = review?.returnTo ?? 'camera';
    setReview(null);
    setError(null);
    if (returnTo === 'gallery') setCameraReady(false);
    setStep(returnTo);
  };

  const takePhoto = async () => {
    if (!cameraReady || busy) return;
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      const picture = await cameraRef.current?.takePictureAsync({ quality: 0.9, exif: false });
      if (!picture?.uri) throw new Error('empty capture');
      setReview({ uri: picture.uri, width: picture.width, height: picture.height, source: 'camera', returnTo: 'camera' });
      setStep('review');
    } catch {
      setError('Could not take the photo. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const pickAsset = async (asset: MediaLibrary.Asset, from: 'camera' | 'gallery') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let uri = asset.uri;
      try {
        // SDK 57's bridge wants the stable id; the full object can be rejected on Android.
        const info = await MediaLibrary.getAssetInfoAsync(asset.id);
        uri = info.localUri ?? info.uri ?? asset.uri;
      } catch {
        // Provider-backed or limited-access items can refuse the lookup while
        // their listed URI still opens; the manipulator reports if it does not.
      }
      if (!uri) throw new Error('no uri');
      setReview({ uri, width: asset.width, height: asset.height, source: 'gallery', returnTo: from });
      setStep('review');
    } catch {
      setError('Could not open that photo.');
    } finally {
      setBusy(false);
    }
  };

  const confirmKind = async (kind: string) => {
    if (!review || busy) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareRepairPhoto(review);
      if (review.source === 'camera' && prepared.uri !== review.uri) {
        void FileSystem.deleteAsync(review.uri, { idempotent: true }).catch(() => undefined);
      }
      onPicked({ uri: prepared.uri, kind });
    } catch {
      setError('Could not save the photo. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const cycleFlash = () => setFlash((f) => FLASH_ORDER[(FLASH_ORDER.indexOf(f) + 1) % FLASH_ORDER.length]);
  // onCameraReady is not guaranteed to fire again after a facing change, so the
  // shutter stays enabled across a flip.
  const flip = () => setFacing((f) => (f === 'back' ? 'front' : 'back'));

  const openMediaSettings = () => {
    if (mediaCanAskAgain) void loadRecents(true);
    else void Linking.openSettings();
  };

  const topInset = insets.top + space.sm;
  const bottomInset = insets.bottom + space.lg;
  const gridTile = Math.floor((windowWidth - space.xs * 2) / 3);
  const latest = assets[0] ?? null;

  const renderTopBar = (leading: React.ReactNode, title: string, trailing?: React.ReactNode) => (
    <View style={[styles.topBar, { paddingTop: topInset }]}>
      {leading}
      <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
      {trailing ?? <View style={styles.iconButton} />}
    </View>
  );

  const backButton = (label: string, icon: 'x' | 'arrow-left', testID: string) => (
    <TouchableOpacity
      onPress={goBack}
      style={styles.iconButton}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Feather name={icon} size={size.headerIcon} color="#FFFFFF" />
    </TouchableOpacity>
  );

  const errorBanner = error ? (
    <View style={[styles.errorBanner, { backgroundColor: colors.destructive }]} accessibilityLiveRegion="polite">
      <Text style={styles.errorText}>{error}</Text>
    </View>
  ) : null;

  const mediaNotice = (() => {
    if (mediaAccess === 'denied') {
      return (
        <TouchableOpacity onPress={openMediaSettings} style={styles.noticePill} accessibilityRole="button" testID="repair-camera-allow-photos">
          <Feather name="image" size={size.inlineIcon} color="#FFFFFF" />
          <Text style={styles.noticeText}>{mediaCanAskAgain ? 'Allow photo access to pick from the gallery' : 'Photo access is off — open Settings'}</Text>
        </TouchableOpacity>
      );
    }
    if (mediaAccess === 'error') {
      return (
        <TouchableOpacity onPress={() => void loadRecents(false)} style={styles.noticePill} accessibilityRole="button" testID="repair-camera-retry-photos">
          <Feather name="refresh-cw" size={size.inlineIcon} color="#FFFFFF" />
          <Text style={styles.noticeText}>Could not read the gallery — tap to retry</Text>
        </TouchableOpacity>
      );
    }
    return null;
  })();

  const renderCamera = () => {
    if (!cameraPermission?.granted) {
      return (
        <View style={styles.fill}>
          {renderTopBar(backButton('Close camera', 'x', 'repair-camera-close'), 'Device photo')}
          {/* Nothing to say until the first permission read lands. */}
          {cameraPermission ? <View style={styles.permissionBody}>
            <Feather name="camera-off" size={size.fabIcon} color="#FFFFFF" />
            <Text style={styles.permissionTitle}>Camera access needed</Text>
            <Text style={styles.permissionText}>
              {cameraPermission.canAskAgain
                ? 'Allow the camera to photograph the device as it comes in.'
                : 'Camera access is turned off for Avarpus. Turn it on in Settings to take device photos.'}
            </Text>
            <TouchableOpacity
              onPress={() => void (cameraPermission.canAskAgain ? requestCameraPermission() : Linking.openSettings())}
              style={[styles.primaryPill, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
              testID="repair-camera-allow"
            >
              <Text style={styles.primaryPillText}>{cameraPermission.canAskAgain ? 'Allow camera' : 'Open Settings'}</Text>
            </TouchableOpacity>
            {assets.length > 0 ? (
              <TouchableOpacity onPress={openGallery} style={styles.secondaryPill} accessibilityRole="button">
                <Text style={styles.noticeText}>Choose from gallery instead</Text>
              </TouchableOpacity>
            ) : null}
          </View> : null}
        </View>
      );
    }
    return (
      <View style={styles.fill}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash}
          mode="picture"
          onCameraReady={() => setCameraReady(true)}
        />
        {renderTopBar(
          backButton('Close camera', 'x', 'repair-camera-close'),
          'Device photo',
          <TouchableOpacity
            onPress={cycleFlash}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={`Flash ${flash}`}
            testID="repair-camera-flash"
          >
            <Feather name={flash === 'off' ? 'zap-off' : 'zap'} size={size.headerIcon} color={flash === 'off' ? '#FFFFFF' : colors.primary} />
            {flash === 'auto' ? <Text style={[styles.flashAuto, { color: colors.primary }]}>A</Text> : null}
          </TouchableOpacity>,
        )}
        <View style={[styles.bottomPanel, { paddingBottom: bottomInset }]}>
          {errorBanner}
          {mediaNotice}
          {assets.length > 0 ? (
            <FlatList
              horizontal
              data={assets}
              keyExtractor={(a) => a.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.strip}
              onEndReached={() => void loadMoreRecents()}
              onEndReachedThreshold={0.6}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => void pickAsset(item, 'camera')}
                  activeOpacity={0.8}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`Use gallery photo ${item.filename}`}
                  testID={`repair-camera-recent-${item.id}`}
                >
                  <Image source={{ uri: item.uri }} style={styles.stripTile} contentFit="cover" recyclingKey={item.id} />
                </TouchableOpacity>
              )}
              ListFooterComponent={assetsLoadingMore ? <AvarpusSpinner size={size.inlineIcon} color="#FFFFFF" style={styles.stripSpinner} /> : null}
            />
          ) : null}
          <View style={styles.shutterRow}>
            <TouchableOpacity
              onPress={openGallery}
              disabled={mediaAccess !== 'granted' && mediaAccess !== 'limited'}
              style={[styles.galleryButton, (mediaAccess !== 'granted' && mediaAccess !== 'limited') && styles.dimmed]}
              accessibilityRole="button"
              accessibilityLabel="Open gallery"
              testID="repair-camera-gallery"
            >
              {latest ? (
                <Image source={{ uri: latest.uri }} style={styles.galleryThumb} contentFit="cover" />
              ) : (
                <Feather name="image" size={size.headerIcon} color="#FFFFFF" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void takePhoto()}
              disabled={!cameraReady || busy}
              activeOpacity={0.7}
              style={[styles.shutter, (!cameraReady || busy) && styles.dimmed]}
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              accessibilityState={{ disabled: !cameraReady || busy }}
              testID="repair-camera-shutter"
            >
              {busy ? <AvarpusSpinner size={size.headerIcon} color="#000000" /> : <View style={styles.shutterDot} />}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={flip}
              style={styles.iconButtonFilled}
              accessibilityRole="button"
              accessibilityLabel="Switch camera"
              testID="repair-camera-flip"
            >
              <Feather name="refresh-cw" size={size.headerIcon} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const renderGallery = () => (
    <View style={styles.fill}>
      {renderTopBar(
        backButton('Back to camera', 'arrow-left', 'repair-camera-gallery-back'),
        'Gallery',
        mediaAccess === 'limited' ? (
          <TouchableOpacity
            onPress={() => void MediaLibrary.presentPermissionsPickerAsync().then(() => loadRecents(false)).catch(() => undefined)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Choose more photos"
          >
            <Feather name="plus-square" size={size.headerIcon} color="#FFFFFF" />
          </TouchableOpacity>
        ) : undefined,
      )}
      {errorBanner}
      <FlatList
        data={assets}
        keyExtractor={(a) => a.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.grid, { paddingBottom: bottomInset }]}
        onEndReached={() => void loadMoreRecents()}
        onEndReachedThreshold={0.8}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => void pickAsset(item, 'gallery')}
            activeOpacity={0.8}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Use gallery photo ${item.filename}`}
            testID={`repair-camera-grid-${item.id}`}
          >
            <Image source={{ uri: item.uri }} style={{ width: gridTile, height: gridTile }} contentFit="cover" recyclingKey={item.id} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.permissionText}>{mediaAccess === 'loading' ? 'Loading photos…' : 'No photos on this device yet.'}</Text>}
        ListFooterComponent={assetsLoadingMore ? <AvarpusSpinner size={size.headerIcon} color="#FFFFFF" style={styles.gridSpinner} /> : null}
      />
    </View>
  );

  const renderReview = () => (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      {review ? <Image source={{ uri: review.uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel="Photo to add" /> : null}
      {renderTopBar(backButton(review?.source === 'camera' ? 'Retake' : 'Choose another', 'arrow-left', 'repair-camera-retake'), 'Photo category')}
      <View style={[styles.bottomPanel, styles.reviewPanel, { paddingBottom: bottomInset }]}>
        {errorBanner}
        <Text style={styles.reviewPrompt}>Which photo is this?</Text>
        <View style={styles.kindWrap}>
          {kinds.map((k) => (
            <TouchableOpacity
              key={k.id}
              onPress={() => void confirmKind(k.id)}
              disabled={busy}
              hitSlop={hitSlop.chip}
              style={[styles.kindChip, busy && styles.dimmed]}
              accessibilityRole="button"
              accessibilityLabel={`Add as ${k.label}`}
              testID={`repair-camera-kind-${k.id}`}
            >
              <Text style={styles.kindChipText}>{k.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {busy ? (
          <View style={styles.savingRow}>
            <AvarpusSpinner size={size.inlineIcon} color="#FFFFFF" />
            <Text style={styles.noticeText}>Saving photo…</Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={goBack}>
      <View style={styles.root} testID="repair-camera">
        {step === 'gallery' ? renderGallery() : (
          <>
            {renderCamera()}
            {step === 'review' ? renderReview() : null}
          </>
        )}
      </View>
    </Modal>
  );
}

const CHROME_BG = 'rgba(0, 0, 0, 0.55)';
const CONTROL_BG = 'rgba(255, 255, 255, 0.15)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  fill: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    backgroundColor: CHROME_BG,
  },
  topTitle: { ...font.label, color: '#FFFFFF', flex: 1, textAlign: 'center' },
  iconButton: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonFilled: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CONTROL_BG,
  },
  flashAuto: { ...font.small, position: 'absolute', right: space.xs, bottom: space.xs },
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space.md,
    gap: space.md,
    backgroundColor: CHROME_BG,
  },
  reviewPanel: { paddingHorizontal: layout.screenPadding },
  strip: { paddingHorizontal: layout.screenPadding, gap: space.sm, alignItems: 'center' },
  stripTile: { width: size.photoThumb, height: size.photoThumb, borderRadius: radius.sm, backgroundColor: CONTROL_BG },
  stripSpinner: { marginHorizontal: space.sm },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding + space.md,
  },
  galleryButton: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CONTROL_BG,
  },
  galleryThumb: { width: size.iconButton, height: size.iconButton },
  shutter: {
    width: size.shutter,
    height: size.shutter,
    borderRadius: radius.pill,
    borderWidth: space.xs,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDot: { width: size.shutterDot, height: size.shutterDot, borderRadius: radius.pill, backgroundColor: '#FFFFFF' },
  dimmed: { opacity: 0.5 },
  errorBanner: {
    marginHorizontal: layout.screenPadding,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
  errorText: { ...font.caption, color: '#FFFFFF' },
  noticePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'center',
    minHeight: size.iconButton,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: CONTROL_BG,
  },
  noticeText: { ...font.caption, color: '#FFFFFF' },
  permissionBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding * 2,
    gap: space.md,
  },
  permissionTitle: { ...font.heading, color: '#FFFFFF', textAlign: 'center' },
  permissionText: { ...font.body, color: '#FFFFFF', textAlign: 'center', padding: space.lg },
  primaryPill: {
    minHeight: size.button,
    paddingHorizontal: space.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPillText: { ...font.button, color: '#FFFFFF' },
  secondaryPill: {
    minHeight: size.iconButton,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { padding: space.xs, gap: space.xs },
  gridRow: { gap: space.xs },
  gridSpinner: { alignSelf: 'center', marginVertical: space.lg },
  reviewPrompt: { ...font.label, color: '#FFFFFF' },
  // Rows sit 12dp apart so the chips' 6dp vertical hit slop never overlaps the next row.
  kindWrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm, rowGap: space.md },
  kindChip: {
    height: size.chip,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: CONTROL_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindChipText: { ...font.caption, color: '#FFFFFF' },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
