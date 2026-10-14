import { describeSetChange, isCancelledSet, type SetChange, type SetChangeFields } from '@festival/domain';
import { Badge, colors, continuous, radii, spacing, textStyles } from '@festival/ui';
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

/**
 * Schedule changes (moved / cancelled sets, `sets.status`). Every set row shows the same chip and
 * detail line, and My Schedule lists the user's changed picks at the top.
 */

/** `Moved` (blue) or `Cancelled` (red) chip; nothing for a set that kept its slot. */
export function SetChangeBadge({ change }: { change: SetChange | null }) {
  if (!change?.label) {
    return null;
  }
  return <Badge label={change.label} tone={change.status === 'cancelled' ? 'danger' : 'info'} />;
}

/**
 * `Was Sat 11:00 PM · Moved to Sunday (weather)`; nothing when there is no detail to show. Wraps in
 * full by default: most screens have no other place to read the note.
 */
export function SetChangeDetail({
  change,
  style,
  numberOfLines,
}: {
  change: SetChange | null;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const text = setChangeDetailText(change);
  if (!text) {
    return null;
  }
  return (
    <Text
      style={[
        styles.detail,
        change?.status === 'cancelled' && styles.detailCancelled,
        change?.status === 'moved' && styles.detailMoved,
        style,
      ]}
      numberOfLines={numberOfLines}
    >
      {text}
    </Text>
  );
}

export function setChangeDetailText(change: SetChange | null): string | null {
  if (!change) {
    return null;
  }
  const parts = [change.previousTime ? `Was ${change.previousTime}` : null, change.note].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Style for names and times of a cancelled set (struck through, muted). */
export const cancelledTextStyle: TextStyle = { color: colors.textSecondary, textDecorationLine: 'line-through' };

interface ChangedPick extends SetChangeFields {
  id: string;
  artist_name: string;
}

/**
 * "2 of your picks changed" card listing each moved or cancelled pick. Notes on sets that kept
 * their slot are left out here (they show on the set itself). Tapping a pick calls `onSelect`.
 */
export function ScheduleChangesNotice<T extends ChangedPick>({
  picks,
  timeZone,
  onSelect,
}: {
  picks: readonly T[];
  timeZone: string;
  onSelect?: (pick: T) => void;
}) {
  const changed = React.useMemo(
    () =>
      picks
        .map((pick) => ({ pick, change: describeSetChange(pick, timeZone) }))
        .filter((entry): entry is { pick: T; change: SetChange } => Boolean(entry.change?.label)),
    [picks, timeZone],
  );
  if (changed.length === 0) {
    return null;
  }

  const cancelledCount = changed.filter((entry) => isCancelledSet(entry.pick)).length;
  const title =
    changed.length === 1
      ? '1 of your picks changed'
      : `${changed.length} of your picks changed${cancelledCount > 0 ? ` (${cancelledCount} cancelled)` : ''}`;

  return (
    <View style={styles.notice} accessibilityRole="summary">
      <Text style={styles.noticeTitle} accessibilityRole="header">
        {title}
      </Text>
      {changed.map(({ pick, change }) => {
        const detail = setChangeDetailText(change);
        const content = (
          <>
            <View style={styles.noticeRowTop}>
              <Text style={[styles.noticeArtist, change.status === 'cancelled' && cancelledTextStyle]} numberOfLines={1}>
                {pick.artist_name}
              </Text>
              <SetChangeBadge change={change} />
            </View>
            {detail ? (
              <Text style={styles.noticeDetail}>{detail}</Text>
            ) : null}
          </>
        );
        const label = `${pick.artist_name}. ${change.accessibilityLabel}`;
        return onSelect ? (
          <Pressable
            key={pick.id}
            onPress={() => onSelect(pick)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint="Shows the day of this set"
            style={({ pressed }) => [styles.noticeRow, pressed && styles.pressed]}
          >
            {content}
          </Pressable>
        ) : (
          <View key={pick.id} style={styles.noticeRow} accessible accessibilityLabel={label}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  detail: { ...textStyles.caption1, color: colors.textSecondary, fontWeight: '600' },
  detailMoved: { color: colors.link },
  detailCancelled: { color: colors.destructive },

  // Schedule changes use the amber warning family, like conflicts (docs/design-system.md).
  notice: {
    ...continuous,
    backgroundColor: colors.warningBg,
    borderRadius: radii.md,
    gap: spacing.xs,
    padding: spacing.md,
  },
  noticeTitle: { ...textStyles.subheadline, color: colors.warningText, fontWeight: '600', marginBottom: 2 },
  noticeRow: { gap: 2, minHeight: 44, justifyContent: 'center', paddingVertical: 4 },
  noticeRowTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  noticeArtist: { ...textStyles.subheadline, color: colors.textPrimary, flexShrink: 1, fontWeight: '600' },
  noticeDetail: { ...textStyles.caption1, color: colors.textSecondary },
  pressed: { opacity: 0.6 },
});
