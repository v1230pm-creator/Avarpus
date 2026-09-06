---
name: Expo SDK 57 migration
description: Compatibility constraints discovered while moving the mobile app from Expo SDK 54 to SDK 57.
---

The mobile project targets Expo SDK 57. Keep Expo-managed package versions aligned through `expo install`, and keep the dev server login step non-blocking so Android works even if Expo authentication is unavailable.

**Why:** SDK 57 changes the default Media Library asset API, requires React Native 0.86/TypeScript 6 compatibility, and its Reanimated Jest mock may initialize native Worklets in a non-native test process.

**How to apply:** Use the explicit legacy Media Library entry point for URI/filename-based asset flows until intentionally migrating them. In Jest, mock Reanimated/Worklets, Safe Area, and imported Expo native modules at their boundaries. Stock Expo Go still cannot validate custom LiveKit/WebRTC behavior.