---
name: Immutable profile photos
description: Security rule for finalizing user-uploaded profile images before they become visible.
---

Never attach or serve a profile image directly from a key that still has a valid presigned upload URL. Validate the complete uploaded bytes, then write those exact verified bytes to a fresh server-controlled final key and attach only that final path.

**Why:** Validating a mutable staging object is vulnerable to a time-of-check/time-of-use overwrite: the signed URL can replace the bytes after validation but before its expiry.

**How to apply:** Keep signed uploads in staging. Enforce size, MIME, and file-signature checks on the full payload, finalize to an unsigned random key, delete staging, and only serve final paths currently attached to active users.