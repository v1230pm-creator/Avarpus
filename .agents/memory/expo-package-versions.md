---
name: Expo package version pinning
description: pnpm add installs SDK-incompatible majors for expo-* packages; always use npx expo install
---
- Installing expo modules with plain `pnpm add` grabs the latest major (e.g. expo-camera 57.x on SDK 54), which crashes at runtime with errors like `createPermissionHook is not a function` while typecheck still passes.
**Why:** happened twice (expo-network, expo-camera) via subagents; the crash only shows in the running bundle, not tsc.
**How to apply:** add expo-* / react-native-* deps with `npx expo install <pkg>` from artifacts/mobile, and after any subagent installs a mobile package, check the expo start log's "packages should be updated" warning and run `npx expo install` for the flagged ones.
