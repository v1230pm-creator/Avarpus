---
name: Chats inbox scope
description: Defines the private customer/direct-conversation boundary for the main Chats tab.
---

The main Chats tab is a private customer/direct-conversation inbox. It may show customer rooms and one-to-one direct rooms started only from exact phone/contact matches; repair tickets, delivery status, payments, and dealer conversations do not belong there. Never add a browseable user directory.

**Why:** The user wants a clean communication-first experience while preserving privacy: users may find registered contacts they already know, but must not browse everyone in a shop or across shops.

**How to apply:** Keep the bottom tab/status bar unchanged. Include only customer and direct rooms. Direct creation must require a short-lived caller/target/shop-bound proof from an exact active same-shop contact match—never trust a raw target UUID—and matching must be durably throttled per user and IP. Preserve real chat data and the E2EE-unavailable messaging.