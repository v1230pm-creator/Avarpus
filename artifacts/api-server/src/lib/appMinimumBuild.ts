/**
 * Minimum supported app build, derived from the update console.
 *
 * A *critical* release forces every installed app up to at least that build,
 * so the highest build ever published as critical is the floor every device
 * has reached. That floor must survive later releases: publishing build N+1 as
 * "optional" archives critical build N, but N remains the minimum. It is
 * therefore recorded monotonically in `app_settings` at publish time and
 * backfilled from release history for releases published before the key
 * existed.
 *
 * The one thing that can lower the effective minimum is a rollback: when the
 * currently published release is an older build, fresh installs land below
 * the recorded floor, so the answer is capped by the live build.
 */

import { eq, sql } from "drizzle-orm";
import { db, appSettingsTable, APP_MIN_SUPPORTED_BUILD_KEY } from "@workspace/db";

type Tx = Pick<typeof db, "execute" | "select" | "insert" | "update">;

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Raise the recorded floor to `buildNumber`; never lowers it. */
export async function recordCriticalReleasePublished(tx: Tx, buildNumber: number): Promise<void> {
  const build = positiveInt(buildNumber);
  if (!build) return;
  await tx.execute(sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${APP_MIN_SUPPORTED_BUILD_KEY}, ${String(build)}, now())
    ON CONFLICT (key) DO UPDATE
      SET value = GREATEST(app_settings.value::int, EXCLUDED.value::int)::text,
          updated_at = now()
      WHERE app_settings.value !~ '^[0-9]+$' OR app_settings.value::int < EXCLUDED.value::int
  `);
}

/**
 * Highest critical build ever published (recorded key OR release history),
 * capped by the currently published build. Null when no critical release has
 * ever been published.
 */
export async function readMinimumSupportedAppBuild(): Promise<number | null> {
  const [recordedRow] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, APP_MIN_SUPPORTED_BUILD_KEY))
    .limit(1);
  const recorded = positiveInt(recordedRow?.value);

  const history = await db.execute(sql`
    SELECT
      (SELECT max(build_number) FROM app_updates
        WHERE update_type = 'critical' AND published_at IS NOT NULL
          AND status IN ('published', 'archived'))::int AS critical_floor,
      (SELECT max(build_number) FROM app_updates WHERE status = 'published')::int AS live_build
  `);
  const row = (history.rows as Array<{ critical_floor: number | null; live_build: number | null }>)[0];
  const historical = positiveInt(row?.critical_floor);
  const live = positiveInt(row?.live_build);

  const floor = Math.max(recorded ?? 0, historical ?? 0);
  if (floor === 0) return null;
  return live !== null && live < floor ? live : floor;
}
