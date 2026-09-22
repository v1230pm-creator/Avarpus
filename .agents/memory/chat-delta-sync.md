---
name: Chat delta sync & receipts
description: Non-obvious design rules behind the chat sync feed and delivery receipts; read before adding chat mutations a device must learn about.
---

# Chat delta sync and delivery receipts

**Rule 1 — every sync watermark is a database clock.** Write change times with
`now()` in SQL, never an app-side Date. The settle boundary is computed in SQL, so
an app-clock timestamp can land on the wrong side of it and be skipped forever.

**Rule 2 — cursors carry exact microseconds and compare in SQL.** Never round-trip a
cursor position through a JS Date (millisecond precision splits a row from itself).

**Rule 3 — settle lag instead of row locks.** `now()` is transaction *start* time, so
a row can commit with a change time already behind another reader's cursor. Rows
younger than the lag are still returned but the cursor parks at the boundary, so
they are re-served until they settle. Clients must upsert by id. Backdated test
fixtures must sit inside the membership window (`joined_at`) or the
read-implies-delivered backfill ignores them by design.

**Rule 4 — personal actions never bump the shared message row.** Bumping a message's
watermark on hide-for-me would re-deliver it to the peer; caller-specific changes
travel in their own streams.

**Rule 5 — every stream applies the room authorisation rule**, including the
caller-keyed ones (hides, receipts, preferences). Membership rows outlive workspace
changes; only current-shop scoping stops an ex-member from receiving activity for
old-shop rooms.

**Rule 6 — receipts are first-seen-only.** Delivered never changes, stored is set at
most once, and the receipt watermark moves only when stored is first set. Own
messages and stored-acks on text are *ignored*, not rejected; one foreign id fails
the whole batch with 404 and writes nothing.
The one sanctioned reversal is the `lost` ack: it clears a recipient's stored_at only
while the message's media is still `available` (bumps the receipt watermark so the
sender's view resyncs) and a later `stored` sets it afresh. Within one batch,
`delivered` never overrides a `stored`/`lost` listed alongside and the later of
`stored`/`lost` wins (entries are chronological). Devices send lost reports in their
own request *before* stored acks so a copy found missing and refetched in the same
pass ends `stored`. Never add a second reversal path.

**Rule 7 — schema changes ship as hand-written idempotent SQL in
`lib/db/migrations`** in addition to the dev push. Adding a watermark column with
`DEFAULT now()` directly makes every historical row look freshly changed; add it
nullable, backfill from `created_at`, then set the default and NOT NULL.

**Why:** the sync feed replaces full-page polling; a lost row is a permanently
missing message on the device store and a spurious bump leaks private actions.

**How to apply:** a new chat mutation a device must learn about needs a DB-clock
watermark on an existing stream or a new stream plus cursor slot, and a probe in
the chat-sync integration script (including the workspace-revocation case).
