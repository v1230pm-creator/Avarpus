/**
 * Chat receipt retention.
 *
 * `chat_message_receipts` gains one row per recipient per message — explicit
 * delivered/stored acks plus the read-implies-delivered backfill — and nothing
 * ever removes one. Left alone the table outgrows the messages it describes
 * and slows the delta-sync receipts stream and the sender-side delivery
 * summary, both of which read it by message id.
 *
 * Only two things still need a receipt once it is old:
 *  - the relay purge (`chatRelayCleanup.ts`) counts `stored` receipts to
 *    decide when the server copy of a media message may go, and
 *  - the sender's ticks, which have a legacy fallback (recipient app synced
 *    after send) and a read marker that both survive without receipts.
 *
 * So a receipt is dropped only when BOTH hold:
 *  1. Its message's relay lifecycle is settled — there never was a relay copy
 *     (`object_path IS NULL`) or the copy is already `purged`/`expired`. A
 *     receipt on an `available` copy is never touched, which also keeps every
 *     receipt on pinned evidence under an open abuse report (its state stays
 *     `available` while pinned). States only ever move away from `available`,
 *     so a settled row cannot become relevant to the purge again.
 *  2. The message is a delete-for-everyone tombstone (no reader is shown its
 *     ticks any more), or the receipt itself is older than the retention
 *     window. The receipt's own `updated_at` is used rather than the message's
 *     age: it is never earlier than the message, and it protects a receipt the
 *     read backfill wrote late on an old message until the sender's devices
 *     have had the window to sync it.
 *
 * After pruning, `deliveryForMessages` in routes/chat.ts reports the affected
 * messages with `source: "legacy"` (delivered from the synced-app signal, read
 * from the read marker) and the sync feed simply stops serving the rows.
 * Devices keep whatever they already merged; nothing is re-sent.
 *
 * Deletes run in bounded batches with a per-run cap, oldest receipts first,
 * on the DB clock. Every batch is a single statement whose eligibility check
 * and delete see the same committed snapshot, so a purge transaction that is
 * still holding a message `FOR UPDATE` with its copy `available` is simply
 * skipped this run.
 */

import { sql } from "drizzle-orm";
import { db, appSettingsTable, CHAT_RECEIPT_PRUNE_LAST_RUN_KEY } from "@workspace/db";
import { logger } from "./logger";

/**
 * Days a receipt stays after it was last written, once its message's relay
 * lifecycle is settled. Long enough for any sender device that syncs at least
 * quarterly to have merged the receipt into its local store.
 */
export const CHAT_RECEIPT_RETENTION_DAYS = 90;
export const CHAT_RECEIPT_RETENTION_DAYS_MIN = 1;
export const CHAT_RECEIPT_RETENTION_DAYS_MAX = 3650;

export const CHAT_RECEIPT_PRUNE_BATCH_SIZE = 1_000;
/** Upper bound on rows deleted per run so one run never monopolises the DB. */
export const CHAT_RECEIPT_PRUNE_MAX_ROWS_PER_RUN = 50_000;

export type ChatReceiptPruneResult = {
  ranAt: string;
  retentionDays: number;
  /** Receipts removed because their message is a delete-for-everyone tombstone. */
  tombstoned: number;
  /** Receipts removed because they aged past the retention window. */
  aged: number;
  deleted: number;
  batches: number;
  /** True when the run stopped at the per-run cap; more eligible rows may remain. */
  capped: boolean;
};

export type PruneChatReceiptsOptions = {
  retentionDays?: number;
  maxRows?: number;
  batchSize?: number;
  /** Restrict the prune to these rooms (targeted runs and tests). */
  roomIds?: string[];
};

function boundedRetentionDays(value: number | undefined): number {
  if (value === undefined) return CHAT_RECEIPT_RETENTION_DAYS;
  if (
    !Number.isInteger(value) ||
    value < CHAT_RECEIPT_RETENTION_DAYS_MIN ||
    value > CHAT_RECEIPT_RETENTION_DAYS_MAX
  ) {
    throw new Error(
      `retentionDays must be a whole number between ${CHAT_RECEIPT_RETENTION_DAYS_MIN} and ${CHAT_RECEIPT_RETENTION_DAYS_MAX}`,
    );
  }
  return value;
}

type DeletedRow = { tombstoned: boolean };

/**
 * Delete one batch of eligible receipts, oldest first. Returns one row per
 * deleted receipt with the reason it qualified, so the run can report how
 * much was tombstone cleanup versus plain ageing.
 */
async function deleteBatch(
  retentionDays: number,
  limit: number,
  roomIds: string[] | null,
): Promise<DeletedRow[]> {
  const retention = `${retentionDays} days`;
  const roomScope = roomIds
    ? sql`AND rc.room_id IN (${sql.join(roomIds.map((id) => sql`${id}::uuid`), sql`, `)})`
    : sql``;
  const result = await db.execute(sql`
    WITH eligible AS (
      SELECT rc.id, (m.deleted_at IS NOT NULL) AS tombstoned
      FROM chat_message_receipts rc
      JOIN chat_messages m ON m.id = rc.message_id
      WHERE (m.object_path IS NULL OR m.media_state <> 'available')
        AND (m.deleted_at IS NOT NULL OR rc.updated_at <= now() - ${retention}::interval)
        ${roomScope}
      ORDER BY rc.updated_at ASC, rc.id ASC
      LIMIT ${limit}
    ),
    removed AS (
      DELETE FROM chat_message_receipts rc
      USING eligible
      WHERE rc.id = eligible.id
      RETURNING eligible.tombstoned
    )
    SELECT tombstoned FROM removed
  `);
  return result.rows as DeletedRow[];
}

async function writeLastRun(result: ChatReceiptPruneResult): Promise<void> {
  const value = JSON.stringify(result);
  await db
    .insert(appSettingsTable)
    .values({ key: CHAT_RECEIPT_PRUNE_LAST_RUN_KEY, value, updatedBy: null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updatedBy: null, updatedAt: new Date() },
    });
}

/**
 * Remove receipts that nothing reads any more (see the module comment for the
 * exact rule). Safe to run at any time and alongside the relay purge: it only
 * touches receipts whose message can no longer be purged from receipts.
 */
export async function pruneChatMessageReceipts(
  options: PruneChatReceiptsOptions = {},
): Promise<ChatReceiptPruneResult> {
  const retentionDays = boundedRetentionDays(options.retentionDays);
  const maxRows = options.maxRows ?? CHAT_RECEIPT_PRUNE_MAX_ROWS_PER_RUN;
  const batchSize = options.batchSize ?? CHAT_RECEIPT_PRUNE_BATCH_SIZE;
  const roomIds = options.roomIds ?? null;
  const result: ChatReceiptPruneResult = {
    ranAt: new Date().toISOString(),
    retentionDays,
    tombstoned: 0,
    aged: 0,
    deleted: 0,
    batches: 0,
    capped: false,
  };

  while (result.deleted < maxRows) {
    const limit = Math.min(batchSize, maxRows - result.deleted);
    const removed = await deleteBatch(retentionDays, limit, roomIds);
    if (removed.length === 0) break;
    result.batches += 1;
    for (const row of removed) {
      if (row.tombstoned) result.tombstoned += 1;
      else result.aged += 1;
    }
    result.deleted += removed.length;
    if (removed.length < limit) break;
  }
  if (result.deleted >= maxRows) result.capped = true;

  logger.info(
    {
      retentionDays,
      deleted: result.deleted,
      tombstoned: result.tombstoned,
      aged: result.aged,
      batches: result.batches,
      capped: result.capped,
    },
    "Chat receipt prune completed",
  );
  // Room-scoped runs (tests, ad-hoc) do not overwrite the whole-table record.
  if (!roomIds) await writeLastRun(result);
  return result;
}
