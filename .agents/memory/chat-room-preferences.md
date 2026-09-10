---
name: Chat room preferences
description: Durable semantics for per-user chat management actions in shared rooms.
---

Pin, mute, archive, and delete are per-user room preferences, not shared room mutations. Delete means hiding the caller’s inbox copy; it must not remove Matrix state, local messages, membership, or another member’s history. Mute must suppress notifications for that user while preserving message delivery and inbox synchronization.

**Why:** Customer and direct chats use shared Matrix rooms. Treating inbox management as room-global state would let one participant unexpectedly change or destroy another participant’s experience and history.

**How to apply:** Authorize every preference mutation through explicit room membership and shop scope. Project caller-specific state on every room response, filter/order only that caller’s list, and exclude muted recipients when creating chat notifications.