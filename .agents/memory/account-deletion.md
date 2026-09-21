---
name: Permanent account deletion
description: Rules and known limits of Settings → Delete Account (chat / business / both layers), including the in-session OTP status-code trap.
---

# Permanent account deletion

- Two independent layers on one `users` row: **chat** (Matrix identity, memberships, authored messages, statuses, blocks, chat notifications, Drive chat backup) and **business** (Shops the account is `dealerId` of — deleted whole even with co-owners; memberships elsewhere; dealer-portal link). `both` deletes the users row; the same mobile later becomes a brand-new account.
- Re-auth code is bound server-side to `<userId>:<scope>:<channel>`; a code for one scope never deletes another. Tests seed `otp_codes` directly, never real SMS.
- **Wrong re-auth code must return 400 (`OTP_INVALID`), never 401.** Any authenticated 401 fires the mobile global unauthorized handler and signs the person out mid-flow (observed on Expo web). Same trap applies to every future in-session OTP check.
- After execute succeeds every session is already dead; the mobile screen calls `holdSessionUntilLogout()` from AuthContext so background 401s do not unmount the "Account Deleted" screen before the explicit `logout()`. Release the hold on any failure.
- Transport errors and gateway statuses (408/502/503/504) after execute are *ambiguous* (commit may have happened); the UI must not claim "nothing was deleted" for them.
- Deep links to the screen need the route in the personal-route list of `tabRouteAccess` and the inactive-portal exemption list, or the tabs guard redirects home.

**Known limitations (accepted, not bugs to rediscover):** object-storage and Matrix leave cleanup are post-commit best-effort (rows are the source of truth; deleted prefixes are unreachable). Concurrent chat writes racing the deletion transaction: message insert is fenced (room `FOR SHARE` + membership recheck); room provisioning, status creation and post-commit notification fan-out are not fenced by a deletion epoch. Revisit with a per-user chat generation counter if this ever matters.
