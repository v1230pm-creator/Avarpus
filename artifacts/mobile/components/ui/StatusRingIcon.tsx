import React from 'react';
import Svg, { Circle } from 'react-native-svg';

const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
// The ring opens over a 70° arc centred on 1:30 o'clock to make room for the
// indicator dot; a closed ring reads as "nothing new".
const GAP_DEGREES = 70;
const GAP_CENTRE_DEGREES = -35;

interface StatusRingIconProps {
  size?: number;
  color: string;
  /**
   * When set, the ring opens at its top-right and this colour fills the gap
   * with a dot — the "new status" indicator. Omit for a closed ring.
   */
  indicatorColor?: string;
}

/**
 * Avarpus Status glyph: a ring with a solid core. Drawn on the same 24-unit
 * grid and 2-unit stroke as the Feather set so it sits at equal weight next to
 * the other navigation icons.
 */
export function StatusRingIcon({ size = 24, color, indicatorColor }: StatusRingIconProps) {
  const gapLength = (GAP_DEGREES / 360) * RING_CIRCUMFERENCE;
  const dashLength = RING_CIRCUMFERENCE - gapLength;
  const gapStart = GAP_CENTRE_DEGREES - GAP_DEGREES / 2;
  const dotAngle = (GAP_CENTRE_DEGREES * Math.PI) / 180;
  const dotX = 12 + RING_RADIUS * Math.cos(dotAngle);
  const dotY = 12 + RING_RADIUS * Math.sin(dotAngle);

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle
        cx={12}
        cy={12}
        r={RING_RADIUS}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
        {...(indicatorColor
          ? {
              strokeDasharray: `${dashLength} ${gapLength}`,
              // Dashes start at 3 o'clock; rotate so the gap starts where we want it.
              transform: `rotate(${gapStart + GAP_DEGREES} 12 12)`,
            }
          : {})}
      />
      <Circle cx={12} cy={12} r={3.4} fill={color} />
      {indicatorColor ? <Circle cx={dotX} cy={dotY} r={2.8} fill={indicatorColor} /> : null}
    </Svg>
  );
}
