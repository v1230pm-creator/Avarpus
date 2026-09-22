import { Platform } from 'react-native';
import { File } from 'expo-file-system';

/**
 * Best-effort disposal of an app-owned temp file (voice-note segments,
 * downloaded attachments) or a web blob URL. Lives outside the recorder hook
 * so app-wide code (the chat outbox) can dispose files without pulling
 * expo-audio into the startup module graph.
 */
export function deleteOwnedTempFile(uri: string | null | undefined) {
  if (!uri) return;
  if (Platform.OS === 'web') {
    if (uri.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(uri);
      } catch {
        // Already revoked.
      }
    }
    return;
  }
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Cache files — the OS reclaims them if we cannot.
  }
}
