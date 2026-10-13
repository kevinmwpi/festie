import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ArtistMonogram } from './ArtistMonogram';
import { pastelFor } from './palette';
import { RemoteImage, useImageFallback } from './RemoteImage';

/**
 * Artist tile: the artist's licensed photo (`artists.image_url`, credited under Settings → Photo
 * credits) when there is one and it loads, otherwise the `ArtistMonogram`. Same size and radius props
 * as the monogram, and decorative like it (hidden from screen readers): the name is always next to it.
 * The monogram's pastel shows behind the photo while it loads.
 */
export function ArtistAvatar({
  name,
  colorKey,
  imageUrl,
  size = 112,
  radius = 32,
}: {
  name: string;
  colorKey?: string;
  imageUrl: string | null | undefined;
  size?: number;
  radius?: number;
}) {
  const { showImage, onError } = useImageFallback(imageUrl);
  if (!showImage || !imageUrl) {
    return <ArtistMonogram name={name} colorKey={colorKey} size={size} radius={radius} />;
  }

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      accessible={false}
      style={[styles.tile, { width: size, height: size, borderRadius: radius, backgroundColor: pastelFor(colorKey ?? name) }]}
    >
      <RemoteImage uri={imageUrl} onError={onError} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden' },
});
