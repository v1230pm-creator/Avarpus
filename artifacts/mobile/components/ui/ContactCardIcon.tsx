import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface ContactCardIconProps {
  size?: number;
  color: string;
}

/**
 * Contact card: an address-book page — binder ticks on the spine, a person
 * bust on the page. Drawn on Feather's 24-unit grid with its 2-unit round
 * stroke so it matches the Feather glyphs it sits beside.
 */
export function ContactCardIcon({ size = 24, color }: ContactCardIconProps) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" {...stroke} />
      <Circle cx="13" cy="10" r="2.5" {...stroke} />
      <Path d="M8.5 17.5c.7-2.2 2.4-3.3 4.5-3.3s3.8 1.1 4.5 3.3" {...stroke} />
      <Path d="M3 8h2M3 12h2M3 16h2" {...stroke} />
    </Svg>
  );
}
