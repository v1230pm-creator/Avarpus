---
name: Expo motion testing
description: How reduced-motion behavior can affect automated verification of Reanimated opening animations.
---

Reanimated web previews may report reduced motion from the host environment even when a browser test requests `no-preference`. A deliberately shortened accessible animation can therefore look like an early transition in automated timing checks.

**Why:** A full-screen opening animation rendered correctly in direct preview captures, but timed browser automation repeatedly entered the reduced-motion branch and reported that the intro ended too early.

**How to apply:** Keep reduced-motion support, but do not treat a web timing failure as proof that normal device motion is broken. Verify visual frames directly and confirm final native timing on a physical build with system Reduce Motion disabled.