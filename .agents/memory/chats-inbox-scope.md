---
name: Chats inbox scope
description: Defines the private customer/direct-conversation boundary for the main Chats tab.
---

The main Chats tab is a private customer/direct-conversation inbox. It may show customer rooms and one-to-one direct rooms started only from exact phone/contact matches; repair tickets, delivery status, payments, and dealer conversations do not belong there. Never add a browseable user directory.

**Why:** The user wants a WhatsApp-like communication experience while preserving privacy: verified users may find registered contacts they already know across Avarpus, but must never browse a directory or gain access to another shop's business data.

**How to apply:** Keep the bottom tab/status bar unchanged. Include only customer and direct rooms. Exact phone/contact matching is global across active Avarpus users and must be durably throttled per user and IP. Global direct creation requires a short-lived caller/target-bound proof—never trust a raw target UUID—and rooms authorize solely by explicit membership. Keep business/customer/dealer rooms shop-scoped and database-enforced so global chat cannot expose repairs, payments, inventory, finance, staff, or dealer data. Preserve real chat data and the E2EE-unavailable messaging.