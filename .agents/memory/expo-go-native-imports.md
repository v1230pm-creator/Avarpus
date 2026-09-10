---
name: Expo Go native imports
description: How to keep the mobile app launchable in Expo Go while retaining custom native behavior in signed builds.
---

Never statically import a native module that is absent from Expo Go in startup or route modules. Select a React Native fallback when the execution environment is StoreClient, and only require the native implementation for custom development or signed builds.

**Why:** Metro can bundle successfully while Expo Go cancels immediately during JavaScript module evaluation, before a React error boundary or useful device log appears.

**How to apply:** Treat root providers and Expo Router route imports as startup-sensitive. Preserve fail-closed behavior for features that genuinely require the custom APK, while allowing ordinary Expo Go screens to load with safe built-in fallbacks.