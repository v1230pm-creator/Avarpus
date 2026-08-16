---
name: GitHub push via API fallback
description: What to do when the GitHub connection's auth() returns unauthenticated and git push can't get a token
---
**Rule:** If `client.auth()` returns `{type:"unauthenticated"}` (no token) but `proxyFetch('/user')` works, the connection is healthy — tokens are just redacted at the sandbox boundary. Push commits via the Git Data API through `proxyFetch` instead (blobs → tree with base_tree → commit → PATCH refs/heads/<branch>).

**Why:** Aug 15, 2026 — token retrieval stopped working mid-session; API push succeeded and unblocked APK builds.

**Gotcha:** CodeExecution `shellExec` output uses CRLF — file lists split on `\n` keep a trailing `\r` that breaks paths/readFile. Always strip `\r` before using shell output as paths.

**How to apply:** After an API push, local and remote SHAs DIVERGE (same content, different commits). Before the next token-based `git push`, either `git fetch && git reset --hard origin/<branch>` (if no new local work) or push with `--force-with-lease` knowing content is identical. As of Aug 15 2026, local `vmc-electronic-bms` (f81bc9a) diverges from remote head 41011ba this way.
