import { formatArtistCount } from '@festival/domain';
import { colors, HEADING_FONT, radii, SecondaryButton, spacing } from '@festival/ui';
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
          <SecondaryButton label={`Follow ${follow.festivalName}`} onPress={follow.onPress} disabled={follow.busy} />
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
          {[artist.genre, 'Set time TBA'].filter(Boolean).join(' · ').toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.xl,
  },
  noticeTitle: {
    color: colors.textPrimary,
    fontFamily: HEADING_FONT,
    fontStyle: 'italic',
    fontSize: 20,
    fontWeight: '700',
  },
  noticeBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  noticeAction: { alignItems: 'flex-start', marginTop: spacing.sm },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },
  footnote: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, paddingHorizontal: spacing.xs },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  cardText: { flex: 1, gap: 4 },
  artistName: {
    color: colors.textPrimary,
    fontFamily: HEADING_FONT,
    fontStyle: 'italic',
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 23,
  },
  meta: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
});
