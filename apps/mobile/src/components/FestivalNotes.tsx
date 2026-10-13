import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, textStyles } from '@festival/ui';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Required on festival detail / lineup screens (§5.5). */
export const FESTIVAL_DISCLAIMER =
  'Festie is an independent app and is not affiliated with or endorsed by any festival, organizer, or artist. Schedules can change — check official sources.';

/** "Times shown in festival local time (PDT)" / device-time variant, as a small clock-prefixed line. */
export function TimeZoneHint({ hint }: { hint: string }) {
  return (
    <View style={styles.hintRow} accessible accessibilityLabel={hint}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
      </View>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

export function FestivalDisclaimer() {
  return <Text style={styles.disclaimer}>{FESTIVAL_DISCLAIMER}</Text>;
}

const styles = StyleSheet.create({
  hintRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  hint: { ...textStyles.footnote, color: colors.textSecondary, flexShrink: 1, fontWeight: '600' },
  disclaimer: {
    ...textStyles.footnote,
    color: colors.textSecondary,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    textAlign: 'center',
  },
});
