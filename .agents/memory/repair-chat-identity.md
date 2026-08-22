---
name: Repair chat identity
description: Home repair rows may be legacy records without a persisted customer link.
---

When opening chat from a repair-row customer identity, prefer the repair's customer ID; for legacy rows where it is missing, resolve exactly one live shop customer by normalized phone, then by an unambiguous normalized name. Never form a chat route with an undefined ID or fall through to the repair detail action.

**Why:** Historic delivered repairs can retain customer display data while lacking the relational customer link, which otherwise makes a user tap navigate to an invalid conversation.

**How to apply:** Keep customer identity and repair-detail hit areas separate. Treat ambiguous or missing identity as unavailable rather than guessing a customer.