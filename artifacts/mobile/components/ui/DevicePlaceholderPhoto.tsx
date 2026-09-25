import React from 'react';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { size } from '@/constants/spacing';

/**
 * Stand-in "photo" for a repair that has no uploads yet: a filled device
 * silhouette resting on a soft floor shadow, drawn on the list thumbnail's
 * 48×72 portrait grid so the photo column reads the same with or without a
 * real picture. The silhouette follows the intake device type; anything
 * unknown falls back to a phone.
 */
export function DevicePlaceholderPhoto({ deviceType, width = size.coverThumbWidth, height = size.coverThumbHeight }: {
  deviceType?: string | null;
  width?: number;
  height?: number;
}) {
  const colors = useColors();
  const body = colors.mutedForeground;
  const screen = colors.card;
  const floor = colors.border;
  return (
    <Svg width={width} height={height} viewBox="0 0 48 72" accessibilityRole="image" accessibilityLabel="No photo yet">
      <Ellipse cx={24} cy={60} rx={14} ry={2.5} fill={floor} />
      <Silhouette type={deviceType ?? ''} body={body} screen={screen} />
    </Svg>
  );
}

function Silhouette({ type, body, screen }: { type: string; body: string; screen: string }) {
  switch (type) {
    case 'Tablet':
      return (
        <>
          <Rect x={8} y={14} width={32} height={42} rx={4} fill={body} />
          <Rect x={10.5} y={18} width={27} height={34} rx={1.5} fill={screen} />
          <Circle cx={24} cy={16} r={0.8} fill={screen} />
        </>
      );
    case 'Laptop':
      return (
        <>
          <Rect x={8} y={20} width={32} height={22} rx={2} fill={body} />
          <Rect x={10} y={22} width={28} height={18} rx={1} fill={screen} />
          <Rect x={4} y={42} width={40} height={4.5} rx={1.75} fill={body} />
          <Rect x={19} y={43.4} width={10} height={1.4} rx={0.7} fill={screen} />
        </>
      );
    case 'Desktop':
      return (
        <>
          <Rect x={7} y={17} width={34} height={23} rx={2} fill={body} />
          <Rect x={9} y={19} width={30} height={19} rx={1} fill={screen} />
          <Rect x={21.5} y={40} width={5} height={7} fill={body} />
          <Rect x={14} y={47} width={20} height={3} rx={1.5} fill={body} />
        </>
      );
    case 'Smart Watch':
      return (
        <>
          <Rect x={18} y={9} width={12} height={54} rx={3} fill={body} fillOpacity={0.4} />
          <Rect x={12.5} y={24} width={23} height={24} rx={6.5} fill={body} />
          <Rect x={15} y={26.5} width={18} height={19} rx={4.5} fill={screen} />
          <Rect x={35.5} y={31} width={2} height={5} rx={1} fill={body} />
        </>
      );
    case 'Feature Phone':
      return (
        <>
          <Rect x={14} y={12} width={20} height={46} rx={4} fill={body} />
          <Rect x={16.5} y={16} width={15} height={14} rx={1.5} fill={screen} />
          <Path
            d="M18 34h3v2.6h-3zM22.5 34h3v2.6h-3zM27 34h3v2.6h-3zM18 38.6h3v2.6h-3zM22.5 38.6h3v2.6h-3zM27 38.6h3v2.6h-3zM18 43.2h3v2.6h-3zM22.5 43.2h3v2.6h-3zM27 43.2h3v2.6h-3zM18 47.8h3v2.6h-3zM22.5 47.8h3v2.6h-3zM27 47.8h3v2.6h-3z"
            fill={screen}
          />
        </>
      );
    default:
      // Smartphone, Other, legacy free-text types.
      return (
        <>
          <Rect x={13} y={11} width={22} height={46} rx={4.5} fill={body} />
          <Rect x={15.25} y={15.5} width={17.5} height={35} rx={1.75} fill={screen} />
          <Circle cx={24} cy={13.4} r={0.9} fill={screen} />
          <Rect x={20} y={53} width={8} height={1.3} rx={0.65} fill={screen} />
        </>
      );
  }
}
