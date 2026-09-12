---
name: Branded loading indicator
description: Rules for the one product-wide loading animation (mobile + web) and what may drive it.
---

The product has a single loading motion: a 12-blade ring that reads as a clockwise
sweep. Mobile and each web app keep their own copy of the primitive (matching the
existing per-app `ui/` convention); the shapes and timing must stay identical.

**Why:** several apps had drifted to platform `ActivityIndicator`, ad-hoc border
spinners and bare "Loading..." text, so the same wait looked different on every
surface.

**How to apply**
- Mobile uses core React Native `Animated` with `useNativeDriver`, not Reanimated.
  The rotation must keep moving while JS is busy, and reduce-motion must not freeze
  it — it is often the only signal that anything is happening.
- Web injects its keyframes once from the component module, so the primitive can be
  copied into a new app without touching that app's stylesheet.
- A spinner may only be driven by a real in-flight operation. Never by `disabled`
  (which usually also means "fields incomplete") and never by a durable status such
  as a request sitting in review for days — those get a static icon.
- Search spinners belong next to the magnifier in a fixed-width slot that is always
  rendered (so typing never shifts) and marked `pointer-events-none`. Only add one
  where the term actually reaches the server; a locally filtered array has no wait
  to report.
- A spinner inside an already-labelled control must be decorative (no progressbar
  role), and the control keeps its own accessible label plus a busy state.
- Content-shaped skeletons that mirror real rows are better than a spinner; leave
  them alone.
