---
name: Privileged session inactivity
description: Why only super_admin sessions expire on inactivity, how the cutoff is enforced, and the traps around last_seen_at.
---

Shop accounts (dealer/staff/customer) keep persist-until-revoked sessions; only the platform-admin
role (`super_admin`) has a 30-day inactivity cutoff, enforced at read time (session lookup and the
device list), not by a cron. Idle privileged sessions are deleted when encountered.

**Why:** the admin console keeps its bearer token in browser localStorage, so a forgotten admin
login is a standing platform-wide credential. Shop users, by contrast, expect WhatsApp-style
"stay signed in" behaviour and were explicitly designed that way (see OTP-only account access).

**How to apply:**
- `last_seen_at` is stamped at most every few minutes, fire-and-forget; a failed touch must never
  fail the request. Sessions created before the column existed default to now(), which is intended.
- Any delete driven by "this row looked idle" must re-check the cutoff in SQL, otherwise a request
  that just refreshed the session gets revoked (read-then-delete race).
- The admin console must revoke a token it was issued for a non-admin account rather than just
  showing "access denied" — otherwise a live orphan session is left behind.
- Do not extend the cutoff to shop roles without a product decision; the mobile app relies on
  sessions surviving long offline periods.
