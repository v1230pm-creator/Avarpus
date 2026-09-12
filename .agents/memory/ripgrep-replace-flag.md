---
name: ripgrep -r is replace, not recursive
description: A search habit that fabricates fake evidence of corrupted source code.
---

In `rg`, `-r` is `--replace`, not "recursive" as it is in `grep`. Writing
`rg -rn "PATTERN" .` consumes `n` as the replacement text, so every match is
printed rewritten — `process.env["SOME_KEY"]` comes back as `process.env["n"]`.

**Why:** this looks exactly like a botched find/replace in the source and can send a
whole debugging pass chasing a defect that does not exist.

**How to apply:** `rg` recurses by default — just `rg -n "PATTERN"`. If output shows an
identifier replaced by a short nonsense token that matches a flag argument, re-run the
search before believing it, and confirm against the real file with a read or `sed -n`.
