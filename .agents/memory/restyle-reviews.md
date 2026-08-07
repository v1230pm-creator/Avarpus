---
name: Restyle review bar
description: What completion reviewers check on app-wide visual restyle tasks
---
Rule: on "make everything match the new style" tasks, reviewers reject if any screen's *primary content* (list item cards) keeps the old flat surface, even when headers/search/chips were restyled.
**Why:** Task 
review rejected an otherwise complete glassmorphism pass because one list's item cards still used the plain card token.
**How to apply:** After restyling, grep for old surface tokens (e.g. `backgroundColor: colors.card`) across all screens and convert every list-item card, not just chrome.
