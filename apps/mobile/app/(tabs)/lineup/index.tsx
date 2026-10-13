import { describeLineupAvailability, describeSetChange, detectConflict, festivalDayKey, listFestivalDays } from '@festival/domain';
import type { UnscheduledArtist } from '@festival/data-access';
import {
  Badge,
  Chip,
  colors,
  continuous,
  deriveAccentColors,
  elevation,
  EmptyState,
  iconRadius,
  layout,
  motion,
  PressableScale,
  radii,
  spacing,
  tabularNums,
  textStyles,
  useOfflineStatus,
} from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ArtistAvatar } from '@/src/components/ArtistAvatar';
import { FestivalDisclaimer, TimeZoneHint } from '@/src/components/FestivalNotes';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { cancelledTextStyle, SetChangeBadge, SetChangeDetail } from '@/src/components/SetChange';
import { FestivalBundleState, LoadingState, NoFestivalState, StaleDataNote } from '@/src/components/StateViews';
import {
  LineupTbaNotice,
  UnscheduledArtistCard,
  UnscheduledFootnote,
  UnscheduledSectionHeader,
} from '@/src/components/UnscheduledLineup';
import { formatWeekdayDayLabel } from '@/src/hooks/festival-time-labels';
import { useFestivalClock, type FestivalClock } from '@/src/hooks/use-festival';
import { useFollowFestivals } from '@/src/hooks/use-follow-festival';
import { useLineup, type LineupRow } from '@/src/hooks/use-lineup';
import { useSetSelection } from '@/src/hooks/use-set-selection';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

const ALL = 'all';
const NO_ROWS: LineupRow[] = [];
const NO_ARTISTS: UnscheduledArtist[] = [];

/** Edge of the artist tile (photo or monogram) beside the text, and above it when the text is large. */
const MONOGRAM_SIZE = 112;
const MONOGRAM_SIZE_STACKED = 80;
/** The add button: a 44pt target with a white cut-out ring, overhanging the tile's corner. */
const ADD_BUTTON_SIZE = layout.minTouchTarget;
const ADD_BUTTON_RING = 4;
const ADD_BUTTON_OVERHANG = spacing.sm;
/**
 * From the xxxLarge text size up (iOS `fontScale` 1.35 and the accessibility sizes) the tile moves
 * above the text: beside the 112pt tile the artist name would get only a few characters per line.
 */
const STACK_FONT_SCALE = 1.3;

/* ─── Artist Card ─────────────────────────────────────────── */

function ArtistCard({
  row,
  clock,
  overlapsPick,
  busy,
  stacked,
  onToggle,
}: {
  row: LineupRow;
  clock: FestivalClock;
  overlapsPick: boolean;
  busy: boolean;
  stacked: boolean;
  onToggle: () => void;
}) {
  const isSelected = Boolean(row.selection_id);
  const timeRange = clock.range(row.start_time, row.end_time);
  const day = clock.day(row.start_time);
  const showConflict = Boolean(row.is_conflicting);
  const showOverlap = !isSelected && overlapsPick;
  const showPending = isSelected && row.selection_pending === 1;
  // Schedule changes (moved / cancelled sets): a chip, a detail line, and a struck-through name and time.
  const change = describeSetChange(row, clock.timeZone);
  const cancelled = change?.status === 'cancelled';
  // A cancelled set can still be removed from the schedule, but not added.
  const canToggle = isSelected || !cancelled;
  const changeSuffix = change ? `. ${change.accessibilityLabel}` : '';

  // VoiceOver reads the set as one element (who, where, when, any schedule change, status) and then
  // reaches its add button.
  const summary = [
    row.artist_name,
    row.stage_name,
    `${day}, ${timeRange}`,
    change?.accessibilityLabel ?? null,
    showConflict ? 'Conflict' : null,
    showOverlap ? 'Overlaps a pick' : null,
    showPending ? 'Waiting to sync' : null,
    isSelected ? 'In your schedule' : null,
  ]
    .filter(Boolean)
    .join(', ');

  const monogramSize = stacked ? MONOGRAM_SIZE_STACKED : MONOGRAM_SIZE;
  // The tile is the first child, at the card content's origin in both layouts: this puts the add
  // button on its bottom-right corner, overhanging it.
  const addButtonOffset = monogramSize - ADD_BUTTON_SIZE + ADD_BUTTON_OVERHANG;

  // Screen reader order: the set, then its add button. The summary element wraps the (hidden) tile as
  // well as the text, so its frame starts at the content's top-left corner, above and before the button.
  // VoiceOver orders elements by position, so a summary that started below the button (the stacked
  // layout) would be read after it. The button is rendered after the summary for TalkBack, which follows
  // the view order. The button stays a sibling: inside an accessible View it could not be focused.
  return (
    <View style={styles.artistCard}>
      {/* Positioning box for the add button: its origin is the summary's, so the tile's. */}
      <View>
        <View style={stacked ? styles.summaryStacked : styles.summaryRow} accessible accessibilityLabel={summary}>
          {/* The licensed photo when there is one, else the monogram; both with the app-icon corner. */}
          <ArtistAvatar
            name={row.artist_name}
            colorKey={row.artist_id}
            imageUrl={row.artist_image_url}
            size={monogramSize}
            radius={iconRadius(monogramSize)}
          />

          <View style={[styles.artistContent, !stacked && styles.artistContentRow]}>
            <View style={styles.stagePill}>
              <Text style={styles.stagePillText} numberOfLines={2}>
                {row.stage_name}
              </Text>
            </View>

            <View style={styles.nameRow}>
              <Text style={[styles.artistName, cancelled && cancelledTextStyle]}>{row.artist_name}</Text>
              {isSelected ? (
                <Ionicons name="heart" size={20} color={colors.textPrimary} accessibilityLabel="In your schedule" style={styles.heart} />
              ) : null}
            </View>

            <View style={styles.badgeRow}>
              <SetChangeBadge change={change} />
              {showConflict ? <Badge label="Conflict" tone="warning" /> : null}
              {showOverlap ? <Badge label="Overlaps a pick" tone="neutral" /> : null}
              {showPending ? <Badge label="Waiting to sync" tone="neutral" /> : null}
            </View>

            <Text style={[styles.artistTime, cancelled && cancelledTextStyle]}>{`${day} · ${timeRange}`}</Text>
            <SetChangeDetail change={change} />
          </View>
        </View>

        {canToggle ? (
          <PressableScale
            onPress={onToggle}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`${isSelected ? `Remove ${row.artist_name} from my schedule` : `Add ${row.artist_name} to my schedule`}${changeSuffix}`}
            accessibilityState={{ selected: isSelected, busy }}
            hitSlop={4}
            pressedScale={motion.pressedScaleSmall}
            style={[
              styles.addButton,
              { left: addButtonOffset, top: addButtonOffset },
              isSelected ? styles.addButtonSelected : styles.addButtonDefault,
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Ionicons name={isSelected ? 'checkmark' : 'add'} size={18} color={colors.textPrimary} />
            )}
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

/* ─── Screen ──────────────────────────────────────────────── */

export default function LineupScreen() {
  const tabBarClearance = useTabBarClearance();
  const stackCards = useWindowDimensions().fontScale > STACK_FONT_SCALE;
  const festivalId = useAppStore((s) => s.activeFestivalId);
  const activeFestivalAccent = useAppStore((s) => s.activeFestivalAccent);
  const screenBg = deriveAccentColors(activeFestivalAccent).bgTint;
  useSafeAreaEdgeTint(screenBg);
  const isOffline = useOfflineStatus();

  const { bundle, lineup, unscheduled, festival } = useLineup(festivalId);
  const clock = useFestivalClock(festival);
  const { toggle, busyIds } = useSetSelection(festival);
  const follows = useFollowFestivals({ reapplyDefault: false });

  const [dayFilter, setDayFilter] = React.useState<string>(ALL);
  const [stageFilter, setStageFilter] = React.useState<string>(ALL);

  React.useEffect(() => {
    setDayFilter(ALL);
    setStageFilter(ALL);
  }, [festivalId]);

  const rows = React.useDeferredValue(lineup.data ?? NO_ROWS);
  // Announced acts without a set yet (announcement mode, festival-data.md §4.2).
  const tbaArtists = unscheduled.data ?? NO_ARTISTS;
  const availability = describeLineupAvailability({ setCount: rows.length, unscheduledCount: tbaArtists.length });
  const filtersActive = dayFilter !== ALL || stageFilter !== ALL;
  const timeZone = festival?.timezone ?? '';

  const days = React.useMemo(() => (festival ? listFestivalDays(festival, rows) : []), [festival, rows]);
  const dayKeyById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      try {
        map.set(row.id, festivalDayKey(row.start_time, timeZone));
      } catch {
        // Malformed timestamp: the set only shows under "All".
      }
    }
    return map;
  }, [rows, timeZone]);

  const stages = React.useMemo(() => {
    const names = (bundle.data?.stages ?? []).map((stage) => stage.name);
    return [...new Set(names)].sort((left, right) => left.localeCompare(right));
  }, [bundle.data]);

  const selectedRows = React.useMemo(() => rows.filter((row) => row.selection_id), [rows]);

  const filtered = React.useMemo(
    () =>
      rows.filter((row) => {
        if (dayFilter !== ALL && dayKeyById.get(row.id) !== dayFilter) return false;
        if (stageFilter !== ALL && row.stage_name !== stageFilter) return false;
        return true;
      }),
    [dayFilter, dayKeyById, rows, stageFilter],
  );

  const overlapIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (selectedRows.length === 0) {
      return ids;
    }
    for (const row of filtered) {
      if (!row.selection_id && selectedRows.some((picked) => detectConflict(row, picked))) {
        ids.add(row.id);
      }
    }
    return ids;
  }, [filtered, selectedRows]);

  const handleRefresh = React.useCallback(async () => {
    await Promise.all([bundle.refetch(), lineup.refetch()]);
  }, [bundle, lineup]);

  const header = <ScreenHeader crumbs={['Browse lineup', festival?.name]} />;

  if (!festivalId) {
    return (
      <View style={[styles.container, { backgroundColor: screenBg }]}>
        {header}
        <View style={styles.statePad}>
          <NoFestivalState onPick={() => router.navigate('/(tabs)/festivals')} />
        </View>
      </View>
    );
  }

  const bundleState = (
    <FestivalBundleState
      hasBundle={Boolean(bundle.data)}
      isLoading={bundle.isLoading}
      isRefreshing={bundle.isRefreshing}
      hasRefreshed={bundle.hasRefreshed}
      refreshError={bundle.refreshError}
      isOffline={isOffline}
      onRetry={() => void bundle.refetch()}
    />
  );

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      {header}

      {/* Day and stage filters only make sense once at least one set has a time. */}
      {festival && rows.length > 0 ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={styles.filterRow}>
            {[ALL, ...days].map((day) => {
              const active = dayFilter === day;
              const label = day === ALL ? 'All' : formatWeekdayDayLabel(day, clock.timeZone);
              const a11y = day === ALL ? 'All days' : clock.date(day, { weekday: 'long', month: 'long', day: 'numeric' });
              return (
                <Chip
                  key={day}
                  variant="ink"
                  label={label}
                  accessibilityLabel={a11y}
                  active={active}
                  onPress={() => setDayFilter(day)}
                />
              );
            })}
          </ScrollView>

          {stages.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={styles.filterRow}>
              {[ALL, ...stages].map((stage) => (
                <Chip
                  key={stage}
                  accentColor={activeFestivalAccent}
                  active={stageFilter === stage}
                  onPress={() => setStageFilter(stage)}
                  label={stage === ALL ? 'All stages' : stage}
                />
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={(bundle.isRefreshing || lineup.isRefreshing) && Boolean(bundle.data)}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.textPrimary}
          />
        }
      >
        {bundleState}

        {festival ? (
          <>
            {rows.length > 0 ? <TimeZoneHint hint={clock.hint} /> : null}
            {lineup.isLoading || unscheduled.isLoading ? (
              <LoadingState label="Loading the lineup…" />
            ) : availability === 'empty' ? (
              <EmptyState
                title="Lineup coming soon"
                description="Artists and sets will appear here once the festival announces them."
              />
            ) : availability === 'tba' ? (
              <>
                <LineupTbaNotice
                  count={tbaArtists.length}
                  follow={
                    follows.following.data && !follows.followingIds.has(festival.id)
                      ? { festivalName: festival.name, busy: follows.busyId === festival.id, onPress: () => void follows.toggle(festival) }
                      : undefined
                  }
                />
                {tbaArtists.map((artist) => (
                  <UnscheduledArtistCard key={artist.id} artist={artist} />
                ))}
              </>
            ) : (
              <>
                {filtered.length === 0 ? (
                  <EmptyState title="No sets match" description="Try another day or stage." />
                ) : (
                  filtered.map((row) => (
                    <ArtistCard
                      key={row.id}
                      row={row}
                      clock={clock}
                      overlapsPick={overlapIds.has(row.id)}
                      busy={busyIds.has(row.id)}
                      stacked={stackCards}
                      onToggle={() => void toggle(row)}
                    />
                  ))
                )}
                {availability === 'partial' && !filtersActive ? (
                  <>
                    <UnscheduledSectionHeader count={tbaArtists.length} />
                    {tbaArtists.map((artist) => (
                      <UnscheduledArtistCard key={artist.id} artist={artist} />
                    ))}
                  </>
                ) : null}
                {availability === 'partial' && filtersActive ? <UnscheduledFootnote count={tbaArtists.length} where="filters" /> : null}
              </>
            )}
            <StaleDataNote error={bundle.refreshError ?? lineup.refreshError} />
          </>
        ) : null}

        <FestivalDisclaimer />
      </ScrollView>
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────── */

const styles = StyleSheet.create({
  // React Native gives horizontal ScrollViews flexGrow/flexShrink 1; in a flex column they would take
  // a share of the free height away from the list below.
  chipScroller: { flexGrow: 0 },
  container: { flex: 1 },
  statePad: { padding: layout.screenGutter },

  /*
   * Filter rows: the day picker uses ink chips (the screen's primary selector), the stage row accent
   * chips. The vertical padding keeps the chips' 44pt hit slop inside the horizontal ScrollView.
   */
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: spacing.xs,
  },

  scroll: { flex: 1 },
  scrollContent: { gap: spacing.md, paddingHorizontal: layout.screenGutter, paddingTop: spacing.lg },

  /* Artist card: white, `card` radius, the tile beside (or above) the set's details. */
  artistCard: {
    ...continuous,
    ...elevation.card,
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    padding: layout.cardPadding,
  },
  summaryRow: { flexDirection: 'row', gap: spacing.xl },
  summaryStacked: { gap: spacing.md },

  /* Add button: a 44pt soft square with a white cut-out ring, on the tile's corner. */
  addButton: {
    ...continuous,
    ...elevation.raised,
    alignItems: 'center',
    borderColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: ADD_BUTTON_RING,
    height: ADD_BUTTON_SIZE,
    justifyContent: 'center',
    position: 'absolute',
    width: ADD_BUTTON_SIZE,
  },
  addButtonDefault: { backgroundColor: colors.primary },
  addButtonSelected: { backgroundColor: colors.success },

  artistContent: { gap: spacing.xs, justifyContent: 'center' },
  artistContentRow: { flex: 1 },
  /* Stage pill: the stage name as entered, in link blue on the pale-blue tag fill. */
  stagePill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.inputBg,
    borderRadius: radii.pill,
    marginBottom: spacing.xs,
    maxWidth: '100%',
    paddingHorizontal: spacing.ms,
    paddingVertical: spacing.xs,
  },
  stagePillText: { ...textStyles.footnote, color: colors.link, fontWeight: '600' },
  nameRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.xs },
  artistName: { ...textStyles.title3, color: colors.textPrimary, flex: 1 },
  // Optical: centres the 20pt heart on the name's first line (title3 line height 25).
  heart: { marginTop: spacing.xxs },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  artistTime: { ...textStyles.footnote, ...tabularNums, color: colors.textSecondary, fontWeight: '600' },
});
