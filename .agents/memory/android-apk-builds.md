---
name: Android APK builds
description: How the VMC Android APK gets built (expo.dev GitHub builds) and the pitfalls hit
---

Replit cannot build Android APKs (Expo Launch is iOS-only). Avarpus builds from the private GitHub repo `v1230pm-creator/Avarpus`, branch `main`, on EAS project `avarpus` under the **`julian647`** Expo account (projectId `ebcf3946-…`) — the operator confirmed this on 2026-09-21 after briefly configuring credentials on the other project. A second project `@avarpus-team/avarpus` (`61ec52bc-…`) also exists and is NOT the build target; credentials (keystore, FCM V1 key) and the `GOOGLE_SERVICES_JSON` file variable must exist on the julian647 project/account, since account-level EAS variables do not cross accounts. `owner` + `extra.eas.projectId` in app.json must name the account that holds the credentials, or EAS refuses the build / signs with the wrong key. Tip: an anonymous POST to `https://api.expo.dev/graphql` with `app.byFullName` leaks each project's ID in its UNAUTHORIZED error message — use it to confirm which account owns which ID without asking for screenshots; base directory is `artifacts/mobile`, profile `production`. (An older dashed repo/branch name no longer resolves — confirm the repo via the GitHub connector before syncing.)

Task environments generally have **no shell Git credentials** (no SSH key, HTTPS unauthenticated), so `git push` fails with `Permission denied (publickey)` while the GitHub connector still works. Sync via the Git Data API instead: read file bytes with `node:fs` *inside* the `"use impure"` function (avoids the CodeExecution byte budget and shellExec base64 truncation), POST each blob, then chunk `POST /git/trees` with `base_tree` and `sha:null` entries for deletions, create the commit, and PATCH the ref. Verify by comparing the remote recursive tree's blob SHAs against local `git ls-tree -r HEAD`.

Only real build inputs need syncing; heavy unrelated binaries (screenshots, site export archives) can be excluded, which also avoids the connector WAF limits. The resulting remote tree then intentionally differs from local `HEAD^{tree}`, so verify per-path SHAs rather than the root tree SHA.

A finished APK can be verified in the workspace without any Expo credentials: `aapt2` and `apksigner` exist in the Nix store (find them under `/nix/store/*/bin/`). `aapt2 dump badging` gives versionName/versionCode/label; `apksigner verify --print-certs` confirms the release keystore identity. Release builds shrink resource names, so launcher and bundled logo images land at opaque paths like `res/qs.webp` — map them with `aapt2 dump resources` (`mipmap/ic_launcher*`, `drawable/assets_images_*`) and extract those, then look at them. Bundled image bytes are re-encoded by AAPT, so CRC/SHA comparison against the source PNGs fails even when the art is correct; compare visually instead. `aapt2 dump resources` on a large APK is slow — always run it under `timeout` and grep.

Local APK copies live in `artifacts/mobile/releases/` and are gitignored (they exceed GitHub's file-size limit anyway).

Triggering the cloud build is **user-side**: no Expo/EAS token exists in the environment and the EAS CLI is off-limits, so the user runs the build from expo.dev after the commit is on `main`.

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

## Confirmed release check

**Rule:** An APK release is not accepted from EAS metadata alone; verify its packaged bundle/native classes, then require a real Android install check for the changed UI and keyboard-sensitive flows.

**Why:** A successful cloud build can still omit locally ignored assets or native module sources. After correcting source sync and ignore scoping, the user confirmed the resulting APK showed the current Settings/Profile features and correct keyboard behavior on a real phone.

**How to apply:** compare the EAS commit SHA, inspect the APK contents for expected UI/native symbols, and keep the release task open until the user confirms the installed APK on-device.
