import type { SqliteModule } from './sqliteModule';

export type { SqliteModule };

/** Web renders chat from the in-memory store; SQLite is never bundled there. */
export function loadSqlite(): SqliteModule | null {
  return null;
}
