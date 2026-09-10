---
name: Startup splash continuity
description: Rules for keeping the mobile app's cold start visually seamless — opaque splash surface, theme-bound navigator background, and no decorative gating.
---

The opening sequence must read as one uninterrupted surface: native splash →
JS splash → first screen, with no colour flash between them.

**Rules**

1. The JS splash fades its *contents* (mark, footer) only. Its background stays
   fully opaque until the component unmounts.
2. The root navigator's `screenOptions.contentStyle` background must be bound
   to the active theme colour.
3. Startup must never be gated on decorative assets. Hide the native splash on
   mount; never wait for an image `onLoad`/`onError` callback, and never decode
   a large background image on the startup path.
4. Any post-splash loading fallback on the entry route uses the splash
   background, not the light theme background.
5. The splash hands off as soon as auth/lock state resolves, plus a short
   minimum visible window so the mark cannot flicker. A long fixed timer is not
   a substitute for readiness.
6. Native splash configuration, JavaScript splash, bootstrap HTML, auth
   navigator, and branded onboarding screens must use one shared opaque brand
   colour. Do not reintroduce image wallpapers, stars, gradients, or transparent
   overlays on this opening path.
7. On that blue field, use the shared on-blue tokens — never the light/dark app
   theme's muted greys, which drop to roughly 1:1 contrast and read as invisible
   text. The primary control is a white pill with deep-ink text, and it must not
   express "disabled" through opacity: a dimmed control vanishes into the blue.
   Prefer keeping such a control enabled and reporting validation inline. The
   text-bearing blue must keep white headings and 88%-white supporting copy at
   4.5:1 or better; use dark translucent input surfaces rather than white glass,
   which reduces the contrast of white input text.
8. Only the transparent logo mark may sit on this surface. The disc-backed logo
   asset bakes in an opaque blue circle of a slightly different hue, which reads
   as a shadow ring, and its artwork runs to the canvas edge with no padding, so
   the speech-bubble tail looks clipped. Both defects were previously masked by
   a decorative halo view, which no longer exists.

**Why:** fading the whole splash root to transparent reveals whatever is
underneath, and the native stack defaults to its own light surface — so a
dark-branded splash flashed white mid-exit even in dark mode. Separately, the
old splash decoded a multi-megabyte night-sky background and ran a multi-second
scripted animation before handing off, which is what made opening feel slow.
The approved onboarding direction is a solid blue field in the app icon's blue
family, not a live galaxy background. Exact hue matching is secondary to outdoor
legibility: the text-bearing variant is intentionally deeper than the original
bright cyan so white copy remains readable.

**How to apply:** whenever touching the splash, the entry route, or the root
layout's stack options. Two completion paths (animation callback and a bounded
watchdog) must both route through one idempotent finish guard; keep the
watchdog's lifetime tied to unmount, not to effect dependencies, or a re-render
with a fresh inline callback prop silently disarms it.

**Verification note:** a sub-second splash cannot be caught by a preview
screenshot. Temporarily raise the minimum visible window to inspect it, then
revert. Real cold-start appearance (pre-layout flash, light vs dark) can only
be confirmed on a custom native build, not in Expo Go or web.
