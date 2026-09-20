---
name: Object entity path derivation
description: Why stored /objects/… paths must be built from the written key, never from the storage client's publicUrl(), and what breaks when a non-canonical path is persisted.
---
Rule: any code that writes an object and persists its location must store `/objects/uploads/<prefix>/<id>` built from the key it wrote. Never derive it from `File.publicUrl()` (or any URL that percent-encodes the object name).

**Why:** `publicUrl()` encodes `/` as `%2F`; the normaliser did not recognise the encoded pathname as living under the private dir and returned the raw bucket path. Production profile photos were stored as `/<bucket>/.private%2Fuploads%2F…`: clients could not load them, `/storage/objects` lookups 404'd, and the abandoned-upload sweep (which only matches canonical paths against `users.profile_photo` / `chat_messages.object_path`) would have deleted the real final objects as "unattached" after the 48h grace.

**How to apply:** new save/copy helpers return the canonical path directly; `normalizeObjectEntityPath` now decodes before the prefix check as a backstop. A boot-time data repair (`profilePhotoRepair.ts`) rewrites legacy rows and gates the destructive sweep — only a true `ObjectNotFoundError` may clear a reference; any other storage error must leave the row alone and skip that run's sweep. Dev and prod share one bucket, so objects can be inspected from the workspace even when prod SQL is read-only.

Client side: the shared mobile Avatar must degrade to initials for any unloadable/failed url (never a blank circle), read the token before requesting `/objects/` paths, and attach the bearer header only to our own storage route — device `content://`/`file://` contact photos and external URLs go through uncredentialed.
