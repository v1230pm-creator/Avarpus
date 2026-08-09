---
name: Android APK builds
description: How the VMC Android APK gets built (expo.dev GitHub builds) and the pitfalls hit
---

Replit cannot build Android APKs (Expo Launch is iOS-only). Working path: push repo to user's private GitHub (`v1230pm-creator/vmc-electronic-bms`, branch `vmc-electronic-bms`) and build on expo.dev via "Build from GitHub" (project `vmcelectronicerp`, team `vmcelectronics-team`, base directory `artifacts/mobile`, profile `production`).

Fixes that were required (all live in `artifacts/mobile/eas.json` + root package.json):
- **Why:** EAS defaults broke each stage in turn.
- pnpm pinned (lockfile v9 was "ignored as incompatible" by EAS's old pnpm → looked absent).
- Node pinned (old default Node lacked `toReversed`, Metro config crashed).
- `android.image: "latest"` (default image had Java 11; AGP needs 17).
- `extra.eas.projectId` + `owner` required in app.json for GitHub builds.
- `EXPO_PUBLIC_DOMAIN` is baked in via eas.json env → must point at the production replit.app domain.

Release-build-only bug: RN `KeyboardAvoidingView behavior="height"` on Android conflicts with the active keyboard-controller native module (fine in Expo Go, keyboard instantly dismisses in the APK). Use `behavior="padding"` everywhere.

**How to apply:** for a new app version, just bump and push the branch, then user re-runs Build from GitHub. Signing keystore was generated locally (alias `vmcupload`, file handed to user via attached_assets) — user holds it + password; losing it breaks app updates.
