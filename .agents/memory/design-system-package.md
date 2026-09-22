---
name: Avarpus design-system package
description: Non-obvious rules for artifacts/avarpus-design-system (tokens, ported shadcn set, preview quirks) and the user's application gate.
---

# Avarpus design-system package

- **Application gate (user rule, 2026-09-22):** the design system exists as documentation + a consumable package only. The user explicitly said "not yet" to applying it to any app screen (web or mobile). Do not restyle or re-home app screens/mockups onto it until they say so.
- **Authority split:** mobile theme (`artifacts/mobile/constants/colors.ts`, `brand.ts`) is the brand authority for tokens; the web app's shadcn set (`artifacts/avarpus-web/src/components/ui`, 53 files, no command/drawer) is the component source. Ports are verbatim except import-path rewrites; verify with a sed-normalised diff before claiming parity.
- **Chart tokens are HSL triplets:** the generated theme emits `--chart-N: h s% l%`, so chart configs must use `hsl(var(--chart-N))`; bare `var(--chart-N)` renders black.
- **Preview deep links:** `#page=<id>&theme=light|dark`; both params must be preserved when either changes, and hashes without `page=` (demo anchors) must not reset to Overview. Use them for screenshots since the toggle cannot be clicked.
- **Bounding fixed components in a story:** shadcn Sidebar is position: fixed; pin it with a `relative` frame plus `[&_[data-slot=sidebar-container]]:absolute … :h-full` and `min-h-0` on the provider. Modal overlays (dialog/alert-dialog/sheet) stay closed by default; menus may use `defaultOpen modal={false}`.
- **Subagent-authored demos arrive minified on one line** — run prettier (single quotes, 100 cols) over `src/preview/demos` after delegation.
- **Build needs env:** `PORT` and `BASE_PATH=/avarpus-design-system/` are required by vite.config; the workflow provides them, a manual `pnpm run build` does not.
