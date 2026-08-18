---
name: In-app notifications
description: Server-side notification rows + polling mobile inbox; recipient rules and jsonb pitfalls.
---
In-app notification system (no push — needs an EAS build): `notifications` table (shop_id, user_id, type, title, body, data jsonb, read_at), `notifyShop()` helper, GET /notifications (own latest 50 + unreadCount) and POST /notifications/read (ids optional → all). Mobile polls (More badge 60s, inbox screen 30s); taps navigate via `data.repairId` / `data.approvalId`.

**Recipient rule:** active shop owners (dealer/super_admin) minus the actor, plus targeted extras (assigned technician, approval requester). Keeps spam low — don't broadcast to all staff.

**Why fire-and-forget:** `void notifyShop(...)` — a notification failure must never fail the business mutation.

**Pitfalls:**
- Do NOT `JSON.stringify` the `data` object before insert — Drizzle serializes jsonb itself; stringifying double-encodes and breaks tap navigation. (Arrays at the top level are the only case needing stringify per node-postgres quirk.)
- The read endpoint normalizes legacy string `data` defensively.
- Hook types in use: repair_created, repair_status, repair_assigned, payment_recorded, approval_requested, approval_decided. New hooks should follow the same recipient rule.
