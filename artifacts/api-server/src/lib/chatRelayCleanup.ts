/**
 * Daily chat media relay purge.
 *
 * Applies the rules in `chatRelayPolicy.ts` to real rows: enumerates media
 * messages in bounded batches, deletes the relay object for every message the
 * rules say is done, and records the new relay state on the row so devices
 * learn about it through delta sync.
 *
 * Safety rules (same discipline as the pending-upload sweep):
 *  - Fail-closed: any storage error other than "object not found" leaves the
 *    row untouched and ends the run. "Not found" means the bytes are already
 *    gone, so the row is moved to its terminal state with 0 bytes reclaimed.
 *  - Every purge re-reads its row FOR UPDATE and re-applies the rule inside
 *    the transaction that deletes the object, so a pin (report) or a state
 *    change that landed since the batch was enumerated wins.
 *  - The object path advisory lock shared with the pending-upload code is
 *    taken too, so the sweep never races an attach or forward that is still
 *    holding a lease on the same path.
 *  - The master switch AND the minimum-build guard gate the *lifecycle*
 *    rules (all-stored + grace, hard cap). Delete-for-everyone tombstones are
 *    swept on every run regardless: their content is already gone for every
 *    reader, so a pinned-then-released or transiently failed delete must never
 *    keep relay bytes alive just because the switch is off.
 *  - Bookkeeping never fails a run: the last-run summary and the run history
 *    (`chatRelayHistory.ts`, whole-relay runs only) are written after the
 *    work is done, and the history writer swallows its own errors.
 */

import { inArray, sql } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  CHAT_RELAY_CLEANUP_ENABLED_KEY,
  CHAT_RELAY_EXPIRY_DAYS_KEY,
  CHAT_RELAY_GRACE_DAYS_KEY,
  CHAT_RELAY_LAST_RUN_KEY,
} from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";
import { readMinimumSupportedAppBuild } from "./appMinimumBuild";
import { logger } from "./logger";
import { recordChatRelayRun, type ChatRelayRunTrigger } from "./chatRelayHistory";
import {
  CHAT_RELAY_MIN_APP_BUILD,
  chatRelayEnableBlockedReason,
  decideRelayMedia,
  parseChatRelayPolicy,
  type ChatRelayPolicy,
  type RelayDecision,
  type RelayMediaCandidate,
} from "./chatRelayPolicy";
import { assertStorageSweepsEnabled, type StorageSweepPolicy } from "./storageSweeps";

export const CHAT_RELAY_BATCH_SIZE = 200;
/** Upper bound on rows examined per run so one run never monopolises the DB. */
export const CHAT_RELAY_MAX_ROWS_PER_RUN = 5_000;

export type ChatRelayCleanupResult = {
  ranAt: string;
  /** Why the run did nothing, when it did nothing. */
  skipped: "disabled" | "min_build_not_met" | null;
  skippedReason: string | null;
  policy: ChatRelayPolicy;
  examined: number;
  purged: number;
  expired: number;
  /** Rows whose object was already missing; state recorded, nothing reclaimed. */
  alreadyGone: number;
  /** Delete-for-everyone tombstones whose relay object was removed this run (switch-independent). */
  tombstonesPurged: number;
  kept: number;
  /** Rows that changed under us between enumeration and the locked re-check. */
  raced: number;
  failed: number;
  bytesReclaimed: number;
  /** Set when the run stopped early on a storage error (fail-closed). */
  abortedError: string | null;
};

type CandidateRow = {
  id: string;
  object_path: string | null;
  media_state: string;
  media_pinned: boolean;
  has_open_report: boolean;
  // Raw `db.execute` rows may carry timestamps as strings depending on the
  // pg type parser; normalise in `toCandidate`.
  deleted_at: Date | string | null;
  created_at: Date | string;
  size_bytes: number | null;
  recipient_count: string | number;
  stored_recipient_count: string | number;
};

/** Read the operator policy from `app_settings` (defaults when absent). */
export async function readChatRelayPolicy(): Promise<ChatRelayPolicy> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(
      inArray(appSettingsTable.key, [
        CHAT_RELAY_CLEANUP_ENABLED_KEY,
        CHAT_RELAY_GRACE_DAYS_KEY,
        CHAT_RELAY_EXPIRY_DAYS_KEY,
      ]),
    );
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return parseChatRelayPolicy({
    enabled: byKey.get(CHAT_RELAY_CLEANUP_ENABLED_KEY),
    graceDays: byKey.get(CHAT_RELAY_GRACE_DAYS_KEY),
    expiryDays: byKey.get(CHAT_RELAY_EXPIRY_DAYS_KEY),
  });
}

export { readMinimumSupportedAppBuild } from "./appMinimumBuild";

export async function readChatRelayLastRun(): Promise<ChatRelayCleanupResult | null> {
  const [row] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, [CHAT_RELAY_LAST_RUN_KEY]))
    .limit(1);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as ChatRelayCleanupResult;
  } catch {
    return null;
  }
}

async function writeLastRun(result: ChatRelayCleanupResult): Promise<void> {
  const value = JSON.stringify(result);
  await db
    .insert(appSettingsTable)
    .values({ key: CHAT_RELAY_LAST_RUN_KEY, value, updatedBy: null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updatedBy: null, updatedAt: new Date() },
    });
}

/**
 * Persist a finished run: the history row first (whole-relay runs only; the
 * writer is fail-safe and never throws), then the last-run summary. A
 * room-scoped run describes a slice of the relay, so it is kept out of the
 * trend but still refreshes the last-run summary as before.
 */
async function persistRun(
  result: ChatRelayCleanupResult,
  meta: { trigger: ChatRelayRunTrigger; roomIds: string[] | null },
): Promise<void> {
  if (!meta.roomIds) await recordChatRelayRun(result, { trigger: meta.trigger });
  await writeLastRun(result);
}

function toCandidate(row: CandidateRow): RelayMediaCandidate {
  return {
    objectPath: row.object_path,
    mediaState: row.media_state,
    mediaPinned: row.media_pinned,
    hasOpenReport: row.has_open_report,
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    createdAt: new Date(row.created_at),
    recipientCount: Number(row.recipient_count),
    storedRecipientCount: Number(row.stored_recipient_count),
  };
}

/**
 * Enumerate live (non-tombstoned) messages that MIGHT be eligible: relay copy
 * present, not pinned, older than the grace period. Keyset-paged on
 * (created_at, id) so a run walks history once without re-reading rows it
 * kept. The rule itself is applied in JS via `decideRelayMedia`.
 */
async function fetchCandidateBatch(
  policy: ChatRelayPolicy,
  after: { createdAt: Date; id: string } | null,
  limit: number,
  roomIds: string[] | null,
): Promise<CandidateRow[]> {
  const graceInterval = `${policy.graceDays} days`;
  const keyset = after
    ? sql`AND (m.created_at, m.id) > (${after.createdAt}, ${after.id}::uuid)`
    : sql``;
  const roomScope = roomIds
    ? sql`AND m.room_id IN (${sql.join(roomIds.map((id) => sql`${id}::uuid`), sql`, `)})`
    : sql``;
  const result = await db.execute(sql`
    SELECT m.id,
           m.object_path,
           m.media_state,
           m.media_pinned,
           m.deleted_at,
           m.created_at,
           m.size_bytes,
           EXISTS (
             SELECT 1 FROM chat_reports r
             WHERE r.message_id = m.id AND r.status NOT IN ('actioned', 'dismissed')
           ) AS has_open_report,
           (
             SELECT count(*) FROM chat_room_members mem
             WHERE mem.room_id = m.room_id AND mem.user_id <> m.sender_id
           ) AS recipient_count,
           (
             SELECT count(*) FROM chat_room_members mem
             JOIN chat_message_receipts rc
               ON rc.message_id = m.id AND rc.user_id = mem.user_id AND rc.stored_at IS NOT NULL
             WHERE mem.room_id = m.room_id AND mem.user_id <> m.sender_id
           ) AS stored_recipient_count
    FROM chat_messages m
    WHERE m.object_path IS NOT NULL
      AND m.media_state = 'available'
      AND m.media_pinned = false
      AND m.deleted_at IS NULL
      AND m.created_at <= now() - ${graceInterval}::interval
      ${roomScope}
      ${keyset}
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT ${limit}
  `);
  return result.rows as CandidateRow[];
}

/**
 * Delete-for-everyone tombstones still holding a relay object: pinned ones are
 * skipped here (evidence for an open report) and picked up once the pin is
 * released. Bounded, oldest first.
 */
async function fetchTombstoneBatch(limit: number, roomIds: string[] | null): Promise<string[]> {
  const roomScope = roomIds
    ? sql`AND m.room_id IN (${sql.join(roomIds.map((id) => sql`${id}::uuid`), sql`, `)})`
    : sql``;
  const result = await db.execute(sql`
    SELECT m.id
    FROM chat_messages m
    WHERE m.object_path IS NOT NULL
      AND m.media_state = 'available'
      AND m.media_pinned = false
      AND m.deleted_at IS NOT NULL
      ${roomScope}
    ORDER BY m.deleted_at ASC, m.id ASC
    LIMIT ${limit}
  `);
  return (result.rows as Array<{ id: string }>).map((row) => row.id);
}

const TOMBSTONE_POLICY: ChatRelayPolicy = { enabled: true, graceDays: 0, expiryDays: 0 };

class RelayStorageError extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
    this.name = "RelayStorageError";
  }
}

/**
 * Purge one message's relay object under lock. Returns the bytes reclaimed
 * (0 when the object was already gone), or null when the row no longer
 * qualified once re-read (raced). Throws RelayStorageError on any storage
 * failure other than not-found; the row is left untouched in that case.
 */
async function purgeOne(
  storage: ObjectStorageService,
  id: string,
  policy: ChatRelayPolicy,
  now: Date,
  requireTombstone = false,
): Promise<{ outcome: "purged" | "expired" | "raced"; bytes: number; alreadyGone: boolean }> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT m.id, m.object_path, m.media_state, m.media_pinned, m.deleted_at, m.created_at,
             m.size_bytes,
             EXISTS (
               SELECT 1 FROM chat_reports r
               WHERE r.message_id = m.id AND r.status NOT IN ('actioned', 'dismissed')
             ) AS has_open_report,
             (
               SELECT count(*) FROM chat_room_members mem
               WHERE mem.room_id = m.room_id AND mem.user_id <> m.sender_id
             ) AS recipient_count,
             (
               SELECT count(*) FROM chat_room_members mem
               JOIN chat_message_receipts rc
                 ON rc.message_id = m.id AND rc.user_id = mem.user_id AND rc.stored_at IS NOT NULL
               WHERE mem.room_id = m.room_id AND mem.user_id <> m.sender_id
             ) AS stored_recipient_count
      FROM chat_messages m
      WHERE m.id = ${id}::uuid
      FOR UPDATE OF m
    `);
    const row = (locked.rows as CandidateRow[])[0];
    if (!row || !row.object_path) return { outcome: "raced" as const, bytes: 0, alreadyGone: false };
    if (requireTombstone && !row.deleted_at) return { outcome: "raced" as const, bytes: 0, alreadyGone: false };
    const decision: RelayDecision = decideRelayMedia(toCandidate(row), policy, now);
    if (decision.action !== "purge") return { outcome: "raced" as const, bytes: 0, alreadyGone: false };

    // Same lock the attach/forward paths hold while they process this path.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.object_path}, 0))`);

    let bytes = 0;
    let alreadyGone = false;
    try {
      const file = await storage.getObjectEntityFile(row.object_path);
      const [metadata] = await file.getMetadata();
      const declared = Number(metadata.size ?? row.size_bytes ?? 0);
      bytes = Number.isFinite(declared) && declared > 0 ? Math.floor(declared) : (row.size_bytes ?? 0);
      await file.delete();
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        alreadyGone = true;
        bytes = 0;
      } else {
        throw new RelayStorageError(`relay object ${row.object_path} could not be deleted`, error);
      }
    }

    await tx.execute(sql`
      UPDATE chat_messages
      SET media_state = ${decision.state}, updated_at = now()
      WHERE id = ${id}::uuid AND media_state = 'available'
    `);
    return { outcome: decision.state, bytes, alreadyGone };
  });
}

export type RunChatRelayCleanupOptions = {
  now?: Date;
  storage?: ObjectStorageService;
  /** Override the operator policy (tests); the switch is still honoured. */
  policy?: ChatRelayPolicy;
  maxRows?: number;
  /** Restrict the sweep to these rooms (targeted runs and tests). */
  roomIds?: string[];
  /** What started the run; recorded in the run history. Defaults to the timer. */
  trigger?: ChatRelayRunTrigger;
  /**
   * Whether this process may delete from object storage. Defaults to the
   * environment policy; tests that purge their own fixtures pass an enabled
   * policy explicitly. A disabled policy throws before anything is touched.
   */
  storageSweeps?: StorageSweepPolicy;
};

export async function runChatRelayCleanup(
  options: RunChatRelayCleanupOptions = {},
): Promise<ChatRelayCleanupResult> {
  // Every environment shares one bucket; only the environment whose database
  // owns it may delete. Checked first so a manual trigger on a development or
  // not-yet-migrated host cannot purge (not even tombstones).
  assertStorageSweepsEnabled(options.storageSweeps);
  const now = options.now ?? new Date();
  const policy = options.policy ?? (await readChatRelayPolicy());
  const result: ChatRelayCleanupResult = {
    ranAt: now.toISOString(),
    skipped: null,
    skippedReason: null,
    policy,
    examined: 0,
    purged: 0,
    expired: 0,
    alreadyGone: 0,
    tombstonesPurged: 0,
    kept: 0,
    raced: 0,
    failed: 0,
    bytesReclaimed: 0,
    abortedError: null,
  };
  const storage = options.storage ?? new ObjectStorageService();
  const maxRows = options.maxRows ?? CHAT_RELAY_MAX_ROWS_PER_RUN;
  const roomIds = options.roomIds ?? null;
  const persistMeta = { trigger: options.trigger ?? "scheduled", roomIds };

  // Pass 1 — tombstones, independent of the switch and the build guard.
  const tombstoneOutcome = await sweepTombstones(storage, result, now, maxRows, roomIds);
  if (tombstoneOutcome === "aborted") {
    await persistRun(result, persistMeta);
    return result;
  }

  // Pass 2 — lifecycle rules, only when the operator has turned them on and
  // every installed app can render a purged message honestly.
  if (!policy.enabled) {
    result.skipped = "disabled";
    result.skippedReason = "Chat media relay purge is switched off.";
    // A switched-off run that found nothing is not worth a record; one that
    // still removed deleted-message files (or hit a failure) is.
    if (result.tombstonesPurged > 0 || result.failed > 0) await persistRun(result, persistMeta);
    return result;
  }
  const blocked = chatRelayEnableBlockedReason(
    await readMinimumSupportedAppBuild(),
    CHAT_RELAY_MIN_APP_BUILD,
  );
  if (blocked) {
    result.skipped = "min_build_not_met";
    result.skippedReason = blocked;
    logger.warn({ reason: blocked }, "Chat relay purge enabled but minimum app build not met; skipping run");
    await persistRun(result, persistMeta);
    return result;
  }

  let after: { createdAt: Date; id: string } | null = null;

  outer: while (result.examined < maxRows) {
    const limit = Math.min(CHAT_RELAY_BATCH_SIZE, maxRows - result.examined);
    const batch = await fetchCandidateBatch(policy, after, limit, roomIds);
    if (batch.length === 0) break;
    for (const row of batch) {
      result.examined += 1;
      after = { createdAt: new Date(row.created_at), id: row.id };
      const decision = decideRelayMedia(toCandidate(row), policy, now);
      if (decision.action !== "purge") {
        result.kept += 1;
        continue;
      }
      try {
        const done = await purgeOne(storage, row.id, policy, now);
        if (done.outcome === "raced") {
          result.raced += 1;
          continue;
        }
        if (done.outcome === "purged") result.purged += 1;
        else result.expired += 1;
        if (done.alreadyGone) result.alreadyGone += 1;
        result.bytesReclaimed += done.bytes;
      } catch (error) {
        result.failed += 1;
        if (error instanceof RelayStorageError) {
          result.abortedError = error.message;
          logger.error(
            { err: error.cause, messageId: row.id },
            "Chat relay purge hit a storage error; leaving the row and ending this run (fail-closed)",
          );
          break outer;
        }
        throw error;
      }
    }
    if (batch.length < limit) break;
  }

  logger.info(
    {
      examined: result.examined,
      purged: result.purged,
      expired: result.expired,
      alreadyGone: result.alreadyGone,
      tombstonesPurged: result.tombstonesPurged,
      kept: result.kept,
      raced: result.raced,
      failed: result.failed,
      bytesReclaimed: result.bytesReclaimed,
      aborted: result.abortedError !== null,
    },
    "Chat relay purge completed",
  );
  await persistRun(result, persistMeta);
  return result;
}

/**
 * Sweep delete-for-everyone tombstones (pass 1 of a run). Counts land in
 * `result`; returns "aborted" on a storage error so the caller ends the run
 * without touching the lifecycle rules (fail-closed).
 */
async function sweepTombstones(
  storage: ObjectStorageService,
  result: ChatRelayCleanupResult,
  now: Date,
  maxRows: number,
  roomIds: string[] | null,
): Promise<"done" | "aborted"> {
  let examined = 0;
  // Re-enumerating from the top is safe: every processed row leaves the
  // `available` state (or is skipped as raced/pinned and stays out of the
  // batch through the pinned filter). A row that keeps racing bounds the loop
  // through `maxRows`.
  const seen = new Set<string>();
  while (examined < maxRows) {
    const batch = (await fetchTombstoneBatch(Math.min(CHAT_RELAY_BATCH_SIZE, maxRows - examined), roomIds))
      .filter((id) => !seen.has(id));
    if (batch.length === 0) break;
    for (const id of batch) {
      seen.add(id);
      examined += 1;
      result.examined += 1;
      try {
        const done = await purgeOne(storage, id, TOMBSTONE_POLICY, now, true);
        if (done.outcome === "raced") {
          result.raced += 1;
          continue;
        }
        result.tombstonesPurged += 1;
        if (done.alreadyGone) result.alreadyGone += 1;
        result.bytesReclaimed += done.bytes;
      } catch (error) {
        result.failed += 1;
        if (error instanceof RelayStorageError) {
          result.abortedError = error.message;
          logger.error(
            { err: error.cause, messageId: id },
            "Chat relay tombstone sweep hit a storage error; leaving the row and ending this run (fail-closed)",
          );
          return "aborted";
        }
        throw error;
      }
    }
  }
  return "done";
}

/**
 * Delete-for-everyone: drop the relay copy of a tombstoned message right away.
 * Pinned media (open abuse report) is kept as evidence; the terminal report
 * decision calls this again, and the daily tombstone sweep is the backstop
 * for anything that failed in between. Storage failures are logged, never
 * raised — the tombstone already stands.
 */
export async function purgeRelayMediaForDeletedMessage(
  messageId: string,
  storage: ObjectStorageService = new ObjectStorageService(),
): Promise<void> {
  try {
    await purgeOne(storage, messageId, TOMBSTONE_POLICY, new Date(), true);
  } catch (error) {
    logger.warn(
      { err: error instanceof RelayStorageError ? error.cause : error, messageId },
      "Relay media for a deleted message could not be removed now; the daily tombstone sweep will retry",
    );
  }
}

/**
 * After a report reaches a terminal state and its pin is released: remove the
 * relay copy of any of these messages that was deleted-for-everyone while it
 * was pinned. Best-effort and sequential; the daily sweep is the backstop.
 */
export async function purgeRelayMediaForDeletedMessages(
  messageIds: string[],
  storage: ObjectStorageService = new ObjectStorageService(),
): Promise<void> {
  for (const id of new Set(messageIds.filter(Boolean))) {
    await purgeRelayMediaForDeletedMessage(id, storage);
  }
}
