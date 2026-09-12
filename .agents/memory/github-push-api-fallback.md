---
name: GitHub push via API fallback
description: What to do when the GitHub connection's auth() returns unauthenticated and git push can't get a token
---
**Rule:** If `client.auth()` returns `{type:"unauthenticated"}` (no token) but `proxyFetch('/user')` works, the connection is healthy — tokens are just redacted at the sandbox boundary. Push commits via the Git Data API through `proxyFetch` instead (blobs → tree with base_tree → commit → PATCH refs/heads/<branch>).

**Why:** Aug 15, 2026 — token retrieval stopped working mid-session; API push succeeded and unblocked APK builds.

**Gotcha (Aug 17 2026): never base64-encode file contents via `shellExec` for pushes** — its output is silently head/tail-truncated around ~80KB even with maxOutputBytes raised, which corrupted pnpm-lock.yaml + other large files on GitHub and broke EAS builds. Instead `readFile({path, maxBytes: 1048576})` in durable scope, pass content into the impure fn, `Buffer.from(content,"utf8").toString("base64")` there. After any push verify: local `git ls-tree -r HEAD` blob shas vs remote recursive tree — shas match iff content identical.

**Gotcha:** CodeExecution `shellExec` output uses CRLF — file lists split on `\n` keep a trailing `\r` that breaks paths/readFile. Always strip `\r` before using shell output as paths.

**How to apply:** After an API push, local and remote SHAs DIVERGE (same content, different commits). Before the next token-based `git push`, either `git fetch && git reset --hard origin/<branch>` (if no new local work) or push with `--force-with-lease` knowing content is identical. As of Sep 12 2026, local `main` (8ed7013) and remote `main` (318f4df) have IDENTICAL trees but different commit SHAs; treat the next push as a tree-delta push again, not a fast-forward.

## Empty repository bootstrap

GitHub returns `409 Git Repository is empty` for low-level `/git/blobs` and
`/git/trees` writes while a repository has no initial commit. First create the
target branch with `PUT /contents/<an actual tracked file>`; then use the Git
Data API for the complete tree and a normal non-force ref update.

**Why:** An empty repo cannot accept a standalone blob even through the
authenticated proxy, but a Contents API write creates the first real commit
and unlocks the lower-level APIs.

**How to apply:** Never leave a placeholder-only initial commit: immediately
replace its tree with the full local tracked tree, then verify the remote commit
tree SHA and every remote blob/mode/path against local `HEAD`.

## Broken ref pitfall (learned Aug 2026)
A previous Git Data API push left `refs/heads/vmc-electronic-bms` pointing at a TREE object, not a commit. Symptom: `/branches`, `/commits`, `/git/ref/heads/...`, `/git/trees/{sha}`, `/git/commits/{sha}` all 404 (reachability checks), while `/contents?ref=branch` and blob POST still work — looks like a flaky proxy but isn't.
**Fix:** push each file via `PUT /contents/{path}` with `branch` + current file `sha` — contents PUT creates real commits and repairs the ref automatically. Loop all files serially with sha-refetch retry on 409/422.
**Prevention:** when PATCHing a ref, always pass a COMMIT sha (from `git/commits` POST response), never a tree sha; verify `object.type === "commit"` after.

## Large exact-tree sync
When the remote branch has drifted by hundreds of files, upload missing blobs serially. Concurrent `proxyFetch` blob uploads can fail during durable replay, and one oversized flat `POST /git/trees` can time out.

Build Git trees bottom-up instead: create each directory tree from its immediate blob/subtree entries, then create the root tree. The root SHA must equal local `HEAD^{tree}` before creating the commit. After patching the ref, tolerate a brief stale read, then re-fetch and verify both `object.type === "commit"` and the commit tree SHA.

**Why:** This avoids truncated content, connector replay failures, GitHub tree payload timeouts, and accidental publication of a partial repository tree.

**How to apply:** Use this path only when normal `git push` is unavailable and a recursive local-vs-remote SHA comparison shows broad drift.

## Connector WAF limits
GitHub connector writes may return a Cloudflare 403 for raw source trees or specific non-build files even when repository access is healthy. Do not reconnect or force-push in response.

**Why:** The same connection can read the repo and create ordinary blobs while a source-heavy tree body is blocked by the proxy/WAF.

**How to apply:** Upload required build files as base64 Git blobs, then create a small SHA-only tree on the verified remote base. Restrict release commits to real build inputs and preserve remote-only files.

## Chunked base_tree delta (Sep 2026, ~330 changed paths)
Plan the delta by comparing local `git ls-tree -r HEAD` blob SHAs with the remote recursive tree; upload only added/changed blobs (serially, base64, verify returned SHA == local SHA); then POST `/git/trees` in chunks of ~60 entries, each with `base_tree` = the previous chunk's result (deletions are entries with `sha: null`). The final root SHA must equal local `HEAD^{tree}` before creating the commit. Whole run for 311 blobs + 15 deletes took a few minutes and hit no WAF 403s.

**Gotcha:** a helper function defined in one CodeExecution block and reused in a later block failed with `executeJs is not defined`; define the impure uploader inline in every block.
