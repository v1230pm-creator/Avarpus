import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Installed app version info. In a real APK build expo-application returns the
// native versionName/versionCode; in Expo Go / web we fall back to app.json.
export function getAppVersion(): string {
  return (
    Application.nativeApplicationVersion ||
    Constants.expoConfig?.version ||
    '1.0.0'
  );
}

export function getAppBuildNumber(): number {
  if (Platform.OS === 'android') {
    const native = Number.parseInt(Application.nativeBuildVersion ?? '', 10);
    if (Number.isFinite(native) && native > 0) return native;
  }
  const fromConfig = Constants.expoConfig?.android?.versionCode;
  if (typeof fromConfig === 'number' && fromConfig > 0) return fromConfig;
  return 1;
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
