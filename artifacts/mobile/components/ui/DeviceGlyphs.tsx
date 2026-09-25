import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';

interface GlyphProps {
  size?: number;
  color: string;
}

// All glyphs share Feather's 24-unit grid and 2-unit round stroke so they sit at
// equal weight beside the Feather icons of the intake form.
function strokeProps(color: string) {
  return { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const };
}

/** SIM card: cut top-right corner with the contact chip low in the body. */
export function SimCardIcon({ size = 20, color }: GlyphProps) {
  const s = strokeProps(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" {...s} />
      <Path d="M10 11h4a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-3A1.5 1.5 0 0 1 10 11z" {...s} />
      <Path d="M8.5 14h7" {...s} />
    </Svg>
  );
}

/** SD / memory card: cut top-left corner with the three contact stripes along the top. */
export function SdCardIcon({ size = 20, color }: GlyphProps) {
  const s = strokeProps(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7l4-4z" {...s} />
      <Path d="M10 6.5v3M13 6.5v3M16 6.5v3" {...s} />
    </Svg>
  );
}

/** Feature phone: candy-bar body, small screen, keypad dots. */
export function FeaturePhoneIcon({ size = 20, color }: GlyphProps) {
  const s = strokeProps(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 2h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" {...s} />
      <Path d="M10 5.5h4v4h-4z" {...s} />
      {[13.5, 16.5].map((cy) => [9.75, 12, 14.25].map((cx) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1} fill={color} />))}
    </Svg>
  );
}

/** Laptop: screen on a wider base. */
export function LaptopIcon({ size = 20, color }: GlyphProps) {
  const s = strokeProps(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 5h14a1 1 0 0 1 1 1v9H4V6a1 1 0 0 1 1-1z" {...s} />
      <Path d="M2 18.5h20" {...s} />
    </Svg>
  );
}

const FEATHER_DEVICE_ICONS: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  Smartphone: 'smartphone',
  Tablet: 'tablet',
  Desktop: 'monitor',
  'Smart Watch': 'watch',
};

/**
 * Glyph for one of the intake form's device types. Feather covers most; laptops and
 * feature phones are drawn here because the set has no glyph for them.
 */
export function DeviceTypeIcon({ type, size = 20, color }: GlyphProps & { type: string }) {
  if (type === 'Laptop') return <LaptopIcon size={size} color={color} />;
  if (type === 'Feature Phone') return <FeaturePhoneIcon size={size} color={color} />;
  return <Feather name={FEATHER_DEVICE_ICONS[type] ?? 'cpu'} size={size} color={color} />;
}
