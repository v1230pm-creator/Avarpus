---
name: GitHub push via API fallback
description: What to do when the GitHub connection's auth() returns unauthenticated and git push can't get a token
---
**Rule:** If `client.auth()` returns `{type:"unauthenticated"}` (no token) but `proxyFetch('/user')` works, the connection is healthy — tokens are just redacted at the sandbox boundary. Push commits via the Git Data API through `proxyFetch` instead (blobs → tree with base_tree → commit → PATCH refs/heads/<branch>).

**Why:** Aug 15, 2026 — token retrieval stopped working mid-session; API push succeeded and unblocked APK builds.

**Gotcha (Aug 17 2026): never base64-encode file contents via `shellExec` for pushes** — its output is silently head/tail-truncated around ~80KB even with maxOutputBytes raised, which corrupted pnpm-lock.yaml + other large files on GitHub and broke EAS builds. Instead `readFile({path, maxBytes: 1048576})` in durable scope, pass content into the impure fn, `Buffer.from(content,"utf8").toString("base64")` there. After any push verify: local `git ls-tree -r HEAD` blob shas vs remote recursive tree — shas match iff content identical.

**Gotcha:** CodeExecution `shellExec` output uses CRLF — file lists split on `\n` keep a trailing `\r` that breaks paths/readFile. Always strip `\r` before using shell output as paths.

**How to apply:** After an API push, local and remote SHAs DIVERGE (same content, different commits). Before the next token-based `git push`, either `git fetch && git reset --hard origin/<branch>` (if no new local work) or push with `--force-with-lease` knowing content is identical. As of Aug 15 2026, local `vmc-electronic-bms` (f81bc9a) diverges from remote head 41011ba this way.

## Broken ref pitfall (learned Aug 2026)
A previous Git Data API push left `refs/heads/vmc-electronic-bms` pointing at a TREE object, not a commit. Symptom: `/branches`, `/commits`, `/git/ref/heads/...`, `/git/trees/{sha}`, `/git/commits/{sha}` all 404 (reachability checks), while `/contents?ref=branch` and blob POST still work — looks like a flaky proxy but isn't.
**Fix:** push each file via `PUT /contents/{path}` with `branch` + current file `sha` — contents PUT creates real commits and repairs the ref automatically. Loop all files serially with sha-refetch retry on 409/422.
**Prevention:** when PATCHing a ref, always pass a COMMIT sha (from `git/commits` POST response), never a tree sha; verify `object.type === "commit"` after.

## Large exact-tree sync
When the remote branch has drifted by hundreds of files, upload missing blobs serially. Concurrent `proxyFetch` blob uploads can fail during durable replay, and one oversized flat `POST /git/trees` can time out.

Build Git trees bottom-up instead: create each directory tree from its immediate blob/subtree entries, then create the root tree. The root SHA must equal local `HEAD^{tree}` before creating the commit. After patching the ref, tolerate a brief stale read, then re-fetch and verify both `object.type === "commit"` and the commit tree SHA.

**Why:** This avoids truncated content, connector replay failures, GitHub tree payload timeouts, and accidental publication of a partial repository tree.

**How to apply:** Use this path only when normal `git push` is unavailable and a recursive local-vs-remote SHA comparison shows broad drift.
