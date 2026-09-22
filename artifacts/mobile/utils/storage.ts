import AsyncStorage from '@react-native-async-storage/async-storage';

export const storage = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const val = await AsyncStorage.getItem(key);
      return val ? (JSON.parse(val) as T) : null;
    } catch {
      return null;
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {}
  },

  async clear(): Promise<void> {
    try {
      await AsyncStorage.clear();
    } catch {}
  },
};

export const KEYS = {
  USERS: 'vmc_users',
  CURRENT_USER: 'vmc_current_user',
  AUTH_TOKEN: 'vmc_auth_token',
  REPAIRS: 'vmc_repairs',
  CUSTOMERS: 'vmc_customers',
  INVENTORY: 'vmc_inventory',
  PURCHASES: 'vmc_purchases',
  FINANCE: 'vmc_finance',
  ATTENDANCE: 'vmc_attendance',
  SETTINGS: 'vmc_settings',
  APP_UPDATE_DOWNLOAD: 'vmc_app_update_download',
  PUSH_TOKEN: 'vmc_push_token',
  PUSH_DEVICE_ID: 'vmc_push_device_id',
  PUSH_DIAGNOSTICS: 'vmc_push_diagnostics',
  PUSH_CHANNELS_VERSION: 'vmc_push_channels_version',
  CHAT_STORES: 'vmc_chat_stores',
  CHAT_AUTO_DOWNLOAD: 'vmc_chat_auto_download',
  SEEDED: 'vmc_seeded',
};
