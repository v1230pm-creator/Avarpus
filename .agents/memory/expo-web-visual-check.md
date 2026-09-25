---
name: Expo web visual check without OTP
description: How to screenshot a logged-in mobile screen on the Expo web preview when the only sign-in is OTP.
---

**Technique**
1. Insert a row into `sessions` (random 64-hex token, real user id, short expiry) directly in the dev DB — the API trusts any live session row.
2. Playwright (`playwright-core` from `artifacts/update-admin`, Chromium at `/repl/tools/bin/chromium`, run the script from inside that package so the import resolves): mobile viewport 412×915 @2x, `addInitScript` sets `localStorage.vmc_auth_token = JSON.stringify(token)` before load.
3. The dev Expo bundle is built with `EXPO_PUBLIC_DOMAIN=api.avarpus.com` (production). Intercept `https://api.avarpus.com/*` with `page.route`, re-fetch from `https://$REPLIT_DEV_DOMAIN` in Node and `route.fulfill` with `access-control-allow-origin: *` (plain `route.continue({url})` trips CORS).
4. Navigate to `https://$REPLIT_EXPO_DEV_DOMAIN/<route>`; wait for networkidle + a few seconds.
5. Delete the session, any seeded repair/events, and the temp script afterwards.

**Why:** the app has no dev login code; visual pixel-matching against user mockups is impossible from an unauthenticated preview. This gave a faithful screenshot within minutes.

**Caveats:** web adds a +67 header offset (`Platform.OS === 'web'`) — ignore vertical offset at the top. `adjustsFontSizeToFit` does nothing on web, so web truncation may not reproduce on Android. Metro sometimes serves a stale lazy route bundle after edits — restart the Expo workflow before re-screenshotting.

**Gesture checks on web:** drive touches through CDP (`page.context().newCDPSession(page)` → `Input.dispatchTouchEvent` touchStart/touchMove×N/touchEnd) rather than `mouse` — RNGH and the browser's scroll arbitration only react to real touch pointers. Measure results with `getBoundingClientRect` of a header element and the scroller's `scrollTop`; listen for `pointercancel` on `document` to tell "browser claimed the scroll" apart from "gesture never activated".

**Populated inbox without seeding:** the same `page.route` handler can `route.fulfill` `GET /api/chat/rooms` (and `/rooms/archived`) with fixture rooms (names, previews, unread, pinned, muted, outgoing status) while proxying everything else to the dev API with the real session. The tab badge derives from that list too. Use a fractional `deviceScaleFactor` (e.g. 2.3306 for a 839px-wide reference at 360dp) so screenshot pixels compare 1:1 with the reference; measure with pngjs from `node_modules/.pnpm`, and probe thin glyph edges directly — threshold-based run detection over-reports left insets by 2–3dp on letters like A/V.
