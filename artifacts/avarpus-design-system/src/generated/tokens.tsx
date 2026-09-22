/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#f4f7fb",
      "foreground": "#162236",
      "border": "#d7e1ed",
      "card": "#ffffff",
      "cardForeground": "#162236",
      "popover": "#ffffff",
      "popoverForeground": "#162236",
      "primary": "#0f62fe",
      "primaryForeground": "#ffffff",
      "secondary": "#eaf0f7",
      "secondaryForeground": "#3e5068",
      "muted": "#eaf0f7",
      "mutedForeground": "#718096",
      "accent": "#eaf2ff",
      "accentForeground": "#0866ff",
      "destructive": "#ff4d4f",
      "destructiveForeground": "#ffffff",
      "input": "#d7e1ed",
      "ring": "#0f62fe",
      "chart1": "#0866ff",
      "chart2": "#20c878",
      "chart3": "#d9a441",
      "chart4": "#8b5cf6",
      "chart5": "#0891b2",
      "sidebar": "#162236",
      "sidebarForeground": "#f1f4f8",
      "sidebarBorder": "#2d3644",
      "sidebarPrimary": "#1683ff",
      "sidebarPrimaryForeground": "#ffffff",
      "sidebarAccent": "#262e3a",
      "sidebarAccentForeground": "#f1f4f8",
      "sidebarRing": "#1683ff"
    },
    "dark": {
      "background": "#1b212b",
      "foreground": "#f1f4f8",
      "border": "#38424f",
      "card": "#262e3a",
      "cardForeground": "#f1f4f8",
      "popover": "#333d4c",
      "popoverForeground": "#f1f4f8",
      "primary": "#0f62fe",
      "primaryForeground": "#ffffff",
      "secondary": "#2d3644",
      "secondaryForeground": "#b7c0ce",
      "muted": "#222934",
      "mutedForeground": "#aab4c3",
      "accent": "#192b4b",
      "accentForeground": "#1683ff",
      "destructive": "#ff4d4f",
      "destructiveForeground": "#ffffff",
      "input": "#38424f",
      "ring": "#1683ff",
      "chart1": "#1683ff",
      "chart2": "#34d399",
      "chart3": "#f2c96b",
      "chart4": "#a78bfa",
      "chart5": "#22d3ee",
      "sidebar": "#151a22",
      "sidebarForeground": "#f1f4f8",
      "sidebarBorder": "#2d3644",
      "sidebarPrimary": "#1683ff",
      "sidebarPrimaryForeground": "#ffffff",
      "sidebarAccent": "#262e3a",
      "sidebarAccentForeground": "#f1f4f8",
      "sidebarRing": "#1683ff"
    }
  },
  "fontFamily": {
    "sans": [
      "Inter",
      "system-ui",
      "sans-serif"
    ],
    "serif": [
      "Georgia",
      "serif"
    ],
    "mono": [
      "JetBrains Mono",
      "Menlo",
      "monospace"
    ]
  },
  "radius": "0.75rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
