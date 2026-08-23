import type { ColorSchemeName, ImageSourcePropType } from 'react-native';

export const APP_BRAND = 'Avarpus';

export function getAvarpusLogo(scheme: ColorSchemeName): ImageSourcePropType {
  return scheme === 'dark'
    ? require('@/assets/images/avarpus-logo-dark.png')
    : require('@/assets/images/avarpus-logo-light.png');
}