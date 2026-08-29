---
name: Android 12 splash handoff
description: How to avoid a full-screen splash asset being shrunk into Android 12's centered system icon.
---

Do not place Avarpus's portrait/full-screen splash artwork in Android 12's `windowSplashScreenAnimatedIcon` slot. Use an invisible native drawable over the same solid navy used by the status/navigation bars, keep the native splash held, and hide it only after the in-app full-screen splash assets are loaded.

**Why:** Android 12 enforces a centered system-splash icon and shrinks portrait artwork into a small rectangle, producing a duplicate startup flash before the React splash.

**How to apply:** Preserve the branded star-wave screen as the in-app startup experience. Any native splash config change must be checked with a clean Android prebuild and then confirmed by cold-launching a fresh native APK; Expo Go cannot validate the installed app's system splash.