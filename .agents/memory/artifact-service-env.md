---
name: Artifact service environment
description: Deployment runtime variables that must be visible when artifact processes start.
---

Put runtime-required variables such as `PORT` in the artifact service-level environment block rather than relying on a nested production-run environment block.

**Why:** Service-level environment matches generated sibling artifacts and is visible to both development and production commands. However, moving a port there did not fix a later deployment whose actual blocker was startup-time database migration, so port absence must be confirmed rather than inferred.

**How to apply:** Put required runtime variables in service-level environment. If a port still does not open, inspect process output and every operation before `listen()`—especially database work—before making another environment change.