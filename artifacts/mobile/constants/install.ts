import { Platform } from 'react-native';

// Official Android distribution channel for Avarpus: the managed APK download
// page on the public website. This is the only destination we hand to people
// who do not have the app yet, so it must stay permanent and publicly
// reachable — never a workspace preview domain or an Expo session URL.
export const AVARPUS_INSTALL_URL = 'https://avarpus.com/download';

// A link is only safe to send to an outsider when it is HTTPS and does not
// resolve to a temporary development host.
const TEMPORARY_HOST_PATTERN =
  /(^exp(o)?:\/\/)|(\.replit\.dev)|(\.repl\.co)|(\.replit\.app)|(localhost)|(\b\d{1,3}(\.\d{1,3}){3}\b)|(:\d+)/i;

export function isPermanentInstallLink(url: string): boolean {
  return url.startsWith('https://') && !TEMPORARY_HOST_PATTERN.test(url);
}

/**
 * SMS copy sent to a device contact who is not registered yet. Kept short so
 * it stays inside a single message, and always ends with the install link.
 */
export function buildAvarpusInviteMessage(installUrl: string = AVARPUS_INSTALL_URL): string {
  if (!isPermanentInstallLink(installUrl)) {
    throw new Error('invalid-install-link');
  }
  return `Join me on Avarpus for secure chat and service updates. Install the official app: ${installUrl}`;
}

/**
 * Android expects `sms:<number>?body=`, iOS expects `sms:<number>&body=`.
 */
export function buildInviteSmsUrl(phone: string, installUrl: string = AVARPUS_INSTALL_URL): string {
  const separator = Platform.OS === 'ios' ? '&' : '?';
  return `sms:+91${phone}${separator}body=${encodeURIComponent(buildAvarpusInviteMessage(installUrl))}`;
}
