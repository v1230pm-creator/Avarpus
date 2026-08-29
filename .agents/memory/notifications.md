---
name: In-app notifications
description: Server-side notification rows + polling mobile inbox; recipient rules and jsonb pitfalls.
---
In-app notification system (no push — needs an EAS build): notification rows support both shop-scoped and global-recipient events. Mobile polls the More badge and inbox; tap payloads can route to repairs, approvals, or an exact chat room.

**Recipient rule:** active shop owners (dealer/super_admin) minus the actor, plus targeted extras (assigned technician, approval requester). Keeps spam low — don't broadcast to all staff.

**Global direct-chat rule:** message alerts go only to the other room member, allow a null shop scope, and use a stable dedupe identity tied to the stored message. Never use shop-owner fan-out for these rooms.

**Why:** direct-room membership can cross shops or include standalone customer accounts, while client retries must not create duplicate alerts.

**How to apply:** create the alert only after the Matrix send and local message insert both succeed; do nothing on failed delivery or an idempotent replay.

**Access rule:** every role eligible for global direct chat must be allowed through both mobile tab guards and server portal allowlists for notification list/read and membership-scoped chat routes.

**Why fire-and-forget:** `void notifyShop(...)` — a notification failure must never fail the business mutation.

**Pitfalls:**
- Do NOT `JSON.stringify` the `data` object before insert — Drizzle serializes jsonb itself; stringifying double-encodes and breaks tap navigation. (Arrays at the top level are the only case needing stringify per node-postgres quirk.)
- The read endpoint normalizes legacy string `data` defensively.
- Shop-scoped hooks follow the owner/extra-recipient rule above; membership-scoped hooks must target their exact recipient instead.
