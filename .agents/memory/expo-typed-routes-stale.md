---
name: Stale Expo typed routes
description: Mobile typecheck fails with TS2345 on router.push for a route file that exists — the git-ignored .expo/types/router.d.ts is stale.
---

**Rule:** When `pnpm --filter @workspace/mobile run typecheck` rejects a `router.push('/(tabs)/...')` path whose screen file clearly exists under `app/`, regenerate typed routes before touching code:

```
cd artifacts/mobile && CI=1 npx expo customize tsconfig.json
```

It rewrites `.expo/types/router.d.ts` without starting Metro and leaves `tsconfig.json` unchanged.

**Why:** `.expo/types/router.d.ts` is git-ignored and only refreshed by a running Metro dev server or `expo customize`. A branch that added a new route file (e.g. `more/chat-storage.tsx`) without ever running the Expo workflow leaves the workspace with the previous branch's declarations, so validation steps `typecheck`, `workspace-typecheck`, and `workspace-build` all fail with exit 2 on code that is correct.

**How to apply:** Check `grep -c <route-name> artifacts/mobile/.expo/types/router.d.ts` first; 0 hits = stale declarations, not a code bug. This is not a fix to commit — nothing tracked changes.
