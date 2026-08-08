---
name: PIN throttle review bar
description: What completion reviewers require for PIN brute-force throttling in the mobile app.
---
Rule: PIN attempt throttling must (1) reset on EVERY successful unlock path — biometric included, not just PIN entry; (2) close the pre-submit race with a synchronous ref set the instant the last digit is entered, blocking all pad input until verification + throttle writes finish; (3) serialize read-modify-write of the persisted counter (promise-queue mutex) so concurrent failures can't lose increments.

**Why:** Two completion-review rejections: one for biometric unlock not resetting the counter, one for the 300ms deferred submit window allowing concurrent guesses that skipped the cooldown.

**How to apply:** Any change to PIN pads or unlock flows — route success through the shared success helper in the app-lock utils and keep the sync guard pattern on both the lock screen and Security settings pad.
