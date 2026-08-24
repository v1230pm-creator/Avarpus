import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const OTP_RATE_LIMIT_MIGRATION_TAGS = [
  "0032_old_roland_deschain",
  "0033_abandoned_malcolm_colcord",
] as const;

interface MigrationJournal {
  entries: Array<{ tag: string; when: number }>;
}

/**
 * Production schema publishing can create tables before the runtime Drizzle
 * journal is updated. These two migrations are non-idempotent, so reconcile
 * their journal entries only after verifying the complete resulting schema.
 */
export async function reconcileOtpRateLimitMigrationJournal(
  migrationsFolder: string,
): Promise<number> {
  const journalTable = await db.execute(
    sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`,
  );

  if (!journalTable.rows[0]?.exists) {
    return 0;
  }

  const schemaState = await db.execute(sql`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'otp_verification_rate_limits'
      ) AS table_exists,
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'otp_verification_rate_limits'
          AND column_name IN (
            'key_hash',
            'failure_count',
            'window_started_at',
            'locked_until',
            'expires_at',
            'updated_at',
            'in_flight_token',
            'in_flight_until'
          )
      ) = 8 AS all_columns_exist,
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'otp_verification_rate_limits'
          AND indexname = 'otp_verification_rate_limits_expires_idx'
      ) AS index_exists
  `);

  const state = schemaState.rows[0];
  if (!state?.table_exists || !state.all_columns_exist || !state.index_exists) {
    return 0;
  }

  const journal = JSON.parse(
    await readFile(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;
  const migrations = await Promise.all(
    OTP_RATE_LIMIT_MIGRATION_TAGS.map(async (tag) => {
      const entry = journal.entries.find((candidate) => candidate.tag === tag);
      if (!entry) {
        throw new Error(`Migration journal entry is missing for ${tag}`);
      }

      const content = await readFile(path.join(migrationsFolder, `${tag}.sql`), "utf8");
      return {
        createdAt: entry.when,
        hash: createHash("sha256").update(content).digest("hex"),
      };
    }),
  );

  return db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(
        'LOCK TABLE drizzle."__drizzle_migrations" IN SHARE ROW EXCLUSIVE MODE',
      ),
    );

    const applied = await tx.execute(
      sql`SELECT hash FROM drizzle."__drizzle_migrations"`,
    );
    const appliedHashes = new Set(applied.rows.map((row) => String(row.hash)));
    let recovered = 0;

    for (const migration of migrations) {
      if (appliedHashes.has(migration.hash)) continue;

      await tx.execute(sql`
        INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
        VALUES (${migration.hash}, ${migration.createdAt})
      `);
      recovered += 1;
    }

    return recovered;
  });
}