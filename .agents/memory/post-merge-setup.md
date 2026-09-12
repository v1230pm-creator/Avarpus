---
name: Post-merge setup script
description: Why the post-merge script must use the forced drizzle push, and what a post-merge timeout usually means here.
---

# Post-merge setup script

The post-merge script must apply the schema with the **forced** drizzle push variant, never the
plain one.

**Why:** post-merge setup runs with stdin closed. Plain `drizzle-kit push` opens an interactive
confirmation whenever it judges a change risky (renames, drops, truncations). With no stdin it
neither answers nor aborts — it sits there until the configured timeout kills the whole script, and
the merge is reported as a setup failure even though nothing is actually wrong with the code.

**How to apply:** when post-merge setup reports a timeout, measure the steps by hand first
(`pnpm install --frozen-lockfile` and the schema push each take seconds in this workspace). If the
measured runtime is far below the timeout, the script hung on a prompt — fix the prompt, do not
raise the timeout.

## Related: orphan dev processes after a merge

Merges frequently leave the previous dev-server processes alive. The new workflow copies then fail
to bind (`EADDRINUSE`), and Expo goes further: it asks "Use port NNNN instead?" and hangs on that
prompt forever. Workflow logs then look like code breakage when the code is fine. Check for
long-running duplicate processes on the artifact ports before believing a post-merge workflow
failure.
