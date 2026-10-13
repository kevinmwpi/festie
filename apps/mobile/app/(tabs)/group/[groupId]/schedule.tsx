import type { CombinedSelectionRow } from '@festival/data-access';
import { describeSetChange, festivalDayKey, listFestivalDays, type SetChange } from '@festival/domain';
import {
  Badge,
  Chip,
  colors,
  continuous,
  deriveAccentColors,
  EmptyState,
  layout,
  radii,
  SectionCard,
  SegmentedControl,
  spacing,
  tabularNums,
  textStyles,
  useOfflineStatus,
} from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TimeZoneHint } from '@/src/components/FestivalNotes';
import { SubScreenHeader } from '@/src/components/ScreenHeader';
import { cancelledTextStyle, SetChangeBadge, SetChangeDetail } from '@/src/components/SetChange';
import { ErrorState, FestivalBundleState, LoadingState, StaleDataNote } from '@/src/components/StateViews';
import { queryKeys } from '@/src/hooks/query-keys';
import { useFestivalBundle, useFestivalClock, type FestivalClock } from '@/src/hooks/use-festival';
import { useCombinedSelections, useGroupDetail } from '@/src/hooks/use-groups';
import { useReReadOnBundleChange, useUnscheduledArtists } from '@/src/hooks/use-lineup';
import { useUserKey } from '@/src/hooks/use-session';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

type ScheduleView = 'overlap' | 'per-person' | 'divergence';

const ALL = 'all';
const NO_ROWS: CombinedSelectionRow[] = [];
const LONG_DATE: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };
const NO_BREAK_SPACE = String.fromCharCode(0x00a0);

/**
 * "Fri 1:30 PM – 2:15 PM" with no-break spaces inside each time ("Fri 1:30 PM", "2:15 PM"), so a long
 * line wraps at the dash instead of between "1:30" and "PM". The visible text is unchanged.
 */
function keepTimesTogether(text: string): string {
  return text
    .replace(/([A-Za-z]) (?=\d{1,2}:\d{2})/g, `$1${NO_BREAK_SPACE}`)
    .replace(/ (AM|PM)\b/g, `${NO_BREAK_SPACE}$1`);
}

/** Member names as wrapping pills (a single-line badge would cut the list off). */
function NamePills({ names }: { names: string[] }) {
  return (
    <View style={styles.namesPills}>
      {names.map((name, index) => (
        <View key={`${name}-${index}`} style={styles.namePill}>
          <Text style={styles.namePillText}>{name}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * One set in a crew card: a single screen-reader element that reads artist, stage and time, then
 * `accessibilityDetail` (who is going, the next meetup) and the set's schedule change, if any.
 * `accent` adds a coloured bar on the left. A moved or cancelled set (`change`) shows its badge beside
 * the name and the change detail under the time; a cancelled set's name and time are struck through and
 * its bar turns red.
 */
function SetRow({
  artistName,
  stageName,
  startTime,
  endTime,
  clock,
  change,
  footer,
  accent,
  accessibilityDetail,
}: {
  artistName: string;
  stageName: string;
  startTime: string;
  endTime: string;
  clock: FestivalClock;
  change?: SetChange | null;
  footer?: React.ReactNode;
  accent?: string;
  accessibilityDetail?: string;
}) {
  const cancelled = change?.status === 'cancelled';
  const when = `${clock.day(startTime)} ${clock.range(startTime, endTime)}`;
  const label = [artistName, stageName, when, accessibilityDetail].filter(Boolean).join(', ');
  return (
    <View
      style={styles.setRow}
      accessible
      accessibilityLabel={change?.accessibilityLabel ? `${label}. ${change.accessibilityLabel}` : label}
    >
      {accent ? <View style={[styles.setAccent, { backgroundColor: cancelled ? colors.destructive : accent }]} /> : null}
      <View style={styles.setBody}>
        <View style={styles.artistLine}>
          <Text style={[styles.artistName, cancelled && cancelledTextStyle]}>{artistName}</Text>
          <SetChangeBadge change={change ?? null} />
        </View>
        <Text style={[styles.setMeta, cancelled && cancelledTextStyle]}>{`${stageName} · ${keepTimesTogether(when)}`}</Text>
        <SetChangeDetail change={change ?? null} />
        {footer}
      </View>
    </View>
  );
}

export default function CombinedScheduleScreen() {
  const tabBarClearance = useTabBarClearance();
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = (Array.isArray(params.groupId) ? params.groupId[0] : params.groupId) ?? '';
  const [view, setView] = React.useState<ScheduleView>('overlap');
  const [day, setDay] = React.useState<string>(ALL);
  const isOffline = useOfflineStatus();

  const detail = useGroupDetail(groupId);
  const group = detail.data?.group ?? null;
  const festivalId = group?.festival_id ?? null;
  const bundle = useFestivalBundle(festivalId);
  const festival = bundle.data?.festival ?? null;
  // The crew's festival wash, like the sibling schedule screens (the active festival's until it loads).
  const activeFestivalAccent = useAppStore((state) => state.activeFestivalAccent);
  const screenBg = deriveAccentColors(festival?.accent_color || activeFestivalAccent).bgTint;
  useSafeAreaEdgeTint(screenBg);
  // Announcement mode: the lineup is out (announced acts exist) but no set has a time yet.
  const unscheduled = useUnscheduledArtists(festivalId);
  const setTimesPending = bundle.data?.sets.length === 0 && (unscheduled.data?.length ?? 0) > 0;
  const clock = useFestivalClock(festival);
  const selections = useCombinedSelections(groupId, festivalId);
  // A moved or cancelled set arrives with a new festival bundle; re-read the crew's picks with it.
  const userKey = useUserKey();
  useReReadOnBundleChange(bundle.data, [queryKeys.groupSchedule(userKey, groupId, festivalId ?? 'none')]);
  const rows = selections.data ?? NO_ROWS;
  const timeZone = festival?.timezone ?? '';

  const days = React.useMemo(
    () => (festival ? listFestivalDays(festival, rows.map((row) => ({ start_time: row.start_time }))) : []),
    [festival, rows],
  );

  const dayRows = React.useMemo(() => {
    if (day === ALL) return rows;
    return rows.filter((row) => {
      try {
        return festivalDayKey(row.start_time, timeZone) === day;
      } catch {
        return false;
      }
    });
  }, [day, rows, timeZone]);

  const bySet = React.useMemo(() => {
    const map = new Map<string, { row: CombinedSelectionRow; names: string[]; userIds: Set<string> }>();
    for (const row of dayRows) {
      const entry = map.get(row.set_id);
      if (entry) {
        if (!entry.userIds.has(row.user_id)) {
          entry.userIds.add(row.user_id);
          entry.names.push(row.member_display_name);
        }
      } else {
        map.set(row.set_id, { row, names: [row.member_display_name], userIds: new Set([row.user_id]) });
      }
    }
    return [...map.values()].sort((left, right) => Date.parse(left.row.start_time) - Date.parse(right.row.start_time));
  }, [dayRows]);

  const overlapRows = React.useMemo(
    () => bySet.filter((entry) => entry.userIds.size >= 2).sort((left, right) => right.userIds.size - left.userIds.size || Date.parse(left.row.start_time) - Date.parse(right.row.start_time)),
    [bySet],
  );

  const byPerson = React.useMemo(() => {
    const map = new Map<string, { name: string; rows: CombinedSelectionRow[] }>();
    for (const row of dayRows) {
      const entry = map.get(row.user_id) ?? { name: row.member_display_name, rows: [] };
      entry.rows.push(row);
      map.set(row.user_id, entry);
    }
    return [...map.entries()].sort((left, right) => left[1].name.localeCompare(right[1].name));
  }, [dayRows]);

  const meetups = detail.data?.meetups ?? [];
  const nextMeetupAfter = React.useCallback(
    (startTime: string) => meetups.find((meetup) => Date.parse(meetup.starts_at) >= Date.parse(startTime)) ?? null,
    [meetups],
  );

  const header = <SubScreenHeader title="Crew schedule" label={group ? `${group.name} · combined picks` : 'Combined picks'} />;

  if (!group) {
    return (
      <View style={[styles.container, { backgroundColor: screenBg }]}>
        {header}
        <View style={styles.statePad}>
          {detail.isLoading || detail.isRefreshing ? (
            <LoadingState label="Loading crew…" />
          ) : detail.refreshError ? (
            <ErrorState error={detail.refreshError} onRetry={() => void detail.refetch()} />
          ) : (
            <EmptyState title="Crew unavailable" description="This crew isn't on this device. Go back and pull to refresh." />
          )}
        </View>
      </View>
    );
  }

  let content: React.ReactNode;
  if (selections.isLoading) {
    content = <LoadingState label="Loading crew picks…" />;
  } else if (rows.length === 0) {
    content = detail.refreshError && !detail.hasRefreshed ? (
      <ErrorState error={detail.refreshError} onRetry={() => void detail.refetch()} />
    ) : (
      <EmptyState
        title="No picks yet"
        description={
          setTimesPending
            ? 'The festival hasn’t published set times yet. Once it does, crew members can add sets and they show up here.'
            : 'When crew members add sets to their schedules, they show up here.'
        }
      />
    );
  } else if (view === 'overlap') {
    content =
      overlapRows.length === 0 ? (
        <EmptyState title="No shared picks" description="When two or more of you pick the same set, it shows up here." />
      ) : (
        <SectionCard>
          <Text style={styles.sectionLabel} accessibilityRole="header">
            Shared sets · {overlapRows.length}
          </Text>
          {overlapRows.map((entry) => {
            const change = describeSetChange(entry.row, clock.timeZone);
            const cancelled = change?.status === 'cancelled';
            // A cancelled set stays listed so the crew can see what happened, but nobody is going to it.
            const count = `${entry.userIds.size} ${cancelled ? 'had picked it' : 'going'}`;
            return (
              <SetRow
                key={entry.row.set_id}
                artistName={entry.row.artist_name}
                stageName={entry.row.stage_name}
                startTime={entry.row.start_time}
                endTime={entry.row.end_time}
                clock={clock}
                change={change}
                accent={colors.success}
                accessibilityDetail={`${count}: ${entry.names.join(', ')}`}
                footer={
                  <>
                    <Badge label={count} tone={cancelled ? 'neutral' : 'success'} />
                    <NamePills names={entry.names} />
                  </>
                }
              />
            );
          })}
        </SectionCard>
      );
  } else if (view === 'per-person') {
    content = byPerson.map(([userId, entry]) => (
      <SectionCard key={userId}>
        <Text style={styles.sectionLabel} accessibilityRole="header">
          {entry.name} · {entry.rows.length}
        </Text>
        {entry.rows.map((row) => (
          <SetRow
            key={row.id}
            artistName={row.artist_name}
            stageName={row.stage_name}
            startTime={row.start_time}
            endTime={row.end_time}
            clock={clock}
            change={describeSetChange(row, clock.timeZone)}
            accent={colors.primary}
          />
        ))}
      </SectionCard>
    ));
  } else {
    content = (
      <SectionCard>
        <Text style={styles.sectionLabel} accessibilityRole="header">
          All picks · {bySet.length}
        </Text>
        {bySet.map((entry) => {
          const change = describeSetChange(entry.row, clock.timeZone);
          // No "next meetup" hint for a set that is not happening.
          const meetup = change?.status === 'cancelled' ? null : nextMeetupAfter(entry.row.start_time);
          const meetupText = meetup
            ? `Next meetup: ${meetup.title} at ${clock.timeFrom(meetup.starts_at, entry.row.start_time)}`
            : null;
          return (
            <SetRow
              key={entry.row.set_id}
              artistName={entry.row.artist_name}
              stageName={entry.row.stage_name}
              startTime={entry.row.start_time}
              endTime={entry.row.end_time}
              clock={clock}
              change={change}
              accessibilityDetail={[entry.names.join(', '), meetupText].filter(Boolean).join(', ')}
              footer={
                <>
                  <NamePills names={entry.names} />
                  {meetupText ? (
                    <View style={styles.meetupHint}>
                      <Ionicons
                        name="location"
                        size={14}
                        color={colors.textSecondary}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      />
                      <Text style={styles.meetupHintText}>{meetupText}</Text>
                    </View>
                  ) : null}
                </>
              }
            />
          );
        })}
      </SectionCard>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        refreshControl={
          <RefreshControl
            refreshing={detail.isRefreshing && !selections.isLoading}
            onRefresh={() => void Promise.all([detail.refetch(), bundle.refetch()])}
            tintColor={colors.textPrimary}
          />
        }
      >
        {header}
        <View style={styles.inner}>
          <SectionCard>
            <SegmentedControl
              value={view}
              options={[
                { label: 'Overlap', value: 'overlap' },
                { label: 'Per person', value: 'per-person' },
                { label: 'Everyone', value: 'divergence' },
              ]}
              onChange={setView}
            />
            <Text style={styles.viewHint}>
              {view === 'overlap' && 'Sets at least two of you picked'}
              {view === 'per-person' && 'Every pick, member by member'}
              {view === 'divergence' && 'All picks and who is going'}
            </Text>
            {days.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={styles.dayRow}>
                {[ALL, ...days].map((value) => (
                  <Chip
                    key={value}
                    variant="ink"
                    active={day === value}
                    onPress={() => setDay(value)}
                    label={value === ALL ? 'All days' : clock.date(value)}
                    accessibilityLabel={value === ALL ? 'All days' : clock.date(value, LONG_DATE)}
                  />
                ))}
              </ScrollView>
            ) : null}
            {festival ? <TimeZoneHint hint={clock.hint} /> : null}
          </SectionCard>

          {festival ? (
            content
          ) : (
            // Downloading, offline, failed or no longer published — each says what is actually wrong.
            <FestivalBundleState
              hasBundle={false}
              isLoading={bundle.isLoading}
              isRefreshing={bundle.isRefreshing}
              hasRefreshed={bundle.hasRefreshed}
              refreshError={bundle.refreshError}
              isOffline={isOffline}
              onRetry={() => void bundle.refetch()}
            />
          )}
          <StaleDataNote error={detail.refreshError} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // React Native gives horizontal ScrollViews flexGrow/flexShrink 1; in a flex column they would take
  // a share of the free height away from the list below. The negative margin bleeds the day row to the
  // card's edges, so chips scroll out from under its padding instead of stopping 20pt in.
  chipScroller: { flexGrow: 0, marginHorizontal: -layout.cardPadding },
  container: { flex: 1 },
  statePad: { padding: layout.screenGutter },
  scroll: { flex: 1 },
  inner: { gap: spacing.md, paddingHorizontal: layout.screenGutter },
  sectionLabel: { ...textStyles.footnote, ...tabularNums, color: colors.textSecondary, fontWeight: '600' },
  viewHint: { ...textStyles.footnote, color: colors.textSecondary },
  // Vertical padding keeps the chips' 44pt hitSlop inside the horizontal ScrollView.
  dayRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: layout.cardPadding, paddingVertical: spacing.xs },
  // `SectionCard` spaces its children 12pt apart, so the divider sits midway between two sets.
  setRow: {
    borderTopColor: colors.separator,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.ms,
  },
  setAccent: { borderRadius: radii.xs, width: spacing.xs },
  setBody: { alignItems: 'flex-start', flex: 1, gap: spacing.xs },
  // The name and its `Moved` / `Cancelled` badge share a line; a long name shrinks and the badge wraps under it.
  artistLine: { alignItems: 'center', alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  artistName: { ...textStyles.headline, color: colors.textPrimary, flexShrink: 1 },
  setMeta: { ...textStyles.footnote, ...tabularNums, color: colors.textSecondary },
  namesPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  namePill: { backgroundColor: colors.inputBg, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  namePillText: { ...textStyles.caption1, color: colors.link, fontWeight: '600' },
  meetupHint: {
    ...continuous,
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: radii.sm,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.ms,
    paddingVertical: spacing.sm,
  },
  meetupHintText: { ...textStyles.caption1, ...tabularNums, color: colors.textPrimary, flexShrink: 1, fontWeight: '600' },
});
