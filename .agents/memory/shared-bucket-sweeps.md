---
name: Shared bucket vs per-environment databases
description: Ownership rule for any code that deletes from object storage; why final profile photos are exempt from sweeps and what may still delete them.
---
Rule: all environments share ONE object-storage bucket but each has its OWN database, so "my database has no reference to this object" never proves an object is garbage. Anything that deletes from the bucket must (1) pass the storage-sweep policy gate (production deployment or explicit opt-in) and (2) delete only objects this database provably created (its own upload registry rows, or an object created earlier in the same request). Final profile photos are never sweep candidates anywhere; only the request that replaces/removes a photo, or account deletion, may delete one — and even those are gated because rows have been copied between environments with identical UUIDs.

**Why:** production profile photos vanished ~48h after upload because the development workspace's boot-time abandoned-upload sweep judged them unreferenced against the development database. Bucket has no versioning: the objects were unrecoverable.

**How to apply:** new cleanup jobs and any "delete old object" branch in a route go through the gate and an ownership proof, with a test that the disabled policy touches nothing. Never treat profile photos as media (no retention, no relay purge, no grace reclaim). When a photo "disappears" in production, list the bucket prefix and compare with production rows before blaming clients or caching.
