---
name: App lock enforcement
description: Durable routing and recovery rules for the biometric/device-credential app lock.
---

Rule: app lock is an explicit Settings opt-in and uses only the operating system's biometric/device credential prompt. Guard it at the tabs layout so deep links cannot bypass it. A successful OTP unlocks the current in-memory session before routing directly to tabs; later startup/background/inactivity relocks use device authentication.

**Why:** OTP is the sole primary account sign-in and should not immediately trigger a second prompt. The app must not own or retain an MPIN, while users who enable local protection still need an unbypassable lock.

**How to apply:** Keep the tabs-level guard and sign-out recovery on the lock screen. Always allow OS device-credential fallback; never reintroduce an app-owned PIN/password or route OTP success through the lock screen.
