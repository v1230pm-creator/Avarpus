/**
 * Spacing, radius and control sizes shared by every screen. Values are dp;
 * layouts must compose them with flex, never with absolute screen coordinates.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const layout = {
  /** Horizontal inset of screen content from the display edge. */
  screenPadding: 20,
  /** Gap between a row's avatar and its text block. */
  avatarGap: 16,
  /** Vertical padding of a list row. */
  rowPaddingVertical: 14,
  /** Space between a screen header and the search/content below it. */
  headerGap: 24,
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
} as const;

export const size = {
  /** List row avatar. */
  avatar: 64,
  avatarSm: 44,
  /** Bottom navigation icon. */
  navIcon: 27,
  /** Header / toolbar icon glyph. */
  headerIcon: 26,
  /** Inline icon inside rows and fields. */
  inlineIcon: 20,
  /** Tap target for icon-only buttons. */
  iconButton: 44,
  /** Unread-count badge in lists. */
  badge: 32,
  /** Floating action button. */
  fab: 64,
  fabRadius: 20,
  searchField: 58,
  searchRadius: 30,
  input: 56,
  button: 52,
  buttonSm: 44,
  buttonLg: 58,
  /** Tab bar content height, excluding the bottom safe-area inset. */
  tabBar: 76,
} as const;
