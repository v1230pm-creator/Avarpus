---
name: Headless workspace builds
description: How root validation can bundle every artifact without weakening deployment configuration checks.
---

Keep deployment-specific environment requirements enforced by direct artifact builds. When a root workspace build needs an API origin only to exercise a static bundler, inject an obviously non-routable validation placeholder from the root command rather than adding a usable fallback to the artifact.

**Why:** A headless workspace build has no published origin, while weakening the artifact's own requirement could silently produce a deployable bundle pointed at the wrong backend. Concurrent preview workflows can also occupy conventional dev ports, so build-only helper processes must support an explicit validation port instead of assuming the preview port.

**How to apply:** Treat root builds as compilation validation, inject each artifact's real routed base path from the root command, keep direct production artifact builds fail-closed on required deployment values, and give temporary build servers a validation-only port override.