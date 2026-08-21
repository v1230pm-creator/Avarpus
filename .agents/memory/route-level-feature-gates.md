---
name: Route-level feature gates
description: Guard sensitive mobile routes independently of bottom-tab visibility.
---

For routes that surface payment-derived data or are excluded from the dealer portal, put a feature/role guard in the route layout before rendering child screens. Do not rely on hiding the tab trigger or entry buttons.

**Why:** Expo routes can still be reached by deep link or programmatic navigation after their tab is hidden. A screen-level data hook may fetch before a late visual redirect is rendered.

**How to apply:** Use the shared route guard in the nested layout for the route family, require the relevant `canAccess` feature, and explicitly exclude portal roles where required. Cover the actual layout wiring in regression tests, not only the guard component in isolation.