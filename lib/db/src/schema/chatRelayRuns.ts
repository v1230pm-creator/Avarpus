import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ── Chat media relay purge history ───────────────────────────────────────────
// One row per whole-relay purge run (the daily timer and the operator's "Run
// now"), so the console can show a trend — bytes reclaimed per day, how much
// removed media had been collected by every recipient versus expired
// uncollected, and how much the relay still held right after each run —
// instead of only the most recent summary kept in `app_settings`.
//
// Bookkeeping only: nothing reads this table to make a purge decision. The
// writer is fail-safe (a failed insert is logged, never raised) and bounded
// (rows past the retention window or the row cap are pruned on every write).
// Room-scoped runs (tests, ad-hoc) are not recorded: their counts describe a
// slice of the relay, not the relay.
export const chatRelayRunsTable = pgTable(
  "chat_relay_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull(),
    // scheduled | manual
    trigger: text("trigger").notNull().default("scheduled"),
    // disabled | min_build_not_met | null (the lifecycle pass ran)
    skipped: text("skipped"),
    // Policy in force for the run, so a change in the day values explains a
    // change in the trend.
    graceDays: integer("grace_days").notNull(),
    expiryDays: integer("expiry_days").notNull(),
    examined: integer("examined").notNull().default(0),
    purged: integer("purged").notNull().default(0),
    expired: integer("expired").notNull().default(0),
    alreadyGone: integer("already_gone").notNull().default(0),
    tombstonesPurged: integer("tombstones_purged").notNull().default(0),
    kept: integer("kept").notNull().default(0),
    raced: integer("raced").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    bytesReclaimed: bigint("bytes_reclaimed", { mode: "number" }).notNull().default(0),
    abortedError: text("aborted_error"),
    // Relay objects still `available` (and their known bytes) measured right
    // after the run; null when the measurement itself failed.
    heldObjects: integer("held_objects"),
    heldBytes: bigint("held_bytes", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_relay_runs_ran_at_idx").on(t.ranAt, t.id)],
);
