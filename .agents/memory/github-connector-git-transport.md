---
name: GitHub connector vs Git transport
description: Distinguishes Replit's GitHub API authorization from credentials used by shell Git pushes.
---

An Active Replit GitHub integration does not imply that `git push` in the shell has HTTPS or SSH credentials. For a repository-specific fallback, use a write-enabled deploy key and keep the private key outside the project tree.

**Why:** The connector could read and mutate the repository through GitHub REST, while both HTTPS Git and SSH Git remained unauthenticated. Large initial imports through the REST Git Data API also encountered proxy and rate-limit failures.

**How to apply:** Verify shell transport independently with `git ls-remote`. If normal Git credentials are unavailable and the user approves the security change, generate the deploy key in the shell environment that will run Git (a key generated inside CodeExecution is not visible there), add its public key through the connector, use SSH, and verify the remote branch SHA equals local HEAD after pushing.