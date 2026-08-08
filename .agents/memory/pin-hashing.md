---
name: PIN hashing
description: Security decision for how the app-lock PIN is stored/verified
---

The app-lock PIN is never stored or compared in plain form; the stored record is a salted memory-hard KDF hash (scrypt). Reviewers rejected a plain iterated-SHA256 approach: a 6-digit PIN space is tiny, so only a calibrated memory-hard KDF meaningfully resists offline cracking of an extracted keychain dump.

**Why:** the protection goal is "unreadable even if device storage is extracted"; fast hashes fail that goal for low-entropy PINs.

**How to apply:**
- Callers must use `hasStoredMpin()` / `verifyMpin(pin)` — never read or compare the stored value directly.
- Any cost parameters parsed from a stored record must be strictly upper-bounded, or a tampered record can hang the lock screen with unbounded work.
- Legacy formats (plaintext, older hash versions) still verify and are upgraded to the current format only on a successful verification.
