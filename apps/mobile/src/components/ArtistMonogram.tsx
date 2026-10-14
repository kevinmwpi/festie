import { colors, continuous, fontFamily, iconRadius } from '@festival/ui';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { initialsOf, pastelFor } from './palette';

/**
 * Artist tile: initials on a stable pastel, with the app-icon corner (`iconRadius(size)`) unless `radius`
 * is given. Shown for every artist without a licensed photo, and by `ArtistAvatar` whenever a photo is
 * missing or fails to load; it replaces the prototype's placeholder images.
 */
export function ArtistMonogram({ name, colorKey, size = 112, radius }: { name: string; colorKey?: string; size?: number; radius?: number }) {
  return (
    <View
      // Decorative: hidden from VoiceOver (accessibilityElementsHidden) and TalkBack (importantForAccessibility).
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      accessible={false}
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: radius ?? iconRadius(size), backgroundColor: pastelFor(colorKey ?? name) },
      ]}
    >
      {/* A glyph in a fixed decorative tile: sized to the tile (like the profile avatar's initials), not
          to the user's text size, so it never overflows the tile. */}
      <Text allowFontScaling={false} style={[styles.initials, { fontSize: Math.round(size * 0.32) }]}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { ...continuous, alignItems: 'center', justifyContent: 'center' },
  // Bold italic Georgia, like the artist name beside the tile.
  initials: { color: colors.textPrimary, fontFamily: fontFamily.display, fontStyle: 'italic', fontWeight: '700', opacity: 0.85 },
});
