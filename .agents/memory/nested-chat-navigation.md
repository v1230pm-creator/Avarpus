---
name: Nested chat navigation
description: Full-screen conversations nested below a tab require explicit stack registration and tab-bar control.
---

For a focused chat route nested inside the Customers tab, register the chat child in the Customers stack and locate the actual tab navigator by walking parent navigation state before hiding its tab bar. Profile-originated chats should return explicitly to their Customer or Dealer profile rather than trusting browser history.

**Why:** Nested navigation can render a chat screen behind the tab stack or leave the tab bar visible; browser history may also return to the Home tab instead of the originating profile.

**How to apply:** When adding another focused, tab-nested subflow (conversation, reader, detail workspace), verify the route is a known child of its stack, hide the tab bar only while focused, and use a deterministic back destination when the route carries an origin identifier.