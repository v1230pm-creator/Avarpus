---
name: APK release identity
description: Non-negotiable release rules that keep app-update metadata aligned with the Android binary users actually install
---

Every new Android release must use a freshly built APK from the latest GitHub branch. The release version and build number must match the APK's actual native `versionName` and `versionCode`; editing database labels or renaming an old file cannot add code or features.

**Why:** The same APK checksum was previously reused under several newer release labels. Users downloaded and installed that unchanged binary, so the app still behaved like the old version even though the update screen advertised a newer build.

**Package identity (September 2026):** the app was deliberately moved from `com.vmcelectronicerp.app` / scheme `vmcelectronicerp` to `com.avarpus.app` / scheme `avarpus`, with the user accepting that old installs do not upgrade in place (reinstall + OTP sign-in); reconfirmed 2026-09-21 after seeing the new APK install side-by-side with the old one. Never reintroduce the old identity "for compatibility"; the operator checklist for the first release under the new identity (Firebase app, new `GOOGLE_SERVICES_JSON`, keystore reassignment in EAS) lives in replit.md. The release-build guard only checks that a google-services.json exists, not that its `package_name` matches app.json — a stale file builds fine and push silently dies.

**Build numbers come from EAS, not app.json (Sep 25 2026):** `eas.json` uses `appVersionSource: "remote"` + `autoIncrement`, so the APK's `versionCode` is EAS's remote counter and `app.json`'s `android.versionCode` is ignored and drifts (app.json said 26 while every installed 1.0.8 phone reported build 27). The real installed builds are visible read-only in the production `push_tokens.app_version` column (`"1.0.8 (27)"` format). Any server threshold keyed on a build number (e.g. `CHAT_RELAY_MIN_APP_BUILD`) must be derived from installed builds and re-confirmed against the finished APK (`aapt2 dump badging`), never from app.json; the `version` label is still taken from app.json.

**How to apply:** Treat APK checksum as immutable release identity. Serialize checksum check-and-write operations, and serialize publish/unpublish transitions with fresh locked-row reads. Do not add a checksum uniqueness migration until legacy duplicate rows are safely remediated in every environment.