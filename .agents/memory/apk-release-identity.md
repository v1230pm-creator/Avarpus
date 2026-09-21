---
name: APK release identity
description: Non-negotiable release rules that keep app-update metadata aligned with the Android binary users actually install
---

Every new Android release must use a freshly built APK from the latest GitHub branch. The release version and build number must match the APK's actual native `versionName` and `versionCode`; editing database labels or renaming an old file cannot add code or features.

**Why:** The same APK checksum was previously reused under several newer release labels. Users downloaded and installed that unchanged binary, so the app still behaved like the old version even though the update screen advertised a newer build.

**Package identity (September 2026):** the app was deliberately moved from `com.vmcelectronicerp.app` / scheme `vmcelectronicerp` to `com.avarpus.app` / scheme `avarpus`, with the user accepting that old installs do not upgrade in place (reinstall + OTP sign-in); reconfirmed 2026-09-21 after seeing the new APK install side-by-side with the old one. Never reintroduce the old identity "for compatibility"; the operator checklist for the first release under the new identity (Firebase app, new `GOOGLE_SERVICES_JSON`, keystore reassignment in EAS) lives in replit.md. The release-build guard only checks that a google-services.json exists, not that its `package_name` matches app.json — a stale file builds fine and push silently dies.

**How to apply:** Treat APK checksum as immutable release identity. Serialize checksum check-and-write operations, and serialize publish/unpublish transitions with fresh locked-row reads. Do not add a checksum uniqueness migration until legacy duplicate rows are safely remediated in every environment.