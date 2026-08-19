---
name: APK release identity
description: Non-negotiable release rules that keep app-update metadata aligned with the Android binary users actually install
---

Every new Android release must use a freshly built APK from the latest GitHub branch. The release version and build number must match the APK's actual native `versionName` and `versionCode`; editing database labels or renaming an old file cannot add code or features.

**Why:** The same APK checksum was previously reused under several newer release labels. Users downloaded and installed that unchanged binary, so the app still behaved like the old version even though the update screen advertised a newer build.

**How to apply:** Treat APK checksum as immutable release identity. Serialize checksum check-and-write operations, and serialize publish/unpublish transitions with fresh locked-row reads. Do not add a checksum uniqueness migration until legacy duplicate rows are safely remediated in every environment.