---
name: Wouter query navigation
description: Query-only login step navigation needs local React state.
---

Wouter's location subscription in this project does not re-render a route when
only its query string changes. For multi-step screens kept on one path, update
the visible step in React state at the same time as calling `setLocation`.

**Why:** The login route changed from `/login` to `/login?step=phone` but kept
rendering the welcome screen until the step state was made explicit.

**How to apply:** Use query parameters for deep-link initialization, but do not
depend on query-only navigation to drive an already-mounted component's UI.