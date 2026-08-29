---
name: Local Expo native modules
description: How this managed Expo app ships custom Android native capabilities safely.
---

For custom Android capabilities, use a local Expo module under
`artifacts/mobile/modules/` with `expo-module.config.json`, an Android Gradle
module, and a Kotlin `expo.modules.kotlin.modules.Module`. Expo autolinking
discovers these modules for custom builds; JavaScript should access them through
`requireOptionalNativeModule` and fail closed in Expo Go.

Third-party native packages that cannot load in Expo Go must also stay out of
module-scope imports. Check for `ExecutionEnvironment.StoreClient` first and
conditionally require the native component only in a custom build; render an
unsupported-runtime fallback everywhere else.

**Why:** A managed Expo project has no checked-in Android app directory. A
local Expo module is autolinked during the custom build without manual
`MainApplication` edits, while keeping unavailable native capabilities from
being simulated in JavaScript. Evaluating an unavailable native package while
Expo Router discovers routes can break the route manifest before the user opens
that feature.

**How to apply:** Run `expo-modules-autolinking search --platform android` to
confirm discovery before an Android build, and keep any private cryptographic
material entirely inside the Kotlin module. Apply the same fail-closed import
boundary to calling, cryptography, and any other feature backed by a native
package absent from Expo Go.