---
name: Drive backup privacy
description: Security and consent rules for per-user Google Drive chat backups.
---

Cloud chat backup must be opt-in: new users start with automatic backup, cellular use, and video inclusion disabled. Keep every Google authorization and backup isolated to the authenticated user's own account and chat memberships.

End-to-end encrypted backup must remain visibly Off until archive contents are protected by a user-held recovery password or key and a working recovery path exists. Server-side credential encryption alone does not qualify.

**Why:** Backup silently copies sensitive conversations and media to another provider, while an inaccurate encryption label would create a false security promise.

**How to apply:** Preserve privacy-safe defaults, least-privilege Google scopes, authenticated-user derivation, and honest encryption status in every backup UI, API, worker, and restore change.

Direct-to-provider encrypted uploads require durable cross-request fencing, not only an API lock.

**Why:** A stale device can otherwise overwrite a committed archive after validation, leaving metadata and ciphertext tied to different secrets.

**How to apply:** Fence prepare-to-complete as one logical operation and ensure stale writers cannot mutate the committed provider object.

Encrypted backups are manual-only unless a future design securely stores a device-bound key with explicit user consent.

**Why:** A recovery password held only in screen state cannot power scheduled work after restart, and silently retaining a schedule creates a false backup promise.

**How to apply:** Force encrypted scheduling to Never, explain the manual-only behavior in UI, and never silently persist the recovery password.