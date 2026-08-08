---
name: Lock-state mutation review bar
description: What completion reviewers require for any code that changes PIN/biometric lock state on device.
---

Reviewers reject lock/security-setting changes unless mutations are both cancel-safe and failure-safe.

**Why:** Task reviews rejected the security screen three times for: (1) a deferred setTimeout PIN submit that could still fire after Cancel, (2) cancel remaining possible while writes were in flight, (3) disable clearing the PIN before the biometric flag, so a mid-way failure left an unusable biometric-only lock.

**How to apply:**
- Guard deferred/async PIN submissions with an operation token + in-flight ref; invalidate on cancel/back/unmount and re-check the token before every write.
- Block cancel/back while a submission is committing.
- Order composite writes so a mid-way failure always leaves a *working* lock (remove biometric flag before clearing the PIN); `disableAppLock()` in the mobile app encodes this and has Jest tests.
- On failure, re-read storage and surface actual state rather than assumed state.
