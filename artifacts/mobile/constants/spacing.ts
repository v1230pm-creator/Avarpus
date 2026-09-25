/**
 * Spacing, radius and control sizes shared by every screen. Values are dp;
 * layouts must compose them with flex, never with absolute screen coordinates.
 *
 * The scale follows the reference messenger inbox measured on a 360dp-wide
 * screen (the Chats tab was matched to it first, then the rest of the app was
 * brought onto the same scale): 56dp app bar, 47dp pill search field, 78dp
 * conversation rows with 50dp photos, 56dp floating button.
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
  /** Horizontal inset of screen content (forms, cards, running text) from the display edge. */
  screenPadding: 16,
  /** Left inset of list rows; the app bar title, the search field and row photos line up on it. */
  listInset: 12,
  /** Right inset of a row's trailing column (timestamps, badges) and of floating buttons. */
  listInsetEnd: 18,
  /** Left inset of a screen title inside the app bar. */
  titleInset: 18,
  /** Height of a screen's app bar (title + actions), excluding the status bar. */
  headerHeight: 56,
  /** Gap between a row's avatar and its text block. */
  avatarGap: 14,
  /** Vertical padding of a list row: 14 + 50dp photo + 14 = 78dp per row. */
  rowPaddingVertical: 14,
  /** Gap between a row's primary line and its secondary line. */
  rowLineGap: 4,
  /** Space between the app bar and the search field or content below it. */
  headerGap: 4,
  /** Space between a search field and the first row under it. */
  searchGap: 18,
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
  avatar: 50,
  avatarSm: 40,
  /** Bottom navigation icon (main and Shop workspace footers alike). */
  navIcon: 24,
  /** Header / toolbar icon glyph, and leading icons of settings-style rows. */
  headerIcon: 24,
  /** Inline icon next to row or field text (pin, mute, chevron). */
  inlineIcon: 16,
  /** Small inline glyph inside a secondary text line (preview kind icons). */
  inlineIconSm: 14,
  /** Tap target for icon-only buttons. */
  iconButton: 44,
  /** Unread-count badge in lists. */
  badge: 20,
  /** Check drawn over a selected row photo. */
  selectionMark: 20,
  /** Filter / choice chip. */
  chip: 32,
  /** Tinted square behind the glyph of a summary tile, and that glyph. */
  statBox: 32,
  statIcon: 18,
  /** Tinted disc in front of a compact (eyebrow-sized) card heading, and its glyph. */
  eyebrowMark: 20,
  eyebrowIcon: 12,
  /** Intake photo thumbnail, and the empty slot that stands in for one. */
  photoThumb: 56,
  /** Portrait cover photo of a repair list row (same proportion as the detail screen's device tile). */
  coverThumbWidth: 48,
  coverThumbHeight: 72,
  /** Lone glyph inside a 44dp chip (the camera of the add-image chip). */
  fieldGlyph: 20,
  /** In-app camera shutter: the outer ring and the white disc inside it. */
  shutter: 72,
  shutterDot: 56,
  /** SIM / SD card glyph in front of the presence toggle's word; a step larger so the card shape reads at a glance. */
  presenceGlyph: 24,
  /** Checkbox of a stand-alone toggle (SIM / Memory present), and the tick drawn in it: large enough to read as the control it is. */
  checkbox: 20,
  checkMark: 14,
  /** Checkbox / radio box inside compact toggles and dense choice lists, and the tick drawn in it. */
  checkboxSm: 14,
  checkMarkSm: 10,
  /** Row of a dense choice list (drop-down checklists); menu density, below the 44dp button minimum on purpose. */
  denseRow: 36,
  /** Floating action button. */
  fab: 56,
  fabRadius: 16,
  fabIcon: 24,
  /** Compact icon-only floating button (Khata's add-customer), and its glyph; 48dp keeps the 44dp touch minimum. */
  fabSm: 48,
  fabIconSm: 20,
  /** Search field height; it is a full pill. */
  searchField: 47,
  searchRadius: radius.pill,
  /** Inset of the magnifier inside the field (its 24dp box has 3dp of inner padding). */
  searchPadding: 14,
  /** Gap between the magnifier's box and the search text. */
  searchGap: 19,
  input: 48,
  /** Dense form field (compact cards such as customer contact); keeps the 44dp touch minimum. */
  inputSm: 44,
  button: 48,
  /** Small buttons and form choice options keep the 44dp touch minimum. */
  buttonSm: 44,
  buttonLg: 52,
  /** Tab bar content height, excluding the bottom safe-area inset. */
  tabBar: 80,
} as const;

/**
 * One-hand reach: holding a finger still anywhere on a screen, then dragging,
 * moves the whole page — app bar included — with the finger; it stays where it
 * is let go. Times are ms, distances dp.
 */
export const reach = {
  /** How long a still finger rests before it has hold of the page (Android's own long press is 400ms). */
  hold: 450,
  /** Finger travel during the hold that makes the touch a scroll or a swipe instead (Android's touch slop is 8dp). */
  slop: 10,
  /** Height of the page's top strip that always stays on screen; the page cannot be pushed further down than that. */
  keep: 120,
} as const;

/**
 * Extra touch area for controls whose visible box is under 44dp, so the tap
 * target meets the platform minimum without changing how the control looks.
 */
export const hitSlop = {
  /** 32dp chip → 44dp target. Vertical only: neighbouring chips sit 8dp apart. */
  chip: { top: (size.iconButton - size.chip) / 2, bottom: (size.iconButton - size.chip) / 2 },
  /** 16dp remove disc in the top-right corner of a clipped 56dp thumbnail → ~32dp target that stays inside the thumbnail. */
  thumbCorner: { top: space.xs, right: space.xs, bottom: space.md, left: space.md },
} as const;
