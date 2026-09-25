---
name: In-flow custom tab bar
description: The mobile app's custom bottom tab bar is laid out below the screen, not over it; how floating controls must be offset.
---

**Rule:** `PremiumTabBar` (Expo Router `Tabs` with a custom `tabBar` prop, no `position: 'absolute'`) is a column sibling of the screen. A screen's container therefore already ends at the bar's top edge, and the bar carries the bottom safe-area inset itself. Floating controls (FABs, action stacks) get only their own clearance (`bottom: 16`), never `size.tabBar + inset + …`.

**Why:** the Chats FAB used the "clear the overlaid bar" formula and floated ~110dp above the bar on every platform; it was only noticed by measuring a logged-in Expo-web screenshot against the reference design. The Status screen's floating actions still use the old formula (left as-is because it was out of scope).

**How to apply:** when positioning anything relative to the bottom of a tab screen, or when a reviewer flags a "keyboard hides the bar" case: `tabBarHideOnKeyboard` is a no-op with this custom bar (no keyboard subscription), so the offset stays constant. Bottom *padding* of scroll content may still include `size.tabBar` only when the content must scroll under something; here it does not — the whole app was swept (Sept 2026) so scroll content ends with plain `space.xxl`; a list with a FAB reserves `size.fab + space.xxxl`. Stale "the tab bar is absolute" comments in repair screens were removed; treat any reappearance as wrong.
