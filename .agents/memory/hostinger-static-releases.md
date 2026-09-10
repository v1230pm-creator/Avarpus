---
name: Hostinger static releases
description: Durable packaging and rendering rules for the official website's Hostinger ZIP.
---

Hostinger root-deployment ZIPs must carry their own SPA fallback and force browsers to revalidate the app shell, while hashed assets may use immutable caching.

**Why:** Direct refreshes of routes such as `/support` can fail without the rewrite, and stale cached HTML can continue loading an obsolete logo or JavaScript bundle after a replacement upload.

**How to apply:** Build with the domain-root base path, package `.htaccess` at archive root, and keep `index.html` uncached. For HTML/CSS phone mockups, size elements directly instead of scaling or rotating a parent container, which can rasterize the subtree and blur text.