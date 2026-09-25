---
name: One-hand reach gesture (hold anywhere, drag, stays put)
description: Rules, trade-offs and platform quirks behind the app-wide "hold a finger still, then drag the page down/up; it stays where released" gesture (components/ui/ReachDown.tsx).
---

**Model the user settled on (Sept 2026, replaces the earlier "pull twice at the top" trigger):** hold still anywhere on a screen (~450 ms), then drag; the whole page — app bar included — follows the finger down *or* up and **stays exactly where released**. No stops, no snap, no inertia. Blank strip above the page has a chevron; tapping it, the keyboard opening, or a route change brings the page back. Applies to **every** screen (mounted once per navigator via `screenLayout` in the tabs layout and the root stack), while the main tab bar stays fixed. Pull/stretch triggers and fixed positions were explicitly rejected — do not reintroduce them.

**Why hold is timed by our own UI-thread timer with `manualActivation`, not `activateAfterLongPress`:** the veto list must be evaluated *at* activation time: a control that keeps the touch (`useReachHoldOff` from `onPressIn`), a text field under the finger, a stale touch (ticket), or a reset that happened meanwhile (`dropped`). A finger that moves > slop before the hold fails the pan, so scrolling/swiping/tapping is untouched.

**Why 450 ms:** above Android's 400 ms system long press (a text field's caret/paste hold has already happened and is detected), below RN Pressable's 500 ms default so the grab wins over stray row long presses. Users with an accessibility "long press delay" set longer are covered for text fields by target detection, not timing.

**Text fields are detected by host element, not per site:** on RN 0.86 (new architecture only) every `event.target` is a `ReactNativeElement`; `tagName` is `RN:TextInput` on Android *and* iOS (the Android prefix is normalised in `dom::getTagName`), `INPUT`/`TEXTAREA` on web. The root View's `onTouchStart` sees this well inside the hold. So ~40 raw `<TextInput>` sites need nothing. Selectable `<Text>` cannot be told apart by tag — those few sites call `holdOff` from `onPressIn`.

**Long-press conflicts were resolved in favour of the grab** (product call, flagged to the user): inbox rows select by holding the *photo* (content long press removed — otherwise a full inbox is un-grabbable); repair cards send-to-dealer only through the visible ⋮ button (now a full 44 dp box in the corner: hit slop is clipped by the card edge); chat messages select by holding the *bubble*, not the row margin. The status "add" row keeps its long press with `holdOff`.

**Reset race:** `close()` (route change, keyboard) must set `dropped` so a resting finger's pending timer cannot activate and an active drag stops writing `shift`; otherwise `onUpdate` overwrites the return spring and the page ends displaced. `dropped` is cleared on the next touch-down.

**Web:** the browser claims a moving touch as a scroll unless `touchmove` is prevented; a non-passive listener on the root that calls `preventDefault()` only while held keeps the pointer stream with the gesture — verified on Chromium with CDP touches (drag up 70 px at scrollTop 0 → page moved, list did not scroll, no `pointercancel`).

**iOS:** still unverified on a device; the manual activation from a UI timer is reasoned from RNGH source. Say so rather than claiming support.

**Testing:** RNGH's jest utils cannot simulate manual activation; keep the decisions in pure `'worklet'` helpers (`utils/reachDown.ts`) and unit-test those; `react-native-gesture-handler/jestSetup` stays in Jest `setupFiles`. Any test that mocks `expo-router` for the tabs layout must now stub `usePathname` too. Web behaviour is checked with Playwright CDP `Input.dispatchTouchEvent` (see expo-web-visual-check.md).
