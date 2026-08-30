---
name: Trusted-device recovery
description: Security invariants for Android trusted-device auto-login and reinstall recovery.
---

Treat Android's app-scoped identifier only as a best-effort identifier, never as a hardware-backed secret. Persist only its hash; web and Expo Go must fall back to OTP.

**Why:** Reinstall recovery is intentionally convenient but spoofable. Raw identifiers, sliding deadlines, ambiguous account matches, and process-local throttles would turn it into a durable authentication weakness.

**How to apply:** OTP-created current-install sessions remain active until explicit logout/session revocation. Keep reinstall recovery capped at a fixed 24 hours from OTP and recovered sessions bounded by that same deadline. Rotate immutable trust generations, revoke the generation with any explicit session revocation, store durable privacy-hashed rate limits, and require exactly one active account match.

Serialize enrollment and recovery with a global advisory lock keyed by the Android-ID hash. Within that boundary, lock in this order: per-user rotation (when needed), sorted generation locks, trust rows, then sessions.

**Why:** User-scoped locks do not prevent a second account from concurrently enrolling the same identifier, and mixed session/trust lock order can deadlock recovery against logout.

**How to apply:** Any new trust mutation or session-management path must follow the same global hash and generation lock order, recheck eligibility while locked, and include concurrency coverage.