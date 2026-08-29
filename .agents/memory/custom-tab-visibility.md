---
name: Custom tab visibility
description: How role-restricted routes must be filtered in a custom Expo Router tab bar.
---

When an Expo Router app renders a fully custom tab bar, derive its visible tab list from the same role and feature-access state used by route guards. Do not rely only on each descriptor's `href` value to hide restricted routes.

**Why:** A restricted route configured with `href: null` can still appear in custom descriptor-driven navigation. Tapping it looks broken because the route guard immediately redirects back to the allowed screen.

**How to apply:** Whenever tab availability or role rules change, update the route configuration, route guard, and custom bar's access-state filter together. Test both a restricted account and a fully privileged account.