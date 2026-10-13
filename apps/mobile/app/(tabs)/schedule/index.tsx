import { getConflictSetIds, type ScheduleRow } from '@festival/data-access';
import {
  DEFAULT_DAY_START_HOUR,
  festivalDayKey,
  festivalDayMinutesRange,
  listFestivalDays,
} from '@festival/domain';
import { syncSetReminders } from '@festival/notification-utils';
import {
  Badge,
  Chip,
  colors,
  continuous,
  deriveAccentColors,
  elevation,
  EmptyState,
  IconButton,
  layout,
  PressableScale,
  radii,
  SecondaryButton,
  spacing,
  tabularNums,
  textStyles,
  useOfflineStatus,
} from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionSheet } from '@/src/components/BottomSheet';
import { TimeZoneHint } from '@/src/components/FestivalNotes';
import { pastelFor } from '@/src/components/palette';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { FestivalBundleState, LoadingState, NoFestivalState, StaleDataNote } from '@/src/components/StateViews';
import { useFestivalClock, type FestivalClock } from '@/src/hooks/use-festival';
import { useMySchedule } from '@/src/hooks/use-lineup';
import { useSetSelection } from '@/src/hooks/use-set-selection';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

/* ─── Timeline geometry ─────────────────────────────────── */

const HOUR_HEIGHT = 96;
/**
 * Block heights follow the clock, not the text, so block text stops growing at 1.25×. The block
 * geometry below is derived from the text's line heights at that cap, so nothing is clipped at any
 * text size. The block's accessibility label carries the full text at any size.
 */
const BLOCK_MAX_FONT_SCALE = 1.25;
const BLOCK_ARTIST_TEXT = { ...textStyles.footnote, fontWeight: '600' } as const;
const BLOCK_DETAIL_TEXT = textStyles.caption2;
/** Height (pt) of one line of `style` at the capped text size (React Native scales line heights too). */
function cappedLineHeight(style: { lineHeight: number }): number {
  return Math.ceil(style.lineHeight * BLOCK_MAX_FONT_SCALE);
}
const BLOCK_PADDING_VERTICAL = spacing.sm;
/** Width of the warning ring on a conflicting block (it takes layout space, so it is in the budget). */
const BLOCK_CONFLICT_BORDER = 2;
const BLOCK_CHROME_HEIGHT = BLOCK_PADDING_VERTICAL * 2 + BLOCK_CONFLICT_BORDER * 2;
/** Artist and stage lines at the capped size, plus padding and the conflict ring (60pt). */
const MIN_BLOCK_HEIGHT = BLOCK_CHROME_HEIGHT + cappedLineHeight(BLOCK_ARTIST_TEXT) + cappedLineHeight(BLOCK_DETAIL_TEXT);
/** Tall enough to add the time line under the artist and stage (77pt, about 48 minutes). */
const TIME_LINE_MIN_HEIGHT = MIN_BLOCK_HEIGHT + cappedLineHeight(BLOCK_DETAIL_TEXT);
/** Tall enough for a second artist line as well (100pt, about an hour), so long names are not cut. */
const ARTIST_TWO_LINE_MIN_HEIGHT = TIME_LINE_MIN_HEIGHT + cappedLineHeight(BLOCK_ARTIST_TEXT);
const MIN_WINDOW_MINUTES = 4 * 60;
const TIME_GUTTER_WIDTH = 56;
/**
 * Hour labels are decorative (hidden from screen readers: every block's label has its full time), so
 * they stop growing at 1.3×, where "12 PM" still fits the gutter beside the grid.
 */
const HOUR_LABEL_MAX_FONT_SCALE = 1.3;
/** Box each hour label is centred in, on its grid line; taller than the label at its capped size. */
const HOUR_LABEL_BOX_HEIGHT = spacing.xl;
const LONG_DATE: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };
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
  return (
    // The slot fills the block's column; its horizontal padding leaves a 4pt gap between side-by-side
    // blocks (2pt at the grid edges) without pushing the block past its column.
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${block.row.artist_name}, ${block.row.stage_name}, ${time}${block.isConflict ? ', conflicts with another pick' : ''}`}
      accessibilityHint="Shows options for this set"
      style={[
        styles.blockSlot,
        {
          top: block.top,
          height: block.height,
          left: `${block.column * widthPercent}%`,
          width: `${widthPercent}%`,
        },
      ]}
    >
      {/* The shadow sits on this view; the one inside clips the text to the rounded corners. */}
      <View style={styles.block}>
        <View
          style={[
            styles.blockClip,
            { borderLeftColor: pastelFor(block.row.stage_id) },
            block.isConflict && styles.blockConflict,
          ]}
        >
          <Text
            style={styles.blockArtist}
            numberOfLines={block.height >= ARTIST_TWO_LINE_MIN_HEIGHT ? 2 : 1}
            maxFontSizeMultiplier={BLOCK_MAX_FONT_SCALE}
          >
            {/* Inline, so it scales with the name; the block's label already says it conflicts. */}
            {block.isConflict ? (
              <>
                <Ionicons name="warning" size={BLOCK_ARTIST_TEXT.fontSize} color={colors.warningText} />{' '}
              </>
            ) : null}
            {block.row.artist_name}
          </Text>
          <Text style={styles.blockStage} numberOfLines={1} maxFontSizeMultiplier={BLOCK_MAX_FONT_SCALE}>
            {block.row.stage_name}
          </Text>
          {block.height >= TIME_LINE_MIN_HEIGHT ? (
            <Text style={styles.blockTime} numberOfLines={1} maxFontSizeMultiplier={BLOCK_MAX_FONT_SCALE}>
              {time}
            </Text>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
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
  const countsByDay = React.useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
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

  // Keep existing reminders in step with picks (cancel removed sets, reschedule moved ones). Never prompts.
  React.useEffect(() => {
    if (!festival || schedule.isLoading || schedule.data === undefined) {
      return;
    }
    void syncSetReminders(
      rows.map((row) => ({ id: row.id, start_time: row.start_time, artist_name: row.artist_name, stage_name: row.stage_name })),
      { timeZone: festival.timezone, festivalId: festival.id },
    );
  }, [festival, rows, schedule.data, schedule.isLoading]);

  const handleRefresh = React.useCallback(async () => {
    await Promise.all([bundle.refetch(), schedule.refetch()]);
  }, [bundle, schedule]);

  const header = (
    <ScreenHeader
      crumbs={['My schedule', festival?.name]}
      right={
        festival ? (
          <IconButton
            icon={<Ionicons name="add" size={24} color={colors.textPrimary} />}
            accessibilityLabel="Add sets from the lineup"
            onPress={() => router.push('/(tabs)/schedule/browse')}
          />
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
                variant="ink"
                active={activeDay === day}
                onPress={() => setSelectedDay(day)}
                label={`${clock.date(day)}${count > 0 ? ` · ${count}` : ''}`}
                accessibilityLabel={`${clock.date(day, LONG_DATE)}${count > 0 ? `, ${count} ${count === 1 ? 'set' : 'sets'}` : ''}`}
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

              {dayRows.length === 0 ? (
                <EmptyState title="Nothing picked this day" description="Pick another day, or add sets from the lineup." />
              ) : (
                <View style={styles.timeline}>
                  {/* Decorative on both platforms: every block's label already carries its full time. */}
                  <View
                    style={[styles.timeGutter, { height: timeline.hours * HOUR_HEIGHT }]}
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    {Array.from({ length: timeline.hours + 1 }, (_, index) => (
                      <View key={index} style={[styles.hourLabelBox, { top: index * HOUR_HEIGHT - HOUR_LABEL_BOX_HEIGHT / 2 }]}>
                        <Text
                          style={styles.hourLabel}
                          numberOfLines={1}
                          maxFontSizeMultiplier={HOUR_LABEL_MAX_FONT_SCALE}
                          importantForAccessibility="no"
                        >
                          {hourLabel(timeline.windowStart + index * 60)}
                        </Text>
                      </View>
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
        message={actionRow ? `${actionRow.stage_name} · ${clock.day(actionRow.start_time, { weekday: 'short', month: 'short', day: 'numeric' })} · ${clock.range(actionRow.start_time, actionRow.end_time)}` : undefined}
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
  statePad: { padding: layout.screenGutter },
  // Vertical padding keeps the chips' 44pt hitSlop inside the horizontal ScrollView.
  dayRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: layout.screenGutter, paddingVertical: spacing.sm },

  scroll: { flex: 1 },
  scrollContent: { gap: spacing.md, paddingHorizontal: layout.screenGutter, paddingTop: spacing.sm },
  infoRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' },

  timeline: { flexDirection: 'row', paddingTop: spacing.sm },
  timeGutter: { position: 'relative', width: TIME_GUTTER_WIDTH },
  hourLabelBox: {
    justifyContent: 'center',
    left: 0,
    minHeight: HOUR_LABEL_BOX_HEIGHT,
    paddingRight: spacing.sm,
    position: 'absolute',
    right: 0,
  },
  hourLabel: { ...textStyles.caption2, ...tabularNums, color: colors.textSecondary, fontWeight: '600', textAlign: 'right' },
  gridArea: { borderLeftColor: colors.separator, borderLeftWidth: StyleSheet.hairlineWidth, flex: 1, position: 'relative' },
  gridLine: { backgroundColor: colors.separator, height: StyleSheet.hairlineWidth, left: 0, position: 'absolute', right: 0 },

  /* Block: a white tile with the stage colour as a 4pt left edge (`md` corners, so the edge still reads as
     a bar on a short block). */
  blockSlot: { paddingHorizontal: spacing.xxs, position: 'absolute' },
  block: { ...continuous, ...elevation.card, backgroundColor: colors.surface, borderRadius: radii.md, flex: 1 },
  blockClip: {
    ...continuous,
    backgroundColor: colors.surface,
    borderLeftWidth: spacing.xs,
    borderRadius: radii.md,
    flex: 1,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: BLOCK_PADDING_VERTICAL,
  },
  blockConflict: { borderColor: colors.warningText, borderLeftWidth: spacing.xs, borderWidth: BLOCK_CONFLICT_BORDER },
  blockArtist: { ...BLOCK_ARTIST_TEXT, color: colors.textPrimary },
  blockStage: { ...BLOCK_DETAIL_TEXT, color: colors.textSecondary },
  // `marginTop: 'auto'` pins the time to the bottom of the block.
  blockTime: { ...BLOCK_DETAIL_TEXT, ...tabularNums, color: colors.textSecondary, marginTop: 'auto' },
});
