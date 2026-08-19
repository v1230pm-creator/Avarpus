---
name: Background APK downloads
description: Durable rules for APK downloads that must survive Android app process removal.
---

APK downloads that must continue after the app is backgrounded or removed from Recents use Android DownloadManager. JavaScript resumable downloads are only a compatibility fallback where the native module is unavailable.

**Why:** React Native/Expo JavaScript execution is suspended or destroyed with the app process, so a JS download cannot provide app-close continuity. Native enqueue must durably register and deduplicate the release before returning, while UI polling, cancellation, and verification need stale-operation guards.

**How to apply:** Restore from native durable state, not AsyncStorage alone; fail closed unless exact size and SHA-256 both verify before installation. Android Force Stop can still halt work and cannot be bypassed.