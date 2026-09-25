import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font } from '@/constants/typography';
import { size, space } from '@/constants/spacing';

export interface ViewerPhoto {
  /** Absolute URL of the image; server entity paths need the bearer token. */
  uri: string;
  /** Caption under the image (photo kind, "signature"). */
  label: string;
}

/**
 * Fullscreen photo / signature viewer shared by the repair list and detail:
 * near-black scrim, a close button in the top-right, the caption at the bottom.
 * The scrim is the same in both themes, so its colours are fixed here.
 */
export function PhotoViewerModal({ photo, token, onClose }: { photo: ViewerPhoto | null; token: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!photo} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <TouchableOpacity
          style={[styles.close, { top: insets.top + space.md }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
        >
          <Feather name="x" size={size.headerIcon} color="#FFFFFF" />
        </TouchableOpacity>
        {photo && (
          <>
            <Image
              source={{ uri: photo.uri, headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
              style={[styles.image, { marginVertical: insets.top + size.iconButton + space.lg }]}
              contentFit="contain"
              accessibilityLabel={photo.label}
            />
            <Text style={[styles.caption, { bottom: insets.bottom + space.xxl }]}>{photo.label}</Text>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.92)' },
  close: {
    position: 'absolute',
    right: space.lg,
    zIndex: 2,
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: size.iconButton / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { flex: 1 },
  caption: { ...font.label, position: 'absolute', alignSelf: 'center', color: '#FFFFFF', textTransform: 'capitalize' },
});
