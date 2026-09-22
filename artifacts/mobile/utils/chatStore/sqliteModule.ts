import type { SqlDatabase } from './sqliteStore';

export interface SqliteModule {
  openDatabaseAsync(name: string): Promise<SqlDatabase>;
  deleteDatabaseAsync(name: string): Promise<void>;
}

/**
 * expo-sqlite is a native module, required lazily so startup code never
 * touches it and a missing/broken binding (Expo Go build mismatch) degrades
 * to network-only rendering instead of crashing (see
 * .agents/memory/expo-go-native-imports.md). The `.web.ts` sibling keeps the
 * package — and its WebAssembly worker — out of the web bundle entirely.
 */
export function loadSqlite(): SqliteModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-sqlite') as Partial<SqliteModule>;
    if (typeof mod?.openDatabaseAsync !== 'function') return null;
    return mod as SqliteModule;
  } catch {
    return null;
  }
}
