import { Platform } from 'react-native';
import { storage, KEYS } from '@/utils/storage';
import { deleteAccountMedia, deleteOtherAccountsMedia } from '@/utils/chatMedia/files';
import { MemoryChatStore } from './memoryStore';
import { SqliteChatStore } from './sqliteStore';
import { loadSqlite, type SqliteModule } from './sqliteModule';
import { META_KEYS, type ChatStore } from './types';

export * from './types';
export { MemoryChatStore } from './memoryStore';
export { SqliteChatStore } from './sqliteStore';

export function chatDatabaseName(accountId: string): string {
  // Account ids are UUIDs; keep the file name defensive anyway.
  return `chat-${accountId.replace(/[^a-zA-Z0-9_-]/g, '_')}.db`;
}

async function knownDatabases(): Promise<string[]> {
  return (await storage.get<string[]>(KEYS.CHAT_STORES)) ?? [];
}

/**
 * Deletes every on-device chat database except the given account's. Called on
 * open so a crash between sign-out and wipe can never leave another account's
 * conversations readable by the next sign-in.
 */
async function removeOtherDatabases(sqlite: SqliteModule, keep: string | null): Promise<void> {
  const names = await knownDatabases();
  const remaining: string[] = [];
  for (const name of names) {
    if (name === keep) {
      remaining.push(name);
      continue;
    }
    try {
      await sqlite.deleteDatabaseAsync(name);
    } catch {
      // Best effort: the file may already be gone. Keep it listed so the next
      // open tries again rather than forgetting about it.
      remaining.push(name);
    }
  }
  await storage.set(KEYS.CHAT_STORES, remaining);
}

export interface OpenChatStoreOptions {
  accountId: string;
  /** Active workspace; rooms are shop-scoped so a switch resets the store. */
  shopId: string | null;
}

/**
 * Opens the chat store for the signed-in account, or returns null when no
 * durable store can be opened on this device (the caller then renders from
 * the network only — never a blank screen).
 */
export async function openChatStore(options: OpenChatStoreOptions): Promise<ChatStore | null> {
  const { accountId, shopId } = options;
  let store: ChatStore;
  if (Platform.OS === 'web') {
    store = new MemoryChatStore(accountId);
  } else {
    const sqlite = loadSqlite();
    if (!sqlite) return null;
    const name = chatDatabaseName(accountId);
    try {
      await removeOtherDatabases(sqlite, name);
      const db = await sqlite.openDatabaseAsync(name);
      store = await SqliteChatStore.open(accountId, db);
      const names = await knownDatabases();
      if (!names.includes(name)) await storage.set(KEYS.CHAT_STORES, [...names, name]);
    } catch {
      return null;
    }
  }
  // A workspace switch changes which rooms this account can see; the cursor
  // and rows from the previous shop must not bleed into the new one.
  const storedShop = await store.getMeta(META_KEYS.SHOP_ID);
  const currentShop = shopId ?? '';
  if (storedShop !== null && storedShop !== currentShop) {
    await store.wipe();
    // The media index went with the rows; the files must not outlive it.
    await deleteAccountMedia(accountId).catch(() => {});
  }
  await store.setMeta(META_KEYS.SHOP_ID, currentShop);
  // Same guarantee as removeOtherDatabases for attachment files.
  await deleteOtherAccountsMedia(accountId).catch(() => {});
  return store;
}

/**
 * Destroys the account's chat database (rows + file). Used on sign-out,
 * account switch and permanent deletion. Safe to call without an open store.
 */
export async function destroyChatStore(store: ChatStore | null, accountId: string | null): Promise<void> {
  if (store) {
    try {
      await store.wipe();
    } catch {
      // The file delete below is the real guarantee on native.
    }
    try {
      await store.close();
    } catch {
      // Already closed.
    }
  }
  if (Platform.OS === 'web') return;
  if (accountId) await deleteAccountMedia(accountId).catch(() => {});
  await deleteOtherAccountsMedia(null).catch(() => {});
  const sqlite = loadSqlite();
  if (!sqlite) return;
  const keep = null;
  if (accountId) {
    const name = chatDatabaseName(accountId);
    const names = await knownDatabases();
    if (!names.includes(name)) await storage.set(KEYS.CHAT_STORES, [...names, name]);
  }
  await removeOtherDatabases(sqlite, keep);
}
