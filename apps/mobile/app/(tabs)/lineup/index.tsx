import { describeLineupAvailability, describeSetChange, detectConflict, festivalDayKey, listFestivalDays } from '@festival/domain';
import type { UnscheduledArtist } from '@festival/data-access';
import {
  Badge,
  Chip,
  colors,
  deriveAccentColors,
  EmptyState,
  layout,
  radii,
  spacing,
  useOfflineStatus,
} from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

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

/* ─── Artist Card ─────────────────────────────────────────── */

function ArtistCard({
  row,
  clock,
  overlapsPick,
  busy,
  onToggle,
}: {
  row: LineupRow;
  clock: FestivalClock;
  overlapsPick: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const isSelected = Boolean(row.selection_id);
  const timeRange = clock.range(row.start_time, row.end_time);
  const day = clock.day(row.start_time);
  const change = describeSetChange(row, clock.timeZone);
  const cancelled = change?.status === 'cancelled';
  // A cancelled set can still be removed from the schedule, but not added.
  const canToggle = isSelected || !cancelled;
  const changeSuffix = change ? `. ${change.accessibilityLabel}` : '';

  return (
    <View style={styles.artistCard}>
      <View style={styles.cardInner}>
        <View style={styles.imageWrap}>
          <ArtistAvatar name={row.artist_name} colorKey={row.artist_id} imageUrl={row.artist_image_url} />
          {canToggle ? (
            <Pressable
              onPress={onToggle}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`${isSelected ? `Remove ${row.artist_name} from my schedule` : `Add ${row.artist_name} to my schedule`}${changeSuffix}`}
              accessibilityState={{ selected: isSelected, busy }}
              hitSlop={4}
              style={({ pressed }) => [
                styles.addButton,
                isSelected ? styles.addButtonSelected : styles.addButtonDefault,
                pressed && { transform: [{ scale: 0.88 }] },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <Ionicons name={isSelected ? 'checkmark' : 'add'} size={18} color={colors.textPrimary} />
              )}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.artistContent}>
          <View style={styles.stagePill}>
            <Text style={styles.stagePillText} numberOfLines={1}>
              {row.stage_name}
            </Text>
          </View>

          <View style={styles.nameRow}>
            <Text style={[styles.artistName, cancelled && cancelledTextStyle]} numberOfLines={2}>
              {row.artist_name}
            </Text>
            {isSelected ? (
              <Ionicons name="heart" size={20} color={colors.textPrimary} accessibilityLabel="In your schedule" />
            ) : null}
          </View>

          <View style={styles.badgeRow}>
            <SetChangeBadge change={change} />
            {row.is_conflicting ? <Badge label="Conflict" tone="warning" /> : null}
            {!isSelected && overlapsPick ? <Badge label="Overlaps a pick" tone="neutral" /> : null}
            {isSelected && row.selection_pending === 1 ? <Badge label="Waiting to sync" tone="neutral" /> : null}
          </View>

          <Text style={[styles.artistTime, cancelled && cancelledTextStyle]}>{`${day} · ${timeRange}`.toUpperCase()}</Text>
          <SetChangeDetail change={change} />
        </View>
      </View>
    </View>
  );
}

/* ─── Screen ──────────────────────────────────────────────── */

export default function LineupScreen() {
  const tabBarClearance = useTabBarClearance();
  const festivalId = useAppStore((s) => s.activeFestivalId);
  const activeFestivalAccent = useAppStore((s) => s.activeFestivalAccent);
  const screenBg = deriveAccentColors(activeFestivalAccent).bgTint;
  useSafeAreaEdgeTint(screenBg);
  const isOffline = useOfflineStatus();

  const { bundle, lineup, unscheduled, festival } = useLineup(festivalId);
  const clock = useFestivalClock(festival);
  const { toggle, busyIds } = useSetSelection(festival);
  const follows = useFollowFestivals();

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

  const header = <ScreenHeader crumbs={['Browse Lineup', festival?.name]} />;

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

      {festival && rows.length > 0 ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={styles.filterRow}>
            {[ALL, ...days].map((day) => {
              const active = dayFilter === day;
              const label = day === ALL ? 'All' : formatWeekdayDayLabel(day, clock.timeZone);
              const a11y = day === ALL ? 'All days' : clock.date(day, { weekday: 'long', month: 'long', day: 'numeric' });
              return (
                <Pressable
                  key={day}
                  onPress={() => setDayFilter(day)}
                  accessibilityRole="button"
                  accessibilityLabel={a11y}
                  accessibilityState={{ selected: active }}
                  style={[styles.dayPill, active && styles.dayPillActive]}
                >
                  <Text style={[styles.dayPillLabel, active && styles.dayPillLabelActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {stages.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={styles.filterRow}>
              {[ALL, ...stages].map((stage) => (
                <Chip
                  key={stage}
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
  statePad: { padding: spacing.lg },

  /* Day pills — dark = active, white = inactive */
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  dayPill: {
    borderRadius: radii.pill,
    justifyContent: 'center',
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  dayPillActive: {
    backgroundColor: colors.textPrimary,
  },
  dayPillLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dayPillLabelActive: {
    color: '#FFFFFF',
  },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.md },

  /* Artist card — white, 40px radius */
  artistCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  cardInner: { flexDirection: 'row', gap: spacing.xl },

  imageWrap: { position: 'relative', flexShrink: 0 },
  /* Add button — 44×44, white border, floats on the tile corner */
  addButton: {
    position: 'absolute',
    bottom: -8,
    right: -8,
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  addButtonDefault: { backgroundColor: colors.primary },
  addButtonSelected: { backgroundColor: colors.success },

  artistContent: { flex: 1, gap: 4, justifyContent: 'center' },
  stagePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F0F4FF',
    borderRadius: radii.pill,
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 4,
  },
  stagePillText: {
    color: colors.link,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  artistName: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  artistTime: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
});
