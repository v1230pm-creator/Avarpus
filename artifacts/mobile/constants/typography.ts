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

/** A face always carries its metrics, so layouts can derive padding from `lineHeight`. */
type Face = Required<Pick<TextStyle, 'fontFamily' | 'fontSize' | 'lineHeight' | 'letterSpacing'>>;

function face(
  family: (typeof fontFamily)[keyof typeof fontFamily],
  fontSize: number,
  lineHeight: number,
  letterSpacing = 0,
): Face {
  return { fontFamily: family, fontSize, lineHeight, letterSpacing };
}

/**
 * Type scale. Large headings run slightly tight; body text keeps normal
 * spacing. Sizes are in sp so they follow the user's font-scaling setting.
 *
 * The scale matches the reference messenger inbox measured on a 360dp
 * screen: sizes were derived from measured cap heights of Inter (0.727em),
 * which is why two of them are fractional.
 */
export const font = {
  /** Screen-level brand/app title ("Avarpus"). */
  display: face(fontFamily.bold, 25, 32, -0.3),
  /** Titles of detail and sub-screens. */
  title: face(fontFamily.bold, 22, 28, -0.2),
  /** Section and card headings. */
  heading: face(fontFamily.semibold, 18, 24, -0.1),
  /** Primary line of a list row (chat name, customer name, repair title). */
  itemTitle: face(fontFamily.semibold, 16.5, 22),
  /** Running text, previews, descriptions. */
  body: face(fontFamily.regular, 14, 19),
  bodyStrong: face(fontFamily.semibold, 14, 19),
  /** Secondary metadata: timestamps, helper text. */
  caption: face(fontFamily.regular, 13, 18),
  captionStrong: face(fontFamily.medium, 13, 18),
  /** Form labels, navigation labels, chips. */
  label: face(fontFamily.medium, 14, 18),
  labelStrong: face(fontFamily.semibold, 14, 18),
  /** Shop workspace footer labels: a step below the main footer's 14sp, lightly tracked, so the longer tool names sit quietly under their glyphs. */
  workspaceTab: face(fontFamily.medium, 12, 16, 0.2),
  workspaceTabStrong: face(fontFamily.semibold, 12, 16, 0.2),
  /** Buttons. */
  button: face(fontFamily.semibold, 15, 20),
  /** Counts inside notification badges. */
  badge: face(fontFamily.bold, 12, 15),
  /** Text inside inputs. */
  input: face(fontFamily.regular, 15, 20),
  /** Body of a chat message bubble. */
  message: face(fontFamily.regular, 15, 20),
  /** Search fields. */
  search: face(fontFamily.regular, 16.5, 22),
  /** Fine print, legal, footnotes. */
  small: face(fontFamily.regular, 12, 16),
  smallStrong: face(fontFamily.semibold, 12, 16),
  /** Tag strip over a small thumbnail (photo kind). */
  tag: face(fontFamily.semibold, 10, 12, 0.2),
  /** Uppercase section eyebrow. */
  overline: { ...face(fontFamily.semibold, 11, 14, 0.6), textTransform: 'uppercase' as const },
} satisfies Record<string, TextStyle>;

export type FontToken = keyof typeof font;
