---
name: Stale api-client d.ts
description: Mobile typecheck resolves lib types from dist/*.d.ts — pretypecheck now rebuilds them; keep tsbuildinfo inside dist.
---

The Expo app's `tsc --noEmit` resolves `@workspace/api-client-react` types from `lib/api-client-react/dist/*.d.ts` (composite project references), even though the package's `exports` points at `src/index.ts` (which Metro uses at runtime).

**Why:** Adding a new export to the lib's `src` compiles/runs fine but shows `TS2305: no exported member` in the mobile typecheck until declarations are regenerated. Also, if the `.tsbuildinfo` file lives outside `dist` (which is git-ignored), `tsc -b` can think the lib is up to date while `dist` is stale or missing, silently emitting partial output.

**How to apply:** The mobile `pretypecheck` script runs `tsc -b ../../lib/api-client-react` automatically, so `pnpm run typecheck` self-heals. Keep `tsBuildInfoFile` pointed at `dist/tsconfig.tsbuildinfo` so build state is deleted along with `dist`.
