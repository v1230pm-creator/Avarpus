---
name: Expo simulator API routing
description: Keep the browser/Expo development simulator on the current Replit development API rather than a stale production deployment.
---

In development, inject the current Replit development domain as the mobile API origin. Keep the stable production origin limited to production/EAS builds.

**Why:** the browser-side Expo Android simulator once silently called an older deployed backend, so OTP requests exercised retired MSG91 code even though the workspace API had already moved to Hanu. Pointing development at the current dev domain restored Hanu delivery.

**How to apply:** when changing authentication or API behavior, confirm the request appears in the development API workflow logs. If it appears only in deployment logs, inspect the Expo development API-origin injection before debugging the provider.