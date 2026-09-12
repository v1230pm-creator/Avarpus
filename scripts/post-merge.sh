#!/bin/bash
set -e

pnpm install --frozen-lockfile

# --force keeps drizzle-kit non-interactive. Without it, a schema change the
# tool considers risky opens a confirmation prompt, and post-merge setup runs
# with stdin closed, so the script hangs until the timeout kills it.
pnpm --filter @workspace/db run push-force
