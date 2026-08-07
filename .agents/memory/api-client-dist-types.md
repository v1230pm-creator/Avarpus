---
name: Stale api-client d.ts
description: Mobile typecheck resolves lib types from dist/*.d.ts, not src — rebuild declarations after changing lib exports.
---

The Expo app's `tsc --noEmit` resolves `@workspace/api-client-react` types from `lib/api-client-react/dist/*.d.ts` (composite project references), even though the package's `exports` points at `src/index.ts` (which Metro uses at runtime).

**Why:** Adding a new export to the lib's `src` compiles/runs fine but shows `TS2305: no exported member` in the mobile typecheck until declarations are regenerated.

**How to apply:** After changing lib exports, run `npx tsc -p lib/api-client-react/tsconfig.json` to refresh `dist` declarations before trusting mobile typecheck results.
