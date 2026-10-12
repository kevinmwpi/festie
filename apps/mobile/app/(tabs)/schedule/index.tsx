import { getConflictSetIds, type ScheduleRow } from '@festival/data-access';
import {
  DEFAULT_DAY_START_HOUR,
  describeSetChange,
  festivalDayKey,
  festivalDayMinutesRange,
  isCancelledSet,
  listFestivalDays,
} from '@festival/domain';
import { syncSetReminders } from '@festival/notification-utils';
import {
  Badge,
  Chip,
  colors,
  deriveAccentColors,
  EmptyState,
  IconButton,
  radii,
  SecondaryButton,
  spacing,
  useOfflineStatus,
} from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionSheet } from '@/src/components/BottomSheet';
import { TimeZoneHint } from '@/src/components/FestivalNotes';
import { pastelFor } from '@/src/components/palette';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { cancelledTextStyle, ScheduleChangesNotice, setChangeDetailText } from '@/src/components/SetChange';
import { FestivalBundleState, LoadingState, NoFestivalState, StaleDataNote } from '@/src/components/StateViews';
import { useFestivalClock, type FestivalClock } from '@/src/hooks/use-festival';
import { useMySchedule } from '@/src/hooks/use-lineup';
import { useSetSelection } from '@/src/hooks/use-set-selection';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

/* ─── Timeline geometry ─────────────────────────────────── */

const HOUR_HEIGHT = 96;
const MIN_BLOCK_HEIGHT = 52;
/**
 * Block heights follow the clock, not the text, so block text stops growing at 1.25× (the artist and
 * stage lines then still fit the 36pt a minimum-height block has inside its padding). The block's
 * accessibility label carries the full text at any size.
 */
const BLOCK_MAX_FONT_SCALE = 1.25;
const MIN_WINDOW_MINUTES = 4 * 60;
const TIME_GUTTER_WIDTH = 48;
const NO_ROWS: ScheduleRow[] = [];

interface PositionedBlock {
  row: ScheduleRow;
  top: number;
  height: number;
  column: number;
  totalColumns: number;
  isConflict: boolean;
}

interface TimelineLayout {
  blocks: PositionedBlock[];
  /** Minutes since the festival day start of the first hour line. */
  windowStart: number;
  hours: number;
}

function hourLabel(minutesIntoDay: number): string {
  const hour = (DEFAULT_DAY_START_HOUR + Math.floor(minutesIntoDay / 60)) % 24;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * Places a day's sets on a wall-clock timeline (`festivalDayMinutesRange`: start from
 * `minutesIntoFestivalDay`, height from the real duration). Overlapping blocks — real conflicts, or
 * two sets inside a repeated DST fall-back hour that share a wall-clock start — are laid out side by
 * side in columns instead of on top of each other.
 */
function layoutTimeline(rows: ScheduleRow[], timeZone: string, conflictIds: Set<string>): TimelineLayout {
  const items = rows
    .map((row) => {
      try {
        const range = festivalDayMinutesRange(row.start_time, row.end_time, timeZone);
        return { row, start: range.startMinutes, end: Math.max(range.endMinutes, range.startMinutes + 15) };
      } catch {
        return null;
      }
    })
    .filter((item): item is { row: ScheduleRow; start: number; end: number } => item !== null)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  if (items.length === 0) {
    return { blocks: [], windowStart: 0, hours: 0 };
  }

  const windowStart = Math.floor(items[0].start / 60) * 60;
  let windowEnd = Math.ceil(Math.max(...items.map((item) => item.end)) / 60) * 60;
  if (windowEnd - windowStart < MIN_WINDOW_MINUTES) {
    windowEnd = windowStart + MIN_WINDOW_MINUTES;
  }

  const positioned = items.map((item) => ({
    row: item.row,
    top: ((item.start - windowStart) / 60) * HOUR_HEIGHT,
    height: Math.max(((item.end - item.start) / 60) * HOUR_HEIGHT, MIN_BLOCK_HEIGHT),
  }));

  // Group into clusters of transitively overlapping blocks, then assign columns within each.
  const blocks: PositionedBlock[] = [];
  let cluster: typeof positioned = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const columnEnds: number[] = [];
    const placed = cluster.map((item) => {
      let column = columnEnds.findIndex((end) => item.top >= end);
      if (column === -1) {
        column = columnEnds.length;
      }
      columnEnds[column] = item.top + item.height;
      return { ...item, column };
    });
    placed.forEach((item) =>
      blocks.push({ ...item, totalColumns: columnEnds.length, isConflict: conflictIds.has(item.row.id) }),
    );
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const item of positioned) {
    if (cluster.length > 0 && item.top >= clusterEnd) {
      flush();
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.top + item.height);
  }
  flush();

  return { blocks, windowStart, hours: (windowEnd - windowStart) / 60 };
}

/* ─── Timeline block ────────────────────────────────────── */

function TimelineBlock({ block, clock, onPress }: { block: PositionedBlock; clock: FestivalClock; onPress: () => void }) {
  const widthPercent = 100 / block.totalColumns;
  const time = clock.range(block.row.start_time, block.row.end_time);
  const change = describeSetChange(block.row, clock.timeZone);
  const cancelled = change?.status === 'cancelled';
  // Small blocks have room for one status word in place of the stage line.
  const stageLine = change?.label ? `${change.label} · ${block.row.stage_name}` : block.row.stage_name;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${block.row.artist_name}, ${block.row.stage_name}, ${time}${block.isConflict ? ', conflicts with another pick' : ''}${change ? `. ${change.accessibilityLabel}` : ''}`}
      accessibilityHint="Shows options for this set"
      style={({ pressed }) => [
        styles.block,
        {
          top: block.top,
          height: block.height,
          left: `${block.column * widthPercent}%`,
          width: `${widthPercent}%`,
          borderLeftColor: pastelFor(block.row.stage_id),
        },
        block.isConflict && styles.blockConflict,
        cancelled && styles.blockCancelled,
        change?.status === 'moved' && styles.blockMoved,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[styles.blockArtist, cancelled && cancelledTextStyle]} numberOfLines={1} maxFontSizeMultiplier={BLOCK_MAX_FONT_SCALE}>
        {block.row.artist_name}
      </Text>
      <Text
        style={[styles.blockStage, change?.label ? (cancelled ? styles.blockStatusCancelled : styles.blockStatusMoved) : null]}
        numberOfLines={1}
        maxFontSizeMultiplier={BLOCK_MAX_FONT_SCALE}
      >
        {stageLine}
      </Text>
      {block.height >= 80 ? (
        <Text style={styles.blockTime} numberOfLines={1} maxFontSizeMultiplier={BLOCK_MAX_FONT_SCALE}>
          {time}
        </Text>
      ) : null}
    </Pressable>
  );
}

function actionSheetMessage(row: ScheduleRow, clock: FestivalClock): string {
  const when = `${row.stage_name} · ${clock.day(row.start_time, { weekday: 'short', month: 'short', day: 'numeric' })} · ${clock.range(row.start_time, row.end_time)}`;
  const change = describeSetChange(row, clock.timeZone);
  if (!change) {
    return when;
  }
  const detail = setChangeDetailText(change);
  return [when, [change.label, detail].filter(Boolean).join(': ')].filter(Boolean).join('\n');
}

/* ─── Screen ────────────────────────────────────────────── */

export default function PersonalScheduleScreen() {
  const tabBarClearance = useTabBarClearance();
  const festivalId = useAppStore((s) => s.activeFestivalId);
  const activeFestivalAccent = useAppStore((s) => s.activeFestivalAccent);
  const screenBg = deriveAccentColors(activeFestivalAccent).bgTint;
  useSafeAreaEdgeTint(screenBg);
  const isOffline = useOfflineStatus();

  const { bundle, schedule, festival } = useMySchedule(festivalId);
  const clock = useFestivalClock(festival);
  const { toggle } = useSetSelection(festival);
  const rows = schedule.data ?? NO_ROWS;
  const timeZone = festival?.timezone ?? '';

  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);
  const [actionRow, setActionRow] = React.useState<ScheduleRow | null>(null);

  React.useEffect(() => {
    setSelectedDay(null);
  }, [festivalId]);

  const conflictIds = React.useMemo(() => getConflictSetIds(rows), [rows]);

  const dayOf = React.useCallback(
    (row: ScheduleRow): string | null => {
      try {
        return festivalDayKey(row.start_time, timeZone);
      } catch {
        return null;
      }
    },
    [timeZone],
  );

  const days = React.useMemo(() => (festival ? listFestivalDays(festival, rows) : []), [festival, rows]);
  // Day chips count the sets the user will actually see (cancelled picks stay listed but not counted).
  const countsByDay = React.useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      if (isCancelledSet(row)) return;
      const day = dayOf(row);
      if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
    });
    return counts;
  }, [dayOf, rows]);

  // Default: today's festival day when it is part of the festival, else the first day with picks.
  const activeDay = React.useMemo(() => {
    if (selectedDay && days.includes(selectedDay)) {
      return selectedDay;
    }
    let today: string | null = null;
    try {
      today = festivalDayKey(new Date(), timeZone);
    } catch {
      today = null;
    }
    if (today && days.includes(today)) {
      return today;
    }
    return days.find((day) => countsByDay.has(day)) ?? days[0] ?? null;
  }, [countsByDay, days, selectedDay, timeZone]);

  const dayRows = React.useMemo(() => rows.filter((row) => dayOf(row) === activeDay), [activeDay, dayOf, rows]);
  const timeline = React.useMemo(() => layoutTimeline(dayRows, timeZone, conflictIds), [conflictIds, dayRows, timeZone]);

  // Keep existing reminders in step with picks (cancel removed and cancelled sets, reschedule moved
  // ones). Never prompts.
  React.useEffect(() => {
    if (!festival || schedule.isLoading || schedule.data === undefined) {
      return;
    }
    void syncSetReminders(
      rows
        .filter((row) => !isCancelledSet(row))
        .map((row) => ({ id: row.id, start_time: row.start_time, artist_name: row.artist_name, stage_name: row.stage_name })),
      { timeZone: festival.timezone, festivalId: festival.id },
    );
  }, [festival, rows, schedule.data, schedule.isLoading]);

  const handleRefresh = React.useCallback(async () => {
    await Promise.all([bundle.refetch(), schedule.refetch()]);
  }, [bundle, schedule]);

  const header = (
    <ScreenHeader
      crumbs={['My Schedule', festival?.name]}
      right={
        festival ? (
          <IconButton icon="+" accessibilityLabel="Add sets from the lineup" onPress={() => router.push('/(tabs)/schedule/browse')} />
        ) : undefined
      }
    />
  );

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

  const hasPicks = rows.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      {header}

      {festival && hasPicks ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={styles.dayRow}>
          {days.map((day) => {
            const count = countsByDay.get(day) ?? 0;
            return (
              <Chip
                key={day}
                active={activeDay === day}
                accentColor={activeFestivalAccent}
                onPress={() => setSelectedDay(day)}
                label={`${clock.date(day)}${count > 0 ? ` · ${count}` : ''}`}
              />
            );
          })}
        </ScrollView>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={(schedule.isRefreshing || bundle.isRefreshing) && Boolean(bundle.data)}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.textPrimary}
          />
        }
      >
        <FestivalBundleState
          hasBundle={Boolean(bundle.data)}
          isLoading={bundle.isLoading}
          isRefreshing={bundle.isRefreshing}
          hasRefreshed={bundle.hasRefreshed}
          refreshError={bundle.refreshError}
          isOffline={isOffline}
          onRetry={() => void bundle.refetch()}
        />

        {festival ? (
          schedule.isLoading ? (
            <LoadingState label="Loading your schedule…" />
          ) : !hasPicks ? (
            <EmptyState
              title="No sets yet"
              description="Add artists from the lineup and they'll show up here as a timeline, with a reminder before each set."
              action={<SecondaryButton label="Browse lineup" onPress={() => router.navigate('/(tabs)/lineup')} />}
            />
          ) : (
            <>
              <View style={styles.infoRow}>
                <TimeZoneHint hint={clock.hint} />
                {conflictIds.size > 0 ? (
                  <Badge label={`${conflictIds.size} in conflict`} tone="warning" />
                ) : null}
              </View>

              <ScheduleChangesNotice
                picks={rows}
                timeZone={timeZone}
                onSelect={(pick) => {
                  const day = dayOf(pick);
                  if (day) setSelectedDay(day);
                }}
              />

              {dayRows.length === 0 ? (
                <EmptyState title="Nothing picked this day" description="Pick another day, or add sets from the lineup." />
              ) : (
                <View style={styles.timeline}>
                  <View style={[styles.timeGutter, { height: timeline.hours * HOUR_HEIGHT }]}>
                    {Array.from({ length: timeline.hours + 1 }, (_, index) => (
                      <Text
                        key={index}
                        style={[styles.hourLabel, { top: index * HOUR_HEIGHT - 6 }]}
                        importantForAccessibility="no"
                      >
                        {hourLabel(timeline.windowStart + index * 60)}
                      </Text>
                    ))}
                  </View>
                  <View style={[styles.gridArea, { height: timeline.hours * HOUR_HEIGHT }]}>
                    {Array.from({ length: timeline.hours + 1 }, (_, index) => (
                      <View key={index} style={[styles.gridLine, { top: index * HOUR_HEIGHT }]} />
                    ))}
                    {timeline.blocks.map((block) => (
                      <TimelineBlock key={block.row.id} block={block} clock={clock} onPress={() => setActionRow(block.row)} />
                    ))}
                  </View>
                </View>
              )}
              <StaleDataNote error={schedule.refreshError ?? bundle.refreshError} />
            </>
          )
        ) : null}
      </ScrollView>

      <ActionSheet
        visible={actionRow !== null}
        title={actionRow?.artist_name}
        message={actionRow ? actionSheetMessage(actionRow, clock) : undefined}
        actions={
          actionRow
            ? [{ label: 'Remove from my schedule', destructive: true, onPress: () => void toggle(actionRow) }]
            : []
        }
        onClose={() => setActionRow(null)}
      />
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
  dayRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },

  scroll: { flex: 1 },
  scrollContent: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  infoRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' },

  timeline: { flexDirection: 'row', paddingTop: spacing.sm },
  timeGutter: { position: 'relative', width: TIME_GUTTER_WIDTH },
  hourLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    position: 'absolute',
    right: 6,
    textAlign: 'right',
  },
  gridArea: { borderLeftColor: 'rgba(0,0,0,0.05)', borderLeftWidth: 1, flex: 1, position: 'relative' },
  gridLine: { backgroundColor: 'rgba(0,0,0,0.05)', height: 1, left: 0, position: 'absolute', right: 0 },

  /* Block — white, rounded-2xl, stage-coloured left edge */
  block: {
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    borderRadius: radii.md,
    elevation: 2,
    gap: 2,
    marginHorizontal: 2,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 8,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  blockConflict: { borderColor: colors.destructive, borderWidth: 1.5, borderLeftWidth: 4 },
  blockCancelled: { backgroundColor: colors.destructiveBg },
  blockMoved: { borderColor: colors.link, borderWidth: 1, borderLeftWidth: 4 },
  blockStatusCancelled: { color: colors.destructive },
  blockStatusMoved: { color: colors.link },
  blockArtist: { color: colors.textPrimary, fontFamily: 'Georgia', fontSize: 13, fontStyle: 'italic', fontWeight: '700' },
  blockStage: { color: colors.textSecondary, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  blockTime: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', marginTop: 'auto' },
});
