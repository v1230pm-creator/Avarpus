import React from 'react';
import Svg, { Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';

export function BrandMark({ size = 96 }: { size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      accessibilityRole="image"
      accessibilityLabel="Avarpus"
    >
      <Defs>
        <LinearGradient id="brandGoldLeft" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFF0A8" />
          <Stop offset="0.45" stopColor="#E0AC42" />
          <Stop offset="1" stopColor="#9D681B" />
        </LinearGradient>
        <LinearGradient id="brandGoldRight" x1="0" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor="#FFF5C4" />
          <Stop offset="0.5" stopColor="#F2C96B" />
          <Stop offset="1" stopColor="#B57B24" />
        </LinearGradient>
      </Defs>
      <Polygon points="48,7 6,88 26,88 57,28" fill="url(#brandGoldLeft)" />
      <Polygon points="48,7 94,88 74,88 40,29" fill="url(#brandGoldRight)" />
      <Polygon points="28,72 67,50 77,66 38,88" fill="url(#brandGoldLeft)" />
    </Svg>
  );
}