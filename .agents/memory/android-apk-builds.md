---
name: Android APK builds
description: How the VMC Android APK gets built (expo.dev GitHub builds) and the pitfalls hit
---

Replit cannot build Android APKs (Expo Launch is iOS-only). Avarpus builds from the private GitHub repo `v1230pm-creator/Avarpus-`, branch `avarpus`, on EAS project `avarpus` under `avarpus-team`; base directory is `artifacts/mobile`, profile `production`.

Fixes that were required (all live in `artifacts/mobile/eas.json` + root package.json):
- **Why:** EAS defaults broke each stage in turn.
- pnpm pinned (lockfile v9 was "ignored as incompatible" by EAS's old pnpm → looked absent).
- Node pinned (old default Node lacked `toReversed`, Metro config crashed).
- `android.image: "latest"` (default image had Java 11; AGP needs 17).
- `extra.eas.projectId` + `owner` required in app.json for GitHub builds.
- `EXPO_PUBLIC_DOMAIN` is baked in via eas.json env → must point at the production replit.app domain.
- Native drawable assets under `assets/android/` must be tracked. Scope native-output ignores as `/android/`, not `android/`, or Git silently omits the drawable and EAS prebuild fails with ENOENT.

Release-build-only bug: RN `KeyboardAvoidingView` on Android conflicts with the active keyboard-controller native module (fine in Expo Go, keyboard instantly dismisses in the APK). Don't use RN KAV at all on form screens — use `KeyboardAwareScrollViewCompat` (keyboard-controller's aware scroll view; plain ScrollView on web). Two more release-only dismissal causes: Android subview clipping detaches the focused TextInput on keyboard-open layout shift (compat now forces `removeClippedSubviews={false}`), and `justifyContent:'center'` on the scroll contentContainerStyle causes jump/blur — center via an inner flexGrow View instead.

**How to apply:** bump the app version, sync the exact source to `Avarpus-/avarpus`, and trigger EAS from the resulting commit SHA. Verify EAS reports that SHA and inspect the finished APK bundle before sharing it. Signing identity must remain stable across updates.
