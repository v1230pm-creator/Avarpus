---
name: Optimized web regression checks
description: Why critical web journeys need at least one check against the optimized production bundle.
---

Run critical authenticated browser regression checks against the optimized production bundle, not only the development server.

**Why:** Development module resolution can hide duplicated context-providing runtimes. An optimized bundle exposed an authenticated-page crash that typechecking and development behavior did not reveal.

**How to apply:** For critical web flows, build first, serve the generated output under its real base path, and drive that output in the browser. Keep shared context libraries deduplicated in bundler configuration.

The shared React api-client package depends on React Query itself, so pnpm can give it its own copy. Any artifact rendering those generated hooks must dedupe `@tanstack/react-query` (alongside react/react-dom) or the hooks and the app end up on separate QueryClient contexts — which also breaks jsdom tests that render real pages with the real hooks.