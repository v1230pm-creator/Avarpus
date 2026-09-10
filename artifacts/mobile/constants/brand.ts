/**
 * Brand surface shared by the opening experience and the whole auth flow.
 *
 * One flat blue field runs from the native splash through every sign-in
 * screen, so nothing on this path may introduce its own background colour,
 * wallpaper, gradient, or translucent veil.
 *
 * Text and controls that sit on that blue are defined here as well. The surface
 * is deliberately deep enough for white body copy to remain readable outdoors;
 * screens on this path must use these tokens instead of app-theme greys.
 */

/** Text-bearing brand blue; white text is 5.6:1 and muted white stays >= 4.5:1. */
export const AVARPUS_BLUE = '#006DA8';

/** Deep brand ink, used for text on white controls sitting over the blue. */
export const AVARPUS_INK = '#02405F';

export const onBlue = {
  background: AVARPUS_BLUE,

  /** Headlines and anything that must read first. */
  text: '#FFFFFF',
  /** Body copy: high alpha keeps it legible on a saturated blue. */
  textSecondary: 'rgba(255, 255, 255, 0.92)',
  /** Supporting copy and labels. Never go below this alpha on blue. */
  textMuted: 'rgba(255, 255, 255, 0.88)',

  /** Hairlines and decorative rules. */
  line: 'rgba(255, 255, 255, 0.38)',
  /**
   * Input underlines and any line the user must be able to locate. A faint
   * hairline is not enough here: an empty field on this blue reads as no field
   * at all.
   */
  lineStrong: 'rgba(255, 255, 255, 0.85)',

  /** Dark glass keeps white input/content text above the contrast target. */
  surface: 'rgba(2, 40, 60, 0.18)',
  surfaceBorder: 'rgba(255, 255, 255, 0.70)',
  inputBackground: 'rgba(2, 40, 60, 0.24)',

  /** Message boxes use a dark veil so their text keeps real contrast. */
  noticeBackground: 'rgba(2, 38, 60, 0.42)',
  noticeBorder: 'rgba(255, 255, 255, 0.22)',
  info: '#DFF3FF',
  danger: '#FFD9DC',
  success: '#BFF7D8',

  /** Primary control: a white pill with deep ink, matching the CTA on blue. */
  controlBackground: '#FFFFFF',
  controlText: AVARPUS_INK,
  controlBackgroundDisabled: 'rgba(255, 255, 255, 0.78)',
  controlTextDisabled: AVARPUS_INK,
} as const;
