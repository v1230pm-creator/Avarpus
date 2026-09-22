/**
 * Chat media relay purge history.
 *
 * The purge itself only keeps the most recent run summary (`app_settings`
 * key `chat_relay_last_run`). That tells an operator what happened last night,
 * not whether the relay is shrinking or whether media keeps piling up because
 * recipients never store it. This module keeps a bounded history of
 * whole-relay runs in `chat_relay_runs` and measures what the relay still
 * holds, so the console can show the trend.
 *
 * Rules:
 *  - Bookkeeping only. Nothing here influences a purge decision.
 *  - Fail-safe. `recordChatRelayRun` never throws: a failed measurement,
 *    insert or prune is logged and the purge result is returned unchanged.
 *  - Bounded. Every write prunes rows older than the retention window and
 *    anything beyond the row cap (newest kept), so a "Run now" habit cannot
 *    grow the table without limit.
 */

import { desc, gte, sql } from "drizzle-orm";
import { chatRelayRunsTable, db } from "@workspace/db";
import { logger } from "./logger";
import type { ChatRelayCleanupResult } from "./chatRelayCleanup";

/** Runs older than this are pruned on the next write. */
export const CHAT_RELAY_HISTORY_DAYS = 90;
/** Hard cap on retained runs, newest first, whatever their age. */
export const CHAT_RELAY_HISTORY_MAX_RUNS = 500;

export type ChatRelayRunTrigger = "scheduled" | "manual";

/** Relay objects still `available` (bytes are the sum of known sizes). */
export type ChatRelayHeld = {
  objects: number;
  bytes: number;
  /** Legacy media rows without a recorded size; their bytes are not in `bytes`. */
  unknownSizeObjects: number;
  /** Evidence under an open abuse report; exempt from every purge rule. */
  pinnedObjects: number;
  pinnedBytes: number;
};

export type ChatRelayRunRecord = {
  id: string;
  ranAt: string;
  trigger: ChatRelayRunTrigger;
  skipped: "disabled" | "min_build_not_met" | null;
  graceDays: number;
  expiryDays: number;
  examined: number;
  purged: number;
  expired: number;
  alreadyGone: number;
  tombstonesPurged: number;
  kept: number;
  raced: number;
  failed: number;
  bytesReclaimed: number;
  abortedError: string | null;
  heldObjects: number | null;
  heldBytes: number | null;
};

export type ChatRelayHistory = {
  windowDays: number;
  maxRuns: number;
  generatedAt: string;
  held: ChatRelayHeld;
  /** Newest first, within the window, at most `maxRuns`. */
  runs: ChatRelayRunRecord[];
};

type HeldRow = {
  objects: number | string;
  bytes: number | string | null;
  unknown_size_objects: number | string;
  pinned_objects: number | string;
  pinned_bytes: number | string | null;
};

function asCount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/**
 * Measure what the relay still holds: every message whose relay object is
 * still `available`. Bytes come from the size recorded at attach time; legacy
 * rows without one are counted separately so the figure is honest.
 */
export async function measureRelayHeld(): Promise<ChatRelayHeld> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS objects,
           coalesce(sum(size_bytes), 0)::bigint AS bytes,
           count(*) FILTER (WHERE size_bytes IS NULL)::int AS unknown_size_objects,
           count(*) FILTER (WHERE media_pinned)::int AS pinned_objects,
           coalesce(sum(size_bytes) FILTER (WHERE media_pinned), 0)::bigint AS pinned_bytes
    FROM chat_messages
    WHERE object_path IS NOT NULL
      AND media_state = 'available'
  `);
  const row = (result.rows as HeldRow[])[0];
  return {
    objects: asCount(row?.objects),
    bytes: asCount(row?.bytes),
    unknownSizeObjects: asCount(row?.unknown_size_objects),
    pinnedObjects: asCount(row?.pinned_objects),
    pinnedBytes: asCount(row?.pinned_bytes),
  };
}

/**
 * Drop runs past the retention window and anything beyond the row cap
 * (newest kept). Returns the number of rows removed.
 */
export async function pruneChatRelayRuns(): Promise<number> {
  const windowInterval = `${CHAT_RELAY_HISTORY_DAYS} days`;
  const result = await db.execute(sql`
    DELETE FROM chat_relay_runs
    WHERE ran_at < now() - ${windowInterval}::interval
       OR id IN (
         SELECT id FROM chat_relay_runs
         ORDER BY ran_at DESC, id DESC
         OFFSET ${CHAT_RELAY_HISTORY_MAX_RUNS}
       )
  `);
  return result.rowCount ?? 0;
}

/**
 * Append one whole-relay run to the history and prune the table back within
 * its bounds. Never throws: a purge that already did its work must not be
 * reported as failed because its bookkeeping was not written. Returns true
 * when the row was stored.
 */
export async function recordChatRelayRun(
  result: ChatRelayCleanupResult,
  options: { trigger: ChatRelayRunTrigger },
): Promise<boolean> {
  let held: ChatRelayHeld | null = null;
  try {
    held = await measureRelayHeld();
  } catch (error) {
    logger.warn({ err: error }, "Chat relay held-media measurement failed; recording the run without it");
  }
  try {
    await db.insert(chatRelayRunsTable).values({
      ranAt: new Date(result.ranAt),
      trigger: options.trigger,
      skipped: result.skipped,
      graceDays: result.policy.graceDays,
      expiryDays: result.policy.expiryDays,
      examined: result.examined,
      purged: result.purged,
      expired: result.expired,
      alreadyGone: result.alreadyGone,
      tombstonesPurged: result.tombstonesPurged,
      kept: result.kept,
      raced: result.raced,
      failed: result.failed,
      bytesReclaimed: result.bytesReclaimed,
      abortedError: result.abortedError,
      heldObjects: held?.objects ?? null,
      heldBytes: held?.bytes ?? null,
    });
  } catch (error) {
    logger.warn({ err: error }, "Chat relay run history could not be recorded; the purge itself is unaffected");
    return false;
  }
  try {
    await pruneChatRelayRuns();
  } catch (error) {
    logger.warn({ err: error }, "Chat relay run history could not be pruned; the next write retries");
  }
  return true;
}

/** Runs within the retention window (newest first) plus what the relay holds now. */
export async function readChatRelayHistory(): Promise<ChatRelayHistory> {
  const cutoff = new Date(Date.now() - CHAT_RELAY_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const [held, rows] = await Promise.all([
    measureRelayHeld(),
    db
      .select()
      .from(chatRelayRunsTable)
      .where(gte(chatRelayRunsTable.ranAt, cutoff))
      .orderBy(desc(chatRelayRunsTable.ranAt), desc(chatRelayRunsTable.id))
      .limit(CHAT_RELAY_HISTORY_MAX_RUNS),
  ]);
  return {
    windowDays: CHAT_RELAY_HISTORY_DAYS,
    maxRuns: CHAT_RELAY_HISTORY_MAX_RUNS,
    generatedAt: new Date().toISOString(),
    held,
    runs: rows.map((row) => ({
      id: row.id,
      ranAt: row.ranAt.toISOString(),
      trigger: row.trigger === "manual" ? "manual" : "scheduled",
      skipped:
        row.skipped === "disabled" || row.skipped === "min_build_not_met" ? row.skipped : null,
      graceDays: row.graceDays,
      expiryDays: row.expiryDays,
      examined: row.examined,
      purged: row.purged,
      expired: row.expired,
      alreadyGone: row.alreadyGone,
      tombstonesPurged: row.tombstonesPurged,
      kept: row.kept,
      raced: row.raced,
      failed: row.failed,
      bytesReclaimed: row.bytesReclaimed,
      abortedError: row.abortedError,
      heldObjects: row.heldObjects,
      heldBytes: row.heldBytes,
    })),
  };
}
