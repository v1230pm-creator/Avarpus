---
name: Android TextInput focus loss via view flattening
description: Login keyboard instant-dismiss root cause and the collapsable=false fix; how it was proven via simulator + Metro logs.
---

**Rule:** Any View that wraps a TextInput AND changes style on focus (e.g. `focused && styles.inputFocused` border) must have `collapsable={false}` on Android. Otherwise the focus-driven re-render makes Android restructure (flatten/unflatten) the native view, the TextInput is detached/reattached, focus ping-pongs to the sibling input within ~35ms, and the keyboard dismisses instantly.

**Why:** This was the months-long "login keyboard opens then closes" bug that survived 6 APK rebuilds. Proven by timestamped focus/blur logs in the Replit Android simulator: single tap produced EMAIL FOCUS→BLUR→PASS FOCUS→BLUR→EMAIL FOCUS→BLUR in 70ms. Ruled out (verified NOT culprits): React Compiler, Android autofill props, keyboard-controller scroll wrapper, Reanimated entry animations, particles/glow, removeClippedSubviews, remounts, app-state changes.

**How to apply:** Add `collapsable={false}` to every focus-styled input row (done on login email/password/mobile rows). Register screen worked only because it never re-rendered on focus. Debugging pattern that cracked it: temporary console.log diagnostics in the screen + Replit "Simulate on Android" + Metro workflow logs = live device evidence without APK builds; strip all debug code before pushing (user requires production-only code).
