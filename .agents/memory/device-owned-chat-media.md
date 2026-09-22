---
name: Device-owned chat media
description: Architectural rules for chat attachments living in app-private storage with the server as a temporary relay.
---

**Rule:** The device copy is the only source a bubble, quote thumbnail or preview may render from in device-owned mode; the relay is streamed only when there is no device store at all (web) or for an explicit user action (save/share/open). Anything auto-fetched must go through the download manager so the user's per-kind/network rules apply.

**Why:** A relay fetch hidden inside a thumbnail or preview silently bypasses "Wi-Fi only / on tap" and, once the server purges media, would show broken images instead of the explicit "no longer available" placeholder.

**How to apply:**
- Own attachments count as download candidates too: history sent before originals were kept, from another device, or cleared by the user must be recoverable from the relay while it is `available`. Index them as `sent` and never `stored`-ack them.
- Rows with no `mediaState`/`objectPath` (older history) are treated as relay-available; only `purged`/`expired`/deleted block the relay.
- Verify by byte size only (server has no hash) and index strictly after the temp → final rename.
- "Clear media" for a room must cancel that room's queued/in-flight downloads and leave a per-room watermark, or auto policy refills the room the moment the index rows vanish. The watermark is the newest message time, not the device clock.
- An index row is a claim about the disk, not the disk: verify it (size check) when a bubble renders and in a throttled sweep after syncs, drop rows found missing, and report `lost` only for received + stored-acked copies while the relay still has the bytes. A cleared room and an integrity loss look different on purpose: cleared = plain download placeholder; lost = "Save again from server". Never verify `out-*` rows and never call putMedia inside another store transaction (it owns its own).
- Node's built-in `node:sqlite` (DatabaseSync) behind the store's SqlDatabase shape lets Jest run the real SQLite SQL (json_extract predicates, migrations) that the memory store only mirrors; keep the memory mirror and the SQL in lockstep and test both.
- Jest: the manager's tests need real timers (idle/settle are macrotasks); RNTL `waitFor`/`renderHook` suites keep the global fake timers and wrap store mutations in `act`.
