---
name: Chat provisioning recovery
description: Constraint for safely recovering an interrupted direct-room provisioning attempt.
---

Direct-chat recovery uses a durable reservation key mapped to an app-owned,
deterministic Matrix room alias, plus a short local lease and a fresh
attempt/fence ID for each worker claim. A retry resolves the alias before
creating; an expired lease is safe to take over because Matrix aliases converge
all workers on the same remote room.

**Why:** The local peer-pair uniqueness constraint prevents duplicate database
rooms, but it cannot cancel a prior Matrix `createRoom` call. The durable alias
turns an ambiguous timeout or process crash into a provider-side lookup, and
the attempt fence prevents an older worker from finalizing over its successor.

**How to apply:** Never remove a reservation after Matrix room creation may
have started. On recovery, resolve the exact alias, idempotently repair the two
virtual members, verify their membership, then atomically finalize only when
the stored attempt fence still matches. The Application Service registration
must reserve the matching room-alias namespace.