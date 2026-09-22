/**
 * Chat delta sync and delivery receipts.
 *
 * The sync feed is a set of independent change streams (messages, hidden-for-me,
 * read states, receipts, preferences, memberships), each paged by a keyset on
 * (change time, id). The opaque cursor carries one position per stream.
 *
 * Two rules keep the feed loss-free:
 *
 *  1. Change times are DATABASE clocks and travel as integer microseconds.
 *     A JS Date keeps milliseconds only, so a cursor built from one would land
 *     on both sides of its own row; the cursor instead stores the exact
 *     microsecond epoch and SQL rebuilds the exact timestamptz to compare.
 *  2. Rows younger than CHAT_SYNC_SETTLE_LAG_MS are "fresh": `now()` is a
 *     transaction's START time, so a row can become visible with a change
 *     time that is already behind another reader's cursor. Fresh rows are
 *     returned, but the cursor never advances past the settle boundary until
 *     they age out, so a late-committing row is still picked up. Clients
 *     therefore upsert by id — a fresh row may legitimately arrive twice.
 *
 * Cursors and receipts key on Avarpus ids only, never Matrix ids.
 */

import { sql, type SQL } from "drizzle-orm";
import { db, chatMessageReceiptsTable, chatRoomsTable } from "@workspace/db";

export const CHAT_SYNC_DEFAULT_LIMIT = 100;
export const CHAT_SYNC_MAX_LIMIT = 200;
/** Initial window returned when a device syncs without a cursor. */
export const CHAT_SYNC_INITIAL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** How long a row must be old before the cursor may advance past it. */
export const CHAT_SYNC_SETTLE_LAG_MS = 5_000;

export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MICROS_RE = /^\d{1,19}$/;

export const SYNC_STREAMS = ["m", "h", "r", "c", "p", "b"] as const;
export type SyncStream = (typeof SYNC_STREAMS)[number];

/** Keyset position: exact microsecond epoch (decimal string) + tie-break id. */
export type SyncPosition = { t: string; id: string };

export type SyncCursor = {
  v: 1;
  room: string | null;
  s: Record<SyncStream, SyncPosition>;
};

export function encodeCursor(cursor: SyncCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Strict decode; returns null for anything that is not a cursor we issued. */
export function decodeCursor(raw: string): SyncCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const c = parsed as Record<string, unknown>;
  if (c.v !== 1) return null;
  if (c.room !== null && (typeof c.room !== "string" || !UUID_RE.test(c.room))) return null;
  if (!c.s || typeof c.s !== "object") return null;
  const streams = c.s as Record<string, unknown>;
  const s = {} as Record<SyncStream, SyncPosition>;
  for (const key of SYNC_STREAMS) {
    const pos = streams[key] as Record<string, unknown> | undefined;
    if (
      !pos
      || typeof pos !== "object"
      || typeof pos.t !== "string"
      || !MICROS_RE.test(pos.t)
      || typeof pos.id !== "string"
      || !UUID_RE.test(pos.id)
    ) {
      return null;
    }
    s[key] = { t: pos.t, id: pos.id.toLowerCase() };
  }
  return { v: 1, room: (c.room as string | null)?.toLowerCase() ?? null, s };
}

export function comparePositions(a: SyncPosition, b: SyncPosition): number {
  const ta = BigInt(a.t);
  const tb = BigInt(b.t);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function maxPosition(a: SyncPosition, b: SyncPosition): SyncPosition {
  return comparePositions(a, b) >= 0 ? a : b;
}

/** SQL: exact timestamptz for a microsecond-epoch string. */
export function microsToTimestamp(micros: string): SQL {
  return sql`('epoch'::timestamptz + (${micros}::bigint) * interval '1 microsecond')`;
}

/** SQL: exact microsecond epoch (as text, so node-postgres never rounds it). */
export function timestampToMicros(column: SQL | { getSQL(): SQL }): SQL<string> {
  return sql<string>`((extract(epoch from ${column}) * 1000000)::bigint)::text`;
}

/** SQL: keyset predicate `(ts, id) > (position)` for a stream. */
export function afterPosition(
  tsColumn: SQL | { getSQL(): SQL },
  idColumn: SQL | { getSQL(): SQL },
  position: SyncPosition,
): SQL {
  return sql`(${tsColumn}, ${idColumn}) > (${microsToTimestamp(position.t)}, ${position.id}::uuid)`;
}

export function microsToDate(micros: string): Date {
  return new Date(Number(BigInt(micros) / 1000n));
}

export type SyncClock = {
  /** Server `now()` as microseconds. */
  nowMicros: string;
  /** Rows at or before this are settled; the cursor may advance past them. */
  settledMicros: string;
  /** Start of the initial window (no-cursor call). */
  initialMicros: string;
};

export async function readSyncClock(): Promise<SyncClock> {
  const lag = `${CHAT_SYNC_SETTLE_LAG_MS} milliseconds`;
  const window = `${CHAT_SYNC_INITIAL_WINDOW_MS} milliseconds`;
  const result = await db.execute<{ now_micros: string; settled_micros: string; initial_micros: string }>(sql`
    SELECT
      ${timestampToMicros(sql`now()`)} AS now_micros,
      ${timestampToMicros(sql`now() - ${lag}::interval`)} AS settled_micros,
      ${timestampToMicros(sql`now() - ${window}::interval`)} AS initial_micros
  `);
  const row = result.rows[0]!;
  return {
    nowMicros: String(row.now_micros),
    settledMicros: String(row.settled_micros),
    initialMicros: String(row.initial_micros),
  };
}

export function initialCursor(clock: SyncClock, room: string | null): SyncCursor {
  const start: SyncPosition = { t: clock.initialMicros, id: NIL_UUID };
  return {
    v: 1,
    room,
    s: { m: start, h: start, r: start, c: start, p: start, b: start },
  };
}

export type StreamRow<T> = { item: T; micros: string; id: string };

export type StreamPage<T> = { items: T[]; next: SyncPosition; hasMore: boolean };

/**
 * Page one stream from `position`. `fetch` must return rows ordered by
 * (micros, id) ascending, at most `limit + 1` of them, all strictly after
 * `position`. Settled rows advance the cursor row by row; once the settled
 * region is exhausted the remaining fresh rows are returned too, but the
 * cursor parks at the settle boundary so a late commit is not skipped.
 */
export async function pageStream<T>(
  position: SyncPosition,
  clock: SyncClock,
  limit: number,
  fetch: (position: SyncPosition, fetchLimit: number) => Promise<StreamRow<T>[]>,
): Promise<StreamPage<T>> {
  const rows = await fetch(position, limit + 1);
  const boundary = BigInt(clock.settledMicros);
  let settledCount = 0;
  while (settledCount < rows.length && BigInt(rows[settledCount]!.micros) <= boundary) {
    settledCount++;
  }
  if (settledCount > limit) {
    const items = rows.slice(0, limit);
    const last = items[items.length - 1]!;
    return { items: items.map((r) => r.item), next: { t: last.micros, id: last.id }, hasMore: true };
  }
  const items = rows.slice(0, limit);
  const parked: SyncPosition = { t: clock.settledMicros, id: NIL_UUID };
  return {
    items: items.map((r) => r.item),
    next: maxPosition(position, parked),
    hasMore: rows.length > limit,
  };
}

/**
 * Room visibility, identical to the per-room authorisation used everywhere
 * else in chat: global direct rooms are membership-only; shop rooms also need
 * the caller's active shop. Membership itself is joined by the caller.
 */
export function roomScopeCondition(shopId: string | null): SQL {
  return shopId
    ? sql`(${chatRoomsTable.scope} = 'global_direct' OR (${chatRoomsTable.scope} = 'shop' AND ${chatRoomsTable.shopId} = ${shopId}))`
    : sql`${chatRoomsTable.scope} = 'global_direct'`;
}

// ── Receipts ─────────────────────────────────────────────────────────────────

export type ReceiptEntry = { messageId: string; roomId: string; stored: boolean };

/**
 * Record first-seen delivered/stored timestamps for `userId`. Idempotent:
 * deliveredAt is never touched once written, storedAt is set at most once, and
 * updatedAt moves only when storedAt is first set. Callers must already have
 * verified membership and excluded the sender's own messages.
 */
export async function recordReceipts(userId: string, entries: ReceiptEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db
    .insert(chatMessageReceiptsTable)
    .values(
      entries.map((entry) => ({
        messageId: entry.messageId,
        roomId: entry.roomId,
        userId,
        storedAt: entry.stored ? sql`now()` : null,
      })),
    )
    .onConflictDoUpdate({
      target: [chatMessageReceiptsTable.messageId, chatMessageReceiptsTable.userId],
      set: {
        storedAt: sql`COALESCE(${chatMessageReceiptsTable.storedAt}, excluded.stored_at)`,
        updatedAt: sql`CASE
          WHEN ${chatMessageReceiptsTable.storedAt} IS NULL AND excluded.stored_at IS NOT NULL THEN now()
          ELSE ${chatMessageReceiptsTable.updatedAt}
        END`,
      },
    });
}

/**
 * The one sanctioned reversal of a `stored` receipt: the recipient's device
 * found its saved copy missing or damaged. Clears `userId`'s storedAt on the
 * given messages so the relay purge waits for a fresh `stored` (or the hard
 * cap) instead of trusting a copy that no longer exists. Applies only while
 * the relay object is still `available` — once purged/expired there is
 * nothing left to protect and the receipt is left alone (the retention job
 * owns settled receipts). A row that was never stored is untouched; a
 * delivered receipt is recorded when none exists yet. Returns the ids whose
 * stored mark was actually cleared.
 */
export async function revokeStoredReceipts(userId: string, entries: ReceiptEntry[]): Promise<string[]> {
  if (entries.length === 0) return [];
  await recordReceipts(
    userId,
    entries.map((entry) => ({ ...entry, stored: false })),
  );
  const ids = entries.map((entry) => entry.messageId);
  const result = await db.execute(sql`
    UPDATE chat_message_receipts rc
    SET stored_at = NULL, updated_at = now()
    FROM chat_messages m
    WHERE m.id = rc.message_id
      AND rc.user_id = ${userId}::uuid
      AND rc.message_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      AND rc.stored_at IS NOT NULL
      AND m.object_path IS NOT NULL
      AND m.media_state = 'available'
    RETURNING rc.message_id
  `);
  return (result.rows as Array<{ message_id: string }>).map((row) => row.message_id);
}

/**
 * Read implies delivered: when `userId` moves their read marker in `roomId`,
 * every message another member sent since the previous marker (or since the
 * caller joined) gets a delivered receipt. Bounded to the newly-read span, with
 * a settle-lag overlap so a message that committed late is not left out.
 * Must run BEFORE the read-state upsert that moves the marker.
 */
export async function recordReadDeliveries(userId: string, roomId: string): Promise<void> {
  const lag = `${CHAT_SYNC_SETTLE_LAG_MS} milliseconds`;
  await db.execute(sql`
    INSERT INTO chat_message_receipts (message_id, room_id, user_id)
    SELECT m.id, m.room_id, ${userId}::uuid
    FROM chat_messages m
    WHERE m.room_id = ${roomId}::uuid
      AND m.sender_id <> ${userId}::uuid
      AND m.created_at <= now()
      AND m.created_at >= COALESCE(
        (SELECT rs.last_read_at FROM chat_read_state rs
          WHERE rs.room_id = ${roomId}::uuid AND rs.user_id = ${userId}::uuid),
        (SELECT mem.joined_at FROM chat_room_members mem
          WHERE mem.room_id = ${roomId}::uuid AND mem.user_id = ${userId}::uuid),
        m.created_at
      ) - ${lag}::interval
    ON CONFLICT (message_id, user_id) DO NOTHING
  `);
}
