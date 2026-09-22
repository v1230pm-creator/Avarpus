/**
 * Media pins for abuse reports.
 *
 * A message with a non-terminal abuse report keeps its relay media copy so an
 * operator can still judge it. `chat_messages.media_pinned` is a derived flag:
 * true exactly while some report on the message is still open or under
 * review. It is recomputed inside the same transaction as every report state
 * change (create, decide, batch decide, withdraw) so the flag and the report
 * table never disagree at commit time.
 *
 * The UPDATE takes ordinary row locks on the message rows, which is what
 * serialises it against the relay purge job: that job re-reads each row
 * FOR UPDATE before deleting its object, so whichever side commits first
 * decides — a pin that lands first keeps the object, a purge that lands first
 * leaves a report whose media is honestly reported as no longer available.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Report statuses after which media no longer needs to be held. */
export const TERMINAL_REPORT_STATUSES = ["actioned", "dismissed"] as const;

/**
 * Recompute `media_pinned` for the given messages. Only rows with a live relay
 * copy can become pinned (pinning a purged row would misreport its state);
 * any row may be unpinned. Bumps `updated_at` only when the flag changes so
 * delta sync re-serves exactly the rows whose relay state moved.
 */
// node-postgres binds a JS array as a scalar text literal in raw SQL, so
// expand the list into individual bound uuids instead of `= ANY($1)`.
function uuidList(ids: string[]) {
  return sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
}

/**
 * Returns the ids of messages whose pin was just released so the caller can,
 * after commit, remove the relay copy of any that were deleted-for-everyone
 * while pinned (`purgeRelayMediaForDeletedMessages`).
 */
export async function syncChatMediaPins(tx: Tx, messageIds: string[]): Promise<string[]> {
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const updated = await tx.execute(sql`
    UPDATE chat_messages AS m
    SET media_pinned = wanted.pinned,
        updated_at = now()
    FROM (
      SELECT c.id,
             EXISTS (
               SELECT 1 FROM chat_reports r
               WHERE r.message_id = c.id
                 AND r.status NOT IN ('actioned', 'dismissed')
             ) AS pinned
      FROM chat_messages c
      WHERE c.id IN (${uuidList(ids)})
    ) AS wanted
    WHERE m.id = wanted.id
      AND m.object_path IS NOT NULL
      AND m.media_pinned IS DISTINCT FROM wanted.pinned
      AND (wanted.pinned = false OR m.media_state = 'available')
    RETURNING m.id, m.media_pinned
  `);
  return (updated.rows as Array<{ id: string; media_pinned: boolean }>)
    .filter((row) => row.media_pinned === false)
    .map((row) => row.id);
}

/** Recompute pins for every message referenced by the given reports. */
export async function syncChatMediaPinsForReports(tx: Tx, reportIds: string[]): Promise<string[]> {
  const ids = [...new Set(reportIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const rows = await tx.execute(sql`
    SELECT DISTINCT message_id FROM chat_reports
    WHERE id IN (${uuidList(ids)}) AND message_id IS NOT NULL
  `);
  const messageIds = (rows.rows as Array<{ message_id: string }>).map((row) => row.message_id);
  return syncChatMediaPins(tx, messageIds);
}
