---
name: Lock-state mutation safety
description: Safety rules for enabling or disabling biometric/device-credential app lock.
---

Enabling or disabling app lock must be confirmed through the operating system's authentication prompt. Canceling the OS prompt leaves the preference unchanged.

**Why:** The setting changes local access control. A stale UI assumption after a failed storage write can claim protection is on when it is not, or claim it is off while the next launch still locks.

**How to apply:**
- Disable repeated toggle actions while authentication or storage writes are in flight.
- Persist only after OS authentication succeeds.
- On failure, re-read storage and show the actual state rather than an optimistic state.
- Disabling app lock must leave the current authenticated session unlocked.
