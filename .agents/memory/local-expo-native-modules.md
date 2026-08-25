---
name: Local Expo native modules
description: How this managed Expo app ships custom Android native capabilities safely.
---

For custom Android capabilities, use a local Expo module under
`artifacts/mobile/modules/` with `expo-module.config.json`, an Android Gradle
module, and a Kotlin `expo.modules.kotlin.modules.Module`. Expo autolinking
discovers these modules for custom builds; JavaScript should access them through
`requireOptionalNativeModule` and fail closed in Expo Go.

**Why:** A managed Expo project has no checked-in Android app directory. A
local Expo module is autolinked during the custom build without manual
`MainApplication` edits, while keeping unavailable native capabilities from
being simulated in JavaScript.

**How to apply:** Run `expo-modules-autolinking search --platform android` to
confirm discovery before an Android build, and keep any private cryptographic
material entirely inside the Kotlin module.