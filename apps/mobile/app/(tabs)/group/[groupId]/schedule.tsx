import type { CombinedSelectionRow } from '@festival/data-access';
import { festivalDayKey, listFestivalDays } from '@festival/domain';
import { Badge, Chip, colors, EmptyState, radii, SegmentedControl, spacing, useOfflineStatus } from '@festival/ui';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TimeZoneHint } from '@/src/components/FestivalNotes';
import { SubScreenHeader } from '@/src/components/ScreenHeader';
import { ErrorState, FestivalBundleState, LoadingState, StaleDataNote } from '@/src/components/StateViews';
import { useFestivalBundle, useFestivalClock, type FestivalClock } from '@/src/hooks/use-festival';
import { useCombinedSelections, useGroupDetail } from '@/src/hooks/use-groups';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';

type ScheduleView = 'overlap' | 'per-person' | 'divergence';

const ALL = 'all';
const NO_ROWS: CombinedSelectionRow[] = [];

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

function SetRow({
  artistName,
  stageName,
  startTime,
  endTime,
  clock,
  footer,
  accent,
}: {
  artistName: string;
  stageName: string;
  startTime: string;
  endTime: string;
  clock: FestivalClock;
  footer?: React.ReactNode;
  accent?: string;
}) {
  return (
    <View style={[styles.setRow, accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : null]}>
      <Text style={styles.artistName}>{artistName}</Text>
      <Text style={styles.setMeta}>
        {`${stageName} · ${clock.day(startTime)} ${clock.range(startTime, endTime)}`.toUpperCase()}
      </Text>
      {footer}
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
  const clock = useFestivalClock(festival);
  const selections = useCombinedSelections(groupId, festivalId);
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

  const header = <SubScreenHeader title="Crew Schedule" label={group ? `${group.name} · combined picks`.toUpperCase() : 'COMBINED PICKS'} />;

  if (!group) {
    return (
      <View style={styles.container}>
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
      <EmptyState title="No picks yet" description="When crew members add sets to their schedules, they show up here." />
    );
  } else if (view === 'overlap') {
    content =
      overlapRows.length === 0 ? (
        <EmptyState title="No shared picks" description="When two or more of you pick the same set, it shows up here." />
      ) : (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>SHARED SETS · {overlapRows.length}</Text>
          {overlapRows.map((entry) => (
            <SetRow
              key={entry.row.set_id}
              artistName={entry.row.artist_name}
              stageName={entry.row.stage_name}
              startTime={entry.row.start_time}
              endTime={entry.row.end_time}
              clock={clock}
              accent={colors.success}
              footer={
                <>
                  <Badge label={`${entry.userIds.size} going`} tone="success" />
                  <NamePills names={entry.names} />
                </>
              }
            />
          ))}
        </View>
      );
  } else if (view === 'per-person') {
    content = byPerson.map(([userId, entry]) => (
      <View key={userId} style={styles.card}>
        <Text style={styles.sectionLabel}>{entry.name.toUpperCase()} · {entry.rows.length}</Text>
        {entry.rows.map((row) => (
          <SetRow
            key={row.id}
            artistName={row.artist_name}
            stageName={row.stage_name}
            startTime={row.start_time}
            endTime={row.end_time}
            clock={clock}
            accent={colors.primary}
          />
        ))}
      </View>
    ));
  } else {
    content = (
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>ALL PICKS · {bySet.length}</Text>
        {bySet.map((entry) => {
          const meetup = nextMeetupAfter(entry.row.start_time);
          return (
            <SetRow
              key={entry.row.set_id}
              artistName={entry.row.artist_name}
              stageName={entry.row.stage_name}
              startTime={entry.row.start_time}
              endTime={entry.row.end_time}
              clock={clock}
              footer={
                <>
                  <NamePills names={entry.names} />
                  {meetup ? (
                    <View style={styles.meetupHint}>
                      <Text style={styles.meetupHintText}>
                        📍 Next meetup: {meetup.title} at {clock.timeFrom(meetup.starts_at, entry.row.start_time)}
                      </Text>
                    </View>
                  ) : null}
                </>
              }
            />
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
          <View style={styles.card}>
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
                  <Chip key={value} active={day === value} onPress={() => setDay(value)} label={value === ALL ? 'All days' : clock.date(value)} />
                ))}
              </ScrollView>
            ) : null}
            {festival ? <TimeZoneHint hint={clock.hint} /> : null}
          </View>

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
  // a share of the free height away from the list below.
  chipScroller: { flexGrow: 0 },
  container: { flex: 1, backgroundColor: colors.background },
  statePad: { padding: spacing.lg },
  scroll: { flex: 1 },
  inner: { gap: spacing.md, paddingHorizontal: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    gap: spacing.sm,
  },
  sectionLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 2 },
  viewHint: { color: colors.textSecondary, fontSize: 12, fontStyle: 'italic' },
  dayRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  setRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 4,
    paddingLeft: spacing.sm,
    paddingTop: spacing.sm,
    alignItems: 'flex-start',
  },
  artistName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  setMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  namesPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  namePill: { backgroundColor: '#F0F4FF', borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  namePillText: { color: colors.link, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  meetupHint: { backgroundColor: '#F0F4FF', borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  meetupHintText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
});
