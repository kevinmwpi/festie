import { colors, continuous, fontFamily, iconRadius } from '@festival/ui';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { initialsOf, pastelFor } from './palette';

/**
 * Artist tile: initials on a stable pastel, with the app-icon corner (`iconRadius(size)`) unless `radius`
 * is given. Festie shows no artist photos or artwork (factual schedule data only), so this replaces the
 * prototype's placeholder images.
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
  // SF Pro Rounded, like the titles beside the tile.
  initials: { color: colors.textPrimary, fontFamily: fontFamily.rounded, fontWeight: '700', opacity: 0.85 },
});
