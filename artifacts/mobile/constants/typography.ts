import type { TextStyle } from 'react-native';

/**
 * One family everywhere: Inter (loaded in app/_layout.tsx). Weight is chosen
 * by picking the face, never by `fontWeight` alone, so Android and iOS render
 * the same glyphs.
 */
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

function face(
  family: (typeof fontFamily)[keyof typeof fontFamily],
  fontSize: number,
  lineHeight: number,
  letterSpacing = 0,
): TextStyle {
  return { fontFamily: family, fontSize, lineHeight, letterSpacing };
}

/**
 * Type scale. Large headings run slightly tight; body text keeps normal
 * spacing. Sizes are in sp so they follow the user's font-scaling setting.
 */
export const font = {
  /** Screen-level brand/app title ("Avarpus"). */
  display: face(fontFamily.bold, 32, 38, -0.4),
  /** Titles of detail and sub-screens. */
  title: face(fontFamily.bold, 26, 32, -0.3),
  /** Section and card headings. */
  heading: face(fontFamily.semibold, 22, 28, -0.2),
  /** Primary line of a list row (chat name, customer name, repair title). */
  itemTitle: face(fontFamily.semibold, 20, 26),
  /** Running text, previews, descriptions. */
  body: face(fontFamily.regular, 17, 23),
  bodyStrong: face(fontFamily.semibold, 17, 23),
  /** Secondary metadata: timestamps, helper text. */
  caption: face(fontFamily.regular, 15, 20),
  captionStrong: face(fontFamily.medium, 15, 20),
  /** Form labels, navigation labels, chips. */
  label: face(fontFamily.medium, 16, 20),
  labelStrong: face(fontFamily.semibold, 16, 20),
  /** Buttons. */
  button: face(fontFamily.semibold, 17, 22),
  /** Counts inside notification badges. */
  badge: face(fontFamily.bold, 15, 18),
  /** Text inside inputs. */
  input: face(fontFamily.regular, 17, 22),
  /** Search fields. */
  search: face(fontFamily.regular, 18, 24),
  /** Fine print, legal, footnotes. */
  small: face(fontFamily.regular, 13, 18),
  smallStrong: face(fontFamily.semibold, 13, 18),
  /** Uppercase section eyebrow. */
  overline: { ...face(fontFamily.semibold, 13, 16, 0.6), textTransform: 'uppercase' as const },
} satisfies Record<string, TextStyle>;

export type FontToken = keyof typeof font;
