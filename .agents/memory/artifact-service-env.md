---
name: Artifact service environment
description: Deployment runtime variables that must be visible when artifact processes start.
---

Put runtime-required variables such as `PORT` in the artifact service-level environment block rather than relying on a nested production-run environment block.

**Why:** A nested production-run environment configuration passed artifact validation and local production testing, but the published artifact process exited before opening its port. Moving the port to service-level environment matched the generated artifact convention and made it available in both development and production startup.

**How to apply:** When an artifact process exits silently during deployment while its exact production command works locally, compare its environment block placement with generated sibling artifacts before changing application startup code.