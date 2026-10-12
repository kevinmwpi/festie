import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

/**
 * The Festie mark: the app icon's tent with the F flag, on a transparent background, for the brand tiles
 * on the launch, sign-in and terms screens. Decorative; the tiles hide it from screen readers.
 */
export function BrandMark({ size = 52, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={require('../../assets/images/logo-mark.png')}
      style={[{ height: size, width: size }, style]}
      resizeMode="contain"
      accessible={false}
    />
  );
}
