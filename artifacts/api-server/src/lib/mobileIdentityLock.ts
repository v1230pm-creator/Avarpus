import { sql, type SQL } from "drizzle-orm";
import { normaliseIndianMobile } from "./hanuOtp";

// A minimal structural type keeps this usable with Drizzle's db transaction
// client without coupling callers to a particular driver generic.
type TransactionExecutor = { execute(query: SQL): Promise<unknown> };

/** Normalize valid Indian numbers, de-duplicate, then sort lock keys. */
export function normalizedMobileLockKeys(...mobiles: Array<string | null | undefined>): string[] {
  return [...new Set(
    mobiles.flatMap((mobile) => {
      if (!mobile) return [];
      const normalized = normaliseIndianMobile(mobile);
      return normalized ? [normalized] : [];
    }),
  )].sort();
}

/** Acquire transaction-scoped locks in a globally deterministic order. */
export async function lockNormalizedMobiles(
  tx: TransactionExecutor,
  ...mobiles: Array<string | null | undefined>
): Promise<string[]> {
  const keys = normalizedMobileLockKeys(...mobiles);
  for (const mobile of keys) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${mobile}))`);
  }
  return keys;
}