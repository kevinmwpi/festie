import { colors, continuous, elevation, iconRadius } from '@festival/ui';
import React from 'react';
import { Image, StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

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

/** Edge of the brand tile on the launch, sign-in and terms screens. */
const BRAND_TILE_SIZE = 80;

/**
 * The Festie mark on its pink app-icon-like tile (`colors.brand`, icon-proportion corners), as on the
 * launch, sign-in and terms screens. Decorative: hidden from screen readers.
 */
export function BrandTile({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.tile, style]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <BrandMark />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    ...continuous,
    ...elevation.card,
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: iconRadius(BRAND_TILE_SIZE),
    height: BRAND_TILE_SIZE,
    justifyContent: 'center',
    width: BRAND_TILE_SIZE,
  },
});
