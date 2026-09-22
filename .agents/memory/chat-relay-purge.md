---
name: Chat media relay purge
description: Durable rules for the server-side chat media relay purge (temporary relay, not an archive) and its rollout guard.
---

# Chat media relay purge

**Rule:** the server relay copy of chat media is disposable; the message row (text + metadata + media state) is permanent. Purge decisions come from server-recorded `stored` receipts, pin flags and the hard cap only — never from time alone before the cap, and never from client-supplied claims.

**Why:** devices are the system of record for media bytes (local-first chat). Guessing from time alone strands a recipient who has not collected yet; trusting the client lets someone delete evidence under an open abuse report.

**How to apply:**
- Pinned (open abuse report) media is exempt from every purge rule, including delete-for-everyone; the pin is released only on terminal report state, and that release must immediately retry the purge of any message that was deleted while pinned.
- Delete-for-everyone cleanup is independent of the lifecycle master switch: the immediate delete, the post-report retry, and the daily tombstone sweep all run with the switch off. Reviewers reject a design where an off switch can retain deleted content forever.
- Storage errors other than "object not found" leave the row untouched and abort the run (same fail-closed rule as the other sweeps). "Not found" counts as already gone and still flips the state.
- Rollout guard (known gap): the guard uses the highest build ever published as critical, recorded monotonically at publish time and capped by the live build on rollback. This is a *release-history* signal, not proof of adoption — the update flow is manual and nothing blocks an old client at the API. Do not describe it as "every device reached that build". Until a server-enforced minimum build (reject/upgrade-gate clients below it, and keep the critical release visible past later optional releases) exists, operators must confirm old builds are gone (session/device build telemetry) before enabling the purge.
- A device `stored` receipt is a claim, not proof: the phone must keep verifying it (byte-size check on render + throttled sweep after syncs) and send a `lost` ack when the copy is gone, which clears that recipient's stored_at while the relay copy is still `available` so the purge waits again. Reviewers will ask for this whenever a new "device holds it" signal feeds a purge decision. Verify by exact size only; never trust a cached "intact" result across a re-download (re-read the index row before dropping it).
- The lost path must never touch settled rows: once purged/expired the ack is ignored (reason relay_gone), the phone drops nothing it cannot refetch and offers no action — the stale index row is the only record of what the phone once held (drives the "only on this phone" count).
- Forwarding a message whose relay copy is gone is a fresh upload from the forwarding device, verified like a first-hand attachment; without one the server refuses with an explicit expired code and the client must not retry.

## Run history
- Only whole-relay runs (scheduled timer, operator Run now) are recorded in the bounded run history; room-scoped purges (room clear) and no-op runs that never start (switch off, build guard) are not, so the trend measures the relay lifecycle rather than user actions. Same scoping rule as the receipt prune.
- Recording is fail-safe by contract: a history insert, held-measurement or prune failure is logged and the run result is still returned and still written to the last-run key. Reviewers will reject a history write that can throw out of the purge, and the e2e asserts the last-run key is restored exactly, so keep that key independent of the history table.
- Held figures are a live count of `available` relay rows; legacy rows without a stored size are counted as objects but excluded from bytes and reported separately, so never present held bytes as exact.

## Pitfall
- Drizzle raw `sql` binds a JS array as scalar text (`= ANY(${ids}::uuid[])` → "malformed array literal"); expand lists with `sql.join` of individually bound values.
