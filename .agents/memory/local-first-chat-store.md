---
name: Local-first chat store (mobile)
description: Durable rules for the on-device chat database, sync engine and outbox in the Expo app; read before touching chat rendering, sends, unread counts or sign-out.
---
- **Device store renders, server syncs.** When a store is open, chat screens and badges read from it and the network room/message queries are disabled; `store: null` (web-less fallback, failed SQLite open, Jest) keeps the old network-only path alive. Keep both paths working.
- **Why:** polling was replaced by push/foreground/open-triggered delta sync plus a slow fallback poll, so a feature that only invalidates react-query keys will not update the screen on devices.
- **How to apply:** after any chat mutation, mirror it into the store or request a sync; never key local rows on Matrix ids.
- **Unread counts need the server baseline.** The device only holds a recent window of history, so the room-list `unreadCount` is stored with an anchor (newest message at capture) and local rows are counted only after that anchor until the viewer's own read marker passes it. Recomputing purely from local rows makes dormant rooms look unread and backlogs look like one message.
- Own messages are stored pre-acked; delivered acks are queued for incoming rows only, first-seen-only; a 404 on an ack batch is settled item by item.
- The outbox flushes in enqueue order and stops at the first retryable failure; its retry timer must keep working without any connectivity event (a transient fetch `TypeError` while the OS still reports online otherwise strands the queue). Only the OS network listener may flip the flusher offline.
- Read marking mirrors locally and optimistically (works offline); do not hang store writes off `mutate` callbacks — tests assert the exact `mutate` call shape.
- Native SQLite is loaded through a platform-split module whose `.web.ts` sibling returns null: expo-sqlite's web build ships a WASM worker that must never enter the web bundle. Jest mocks `expo-sqlite` to reject so screens exercise the fallback.
- App-wide code must not import the voice-recorder hook (it drags expo-audio into the root layout); shared temp-file disposal lives in its own util.
- Store lifecycle is keyed on the user id; the provider destroys the previous account's database whenever the id changes or becomes null (401, logout, deletion), and a shop switch for the same user wipes rows.
