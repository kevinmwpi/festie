import { formatArtistCount } from '@festival/domain';
import { colors, continuous, elevation, radii, SecondaryButton, spacing, textStyles } from '@festival/ui';
import type { UnscheduledArtist } from '@festival/data-access';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ArtistAvatar } from './ArtistAvatar';

/**
 * Announcement mode: the festival has published who plays, but not when (`docs/festival-data.md`
 * §4.2). These pieces show the announced acts without pretending to know their set times, and never
 * offer an Add button: there is no set to pick yet.
 */

/**
 * Card at the top of the Lineup when no set has a time yet. Offers to follow the festival (the one
 * useful action months out: it keeps the festival at hand and feeds which festivals get maintained)
 * unless the user already follows it.
 */
export function LineupTbaNotice({
  count,
  follow,
}: {
  count: number;
  /** Omit when the festival is already followed or follow state is unknown. */
  follow?: { festivalName: string; busy: boolean; onPress: () => void };
}) {
  return (
    <View style={styles.notice} accessibilityRole="summary">
      <Text style={styles.noticeTitle} accessibilityRole="header">
        Set times aren’t out yet
      </Text>
      <Text style={styles.noticeBody}>
        {formatArtistCount(count)} announced so far. Set times show up here once they’re out, and you can add sets to your
        schedule from then on.
      </Text>
      {follow ? (
        <View style={styles.noticeAction}>
          <SecondaryButton label={`Follow ${follow.festivalName}`} onPress={follow.onPress} loading={follow.busy} />
        </View>
      ) : null}
    </View>
  );
}

/** Section title above the acts still waiting for a time, when other acts already have one. */
export function UnscheduledSectionHeader({ count }: { count: number }) {
  return (
    <Text style={styles.sectionTitle} accessibilityRole="header">
      {`Set times to be announced · ${count}`}
    </Text>
  );
}

/**
 * One line under a list of timed sets: acts without a time never match a day or stage filter
 * (`where: 'filters'`, Lineup tab) and are not offered on Add sets (`where: 'lineup'`).
 */
export function UnscheduledFootnote({ count, where }: { count: number; where: 'filters' | 'lineup' }) {
  const tail = where === 'filters' ? 'Clear the filters to see them.' : 'They’re listed on the Lineup tab.';
  return <Text style={styles.footnote}>{`${formatArtistCount(count)} ${count === 1 ? 'has' : 'have'} no set time yet. ${tail}`}</Text>;
}

/** An announced act without a set: photo or monogram, name, genre and "set time TBA". */
export function UnscheduledArtistCard({ artist }: { artist: UnscheduledArtist }) {
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${artist.name}${artist.genre ? `, ${artist.genre}` : ''}, set time to be announced`}
    >
      <ArtistAvatar name={artist.name} colorKey={artist.id} imageUrl={artist.image_url} size={64} radius={20} />
      <View style={styles.cardText}>
        <Text style={styles.artistName} numberOfLines={2}>
          {artist.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[artist.genre, 'Set time to be announced'].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    ...continuous,
    ...elevation.card,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    gap: spacing.xs,
    padding: spacing.xl,
  },
  noticeTitle: { ...textStyles.title3, color: colors.textPrimary },
  noticeBody: { ...textStyles.subheadline, color: colors.textSecondary },
  noticeAction: { alignItems: 'flex-start', marginTop: spacing.sm },
  // Section header: footnote 600 in textSecondary, sentence case (docs/design-system.md).
  sectionTitle: { ...textStyles.footnote, color: colors.textSecondary, fontWeight: '600', marginTop: spacing.sm },
  footnote: { ...textStyles.footnote, color: colors.textSecondary, paddingHorizontal: spacing.xs },
  card: {
    ...continuous,
    ...elevation.card,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  cardText: { flex: 1, gap: spacing.xxs },
  artistName: { ...textStyles.title3, color: colors.textPrimary },
  meta: { ...textStyles.caption1, color: colors.textSecondary, fontWeight: '600' },
});
