# Component inventory — Avarpus Design System

Source of truth for components: the Avarpus web app library at `artifacts/avarpus-web/src/components/ui/*.tsx`
(shadcn/ui + Radix + class-variance-authority, 53 files). The phone app (Expo / React Native,
`artifacts/mobile/components/*`) is the **brand authority** for colour, radius, dark mode and the logo, but its
components are not portable to the web and are therefore not listed as web families; the rules they encode are carried
into the per-family guidelines instead.

Usage = number of consumer files (outside `components/ui/`) importing the family in the web app on 2026-09-22.
Families were ported in chunks, most-used first. Chunk 1 (the pilot) was approved on 2026-09-22 and chunks 2–4 followed; all 53 are built.

| Family | Source | Usage | Chunk | Status |
| --- | --- | ---: | ---: | --- |
| button | `artifacts/avarpus-web/src/components/ui/button.tsx` | 16 | 1 | built (pilot) |
| spinner | `artifacts/avarpus-web/src/components/ui/spinner.tsx` | 13 | 1 | built (pilot) |
| input | `artifacts/avarpus-web/src/components/ui/input.tsx` | 12 | 1 | built (pilot) |
| table | `artifacts/avarpus-web/src/components/ui/table.tsx` | 10 | 1 | built (pilot) |
| card | `artifacts/avarpus-web/src/components/ui/card.tsx` | 5 | 1 | built (pilot) |
| badge | `artifacts/avarpus-web/src/components/ui/badge.tsx` | 5 | 2 | built |
| label | `artifacts/avarpus-web/src/components/ui/label.tsx` | 4 | 2 | built |
| dialog | `artifacts/avarpus-web/src/components/ui/dialog.tsx` | 4 | 2 | built |
| tooltip | `artifacts/avarpus-web/src/components/ui/tooltip.tsx` | 1 | 2 | built |
| toaster | `artifacts/avarpus-web/src/components/ui/toaster.tsx` | 1 | 2 | built |
| toast | `artifacts/avarpus-web/src/components/ui/toast.tsx` | 2 | 2 | built |
| textarea | `artifacts/avarpus-web/src/components/ui/textarea.tsx` | 1 | 2 | built |
| avatar | `artifacts/avarpus-web/src/components/ui/avatar.tsx` | 1 | 2 | built |
| toggle-group | `artifacts/avarpus-web/src/components/ui/toggle-group.tsx` | 0 | 4 | built |
| toggle | `artifacts/avarpus-web/src/components/ui/toggle.tsx` | 0 | 4 | built |
| tabs | `artifacts/avarpus-web/src/components/ui/tabs.tsx` | 0 | 3 | built |
| switch | `artifacts/avarpus-web/src/components/ui/switch.tsx` | 0 | 3 | built |
| sonner | `artifacts/avarpus-web/src/components/ui/sonner.tsx` | 0 | 4 | built |
| slider | `artifacts/avarpus-web/src/components/ui/slider.tsx` | 0 | 4 | built |
| skeleton | `artifacts/avarpus-web/src/components/ui/skeleton.tsx` | 0 | 3 | built |
| sidebar | `artifacts/avarpus-web/src/components/ui/sidebar.tsx` | 0 | 4 | built |
| sheet | `artifacts/avarpus-web/src/components/ui/sheet.tsx` | 0 | 3 | built |
| separator | `artifacts/avarpus-web/src/components/ui/separator.tsx` | 0 | 3 | built |
| select | `artifacts/avarpus-web/src/components/ui/select.tsx` | 0 | 3 | built |
| scroll-area | `artifacts/avarpus-web/src/components/ui/scroll-area.tsx` | 0 | 3 | built |
| resizable | `artifacts/avarpus-web/src/components/ui/resizable.tsx` | 0 | 4 | built |
| radio-group | `artifacts/avarpus-web/src/components/ui/radio-group.tsx` | 0 | 3 | built |
| progress | `artifacts/avarpus-web/src/components/ui/progress.tsx` | 0 | 3 | built |
| popover | `artifacts/avarpus-web/src/components/ui/popover.tsx` | 0 | 3 | built |
| pagination | `artifacts/avarpus-web/src/components/ui/pagination.tsx` | 0 | 3 | built |
| navigation-menu | `artifacts/avarpus-web/src/components/ui/navigation-menu.tsx` | 0 | 4 | built |
| menubar | `artifacts/avarpus-web/src/components/ui/menubar.tsx` | 0 | 4 | built |
| kbd | `artifacts/avarpus-web/src/components/ui/kbd.tsx` | 0 | 4 | built |
| item | `artifacts/avarpus-web/src/components/ui/item.tsx` | 0 | 4 | built |
| input-otp | `artifacts/avarpus-web/src/components/ui/input-otp.tsx` | 0 | 4 | built |
| input-group | `artifacts/avarpus-web/src/components/ui/input-group.tsx` | 0 | 4 | built |
| hover-card | `artifacts/avarpus-web/src/components/ui/hover-card.tsx` | 0 | 4 | built |
| form | `artifacts/avarpus-web/src/components/ui/form.tsx` | 0 | 3 | built |
| field | `artifacts/avarpus-web/src/components/ui/field.tsx` | 0 | 3 | built |
| empty | `artifacts/avarpus-web/src/components/ui/empty.tsx` | 0 | 4 | built |
| dropdown-menu | `artifacts/avarpus-web/src/components/ui/dropdown-menu.tsx` | 0 | 3 | built |
| context-menu | `artifacts/avarpus-web/src/components/ui/context-menu.tsx` | 0 | 4 | built |
| collapsible | `artifacts/avarpus-web/src/components/ui/collapsible.tsx` | 0 | 4 | built |
| checkbox | `artifacts/avarpus-web/src/components/ui/checkbox.tsx` | 0 | 3 | built |
| chart | `artifacts/avarpus-web/src/components/ui/chart.tsx` | 0 | 4 | built |
| carousel | `artifacts/avarpus-web/src/components/ui/carousel.tsx` | 0 | 4 | built |
| calendar | `artifacts/avarpus-web/src/components/ui/calendar.tsx` | 0 | 4 | built |
| button-group | `artifacts/avarpus-web/src/components/ui/button-group.tsx` | 0 | 4 | built |
| breadcrumb | `artifacts/avarpus-web/src/components/ui/breadcrumb.tsx` | 0 | 3 | built |
| aspect-ratio | `artifacts/avarpus-web/src/components/ui/aspect-ratio.tsx` | 0 | 4 | built |
| alert-dialog | `artifacts/avarpus-web/src/components/ui/alert-dialog.tsx` | 0 | 3 | built |
| alert | `artifacts/avarpus-web/src/components/ui/alert.tsx` | 0 | 3 | built |
| accordion | `artifacts/avarpus-web/src/components/ui/accordion.tsx` | 0 | 4 | built |

## Chunks

1. **Pilot (built, approved):** button, spinner, input, table, card.
2. badge, label, dialog, tooltip, toaster + toast (+ hooks/use-toast), textarea, avatar — the remaining families the web app actually imports.
3. Form and layout primitives that are shipped but unused today: tabs, switch, select, checkbox, radio-group, form, field, alert, alert-dialog, sheet, dropdown-menu, popover, separator, skeleton, progress, scroll-area, pagination, breadcrumb.
4. Everything else in the library (accordion, aspect-ratio, button-group, calendar, carousel, chart, collapsible, context-menu, empty, hover-card, input-group, input-otp, item, kbd, menubar, navigation-menu, resizable, sidebar, slider, sonner, toggle, toggle-group). The web library ships no `command` or `drawer` family, so none exist here either.

## Porting rules

- Copy the source file verbatim, then rewrite only import paths: `@/lib/utils` → `../../lib/utils`, `@/components/ui/<x>` → `./<x>`, `@/hooks/<x>` → `../../hooks/<x>`; the package has no `@/` alias and hooks are copied as `.tsx`.
- Components already consume the shared token variables (`bg-primary`, `border-input`, …); do not add app-specific colours.
- Every family gets a demo page under `src/preview/demos/<slug>.tsx`, a registry entry, and a reference file under `docs/references/components/<slug>.md` citing the source path.
