import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

export function useColors() {
  const scheme = useColorScheme();
  const palette =
    scheme === 'dark' && 'dark' in colors
      ? (colors as any).dark
      : colors.light;
  return {
    ...palette,
    radius: colors.radius,
    radiusSm: (colors as any).radiusSm,
    radiusLg: (colors as any).radiusLg,
    radiusXl: (colors as any).radiusXl,
  };
}
