---
name: Expo package version pinning
description: pnpm add installs SDK-incompatible majors for expo-* packages; always use npx expo install
---
- Installing expo modules with plain `pnpm add` grabs the latest major (e.g. expo-camera 57.x on SDK 54), which crashes at runtime with errors like `createPermissionHook is not a function` while typecheck still passes.
**Why:** happened twice (expo-network, expo-camera) via subagents; the crash only shows in the running bundle, not tsc.
**How to apply:** add expo-* / react-native-* deps with `npx expo install <pkg>` from artifacts/mobile, and after any subagent installs a mobile package, check the expo start log's "packages should be updated" warning and run `npx expo install` for the flagged ones.

- React Native's class-style components (Image, LinearGradient, QRCode wrappers) stop being valid JSX under `@types/react` 19.2.x: every usage reports "JSX element class does not support attributes because it does not have a 'props' property". Keep mobile on the 19.1.x react types.
**Why:** RN declares those components as `Constructor<HostInstance> & typeof SomeComponent`, and 19.2's JSX.ElementClass rejects the intersection's first construct signature. `npx expo install --check` reports "dependencies are up to date" and does not catch it.
**How to apply:** the breakage only appears after a real `pnpm install` refreshes node_modules, so a stale tree can hide it — run the full workspace typecheck after any install, not just the mobile filter.

- `npx expo install <pkg>` can fail with a pnpm `minimumReleaseAge` / firewall refusal when the SDK-matching patch was published under 24h ago; pin the previous patch of the same minor by hand (e.g. `~57.0.19` when 57.0.20 is blocked) and run `pnpm install --prefer-offline`.
**Why:** the workspace's pnpm blocks very fresh releases; the error is about release age, not SDK compatibility, and the earlier patch of the same minor is SDK-correct.
**How to apply:** after the pin, confirm the running Expo bundle shows no "packages should be updated" warning for it.
