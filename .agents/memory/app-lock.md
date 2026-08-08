---
name: App lock enforcement
description: Rules the completion reviewer enforces for the mobile PIN/biometric lock.
---
Rule: the PIN/biometric lock must be unbypassable — guard at the tabs layout (covers deep links), not just the root index redirect; every login success path (password, OTP) must route through the lock screen; Skip may render only after storage reads confirm no lock is configured; storage read errors fail closed to PIN entry; biometric unlock offered only with explicit opt-in flag and disableDeviceFallback.
**Why:** Task completion reviews rejected the work four times for each of these bypasses (async choose-mode Skip, OTP direct route, unguarded tabs deep links, biometric offered without opt-in).
**How to apply:** Any change touching auth routing or the lock screen must preserve all of these paths; also use expo `expo install` for native deps (plain pnpm add picked an Expo-incompatible expo-secure-store version).

**Recovery paths:** reviewers reject lock-screen recovery ("Forgot PIN?" / sign-out & reset) if it's only reachable from PIN entry — the biometric-only unlock mode must expose it too, since it must work even when biometric hardware/enrollment is unavailable.
