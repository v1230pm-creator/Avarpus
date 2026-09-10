import type { ColorSchemeName, ImageSourcePropType } from 'react-native';

export const APP_BRAND = 'Avarpus';

export function getAvarpusLogo(_scheme: ColorSchemeName): ImageSourcePropType {
  return require('@/assets/images/avarpus-logo-circle.png');
}