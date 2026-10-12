import { describeLineupAvailability, describeSetChange, festivalDayKey, listFestivalDays } from '@festival/domain';
import {
  Badge,
  Chip,
  colors,
  deriveAccentColors,
  EmptyState,
  FieldInput,
  layout,
  radii,
  SecondaryButton,
  spacing,
  useOfflineStatus,
} from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FestivalDisclaimer, TimeZoneHint } from '@/src/components/FestivalNotes';
import { SubScreenHeader } from '@/src/components/ScreenHeader';
import { cancelledTextStyle, SetChangeBadge, SetChangeDetail } from '@/src/components/SetChange';
import { FestivalBundleState, LoadingState, NoFestivalState, StaleDataNote } from '@/src/components/StateViews';
import { UnscheduledFootnote } from '@/src/components/UnscheduledLineup';
import { useFestivalClock } from '@/src/hooks/use-festival';
import { useLineup, type LineupRow } from '@/src/hooks/use-lineup';
import { useSetSelection } from '@/src/hooks/use-set-selection';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

const ALL = 'all';
const NO_ROWS: LineupRow[] = [];

/** Compact, searchable lineup for adding sets to "My Schedule". */
export default function BrowseScheduleScreen() {
  const tabBarClearance = useTabBarClearance();
  const festivalId = useAppStore((state) => state.activeFestivalId);
  const accent = useAppStore((state) => state.activeFestivalAccent);
  const screenBg = deriveAccentColors(accent).bgTint;
  useSafeAreaEdgeTint(screenBg);
  const isOffline = useOfflineStatus();

  const { bundle, lineup, unscheduled, festival } = useLineup(festivalId);
  const clock = useFestivalClock(festival);
  const { toggle, busyIds } = useSetSelection(festival);
  const [dayFilter, setDayFilter] = React.useState<string>(ALL);
  const [search, setSearch] = React.useState('');
  const deferredSearch = React.useDeferredValue(search.trim().toLowerCase());

  const rows = lineup.data ?? NO_ROWS;
  const unscheduledCount = unscheduled.data?.length ?? 0;
  const availability = describeLineupAvailability({ setCount: rows.length, unscheduledCount });
  const timeZone = festival?.timezone ?? '';
  const days = React.useMemo(() => (festival ? listFestivalDays(festival, rows) : []), [festival, rows]);

  const filteredRows = React.useMemo(
    () =>
      rows.filter((row) => {
        if (dayFilter !== ALL) {
          try {
            if (festivalDayKey(row.start_time, timeZone) !== dayFilter) return false;
          } catch {
            return false;
          }
        }
        if (deferredSearch) {
          return row.artist_name.toLowerCase().includes(deferredSearch) || row.stage_name.toLowerCase().includes(deferredSearch);
        }
        return true;
      }),
    [dayFilter, deferredSearch, rows, timeZone],
  );

  const header = <SubScreenHeader title="Add sets" label={festival ? festival.name.toUpperCase() : 'BROWSE THE LINEUP'} />;

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

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      {header}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={(bundle.isRefreshing || lineup.isRefreshing) && Boolean(bundle.data)}
            onRefresh={() => void Promise.all([bundle.refetch(), lineup.refetch()])}
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
          <>
            {rows.length > 0 ? (
              <>
                <FieldInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search artists or stages"
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel="Search artists or stages"
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={styles.filterRow}>
                  {[ALL, ...days].map((day) => (
                    <Chip
                      key={day}
                      active={dayFilter === day}
                      accentColor={accent}
                      onPress={() => setDayFilter(day)}
                      label={day === ALL ? 'All days' : clock.date(day)}
                    />
                  ))}
                </ScrollView>
                <TimeZoneHint hint={clock.hint} />
              </>
            ) : null}

            {lineup.isLoading || unscheduled.isLoading ? (
              <LoadingState label="Loading the lineup…" />
            ) : availability === 'tba' ? (
              <EmptyState
                title="Set times coming soon"
                description="The lineup is out, but the festival hasn’t published set times yet. You can add sets here once it does."
                action={<SecondaryButton label="See the lineup" onPress={() => router.navigate('/(tabs)/lineup')} />}
              />
            ) : rows.length === 0 ? (
              <EmptyState title="Lineup coming soon" description="Sets will appear here once the festival publishes its schedule." />
            ) : filteredRows.length === 0 ? (
              <EmptyState title="No matches" description="Try a different name or day." />
            ) : (
              <View style={styles.listCard}>
                {filteredRows.map((row, index) => {
                  const selected = Boolean(row.selection_id);
                  const busy = busyIds.has(row.id);
                  const change = describeSetChange(row, clock.timeZone);
                  const cancelled = change?.status === 'cancelled';
                  const changeSuffix = change ? `. ${change.accessibilityLabel}` : '';
                  return (
                    <View key={row.id} style={[styles.row, index > 0 && styles.rowDivider]}>
                      <View style={styles.rowText}>
                        <Text style={[styles.artist, cancelled && cancelledTextStyle]}>{row.artist_name}</Text>
                        <Text style={[styles.meta, cancelled && cancelledTextStyle]}>
                          {row.stage_name} · {clock.day(row.start_time)} {clock.range(row.start_time, row.end_time)}
                        </Text>
                        <SetChangeDetail change={change} />
                        {change?.label || row.is_conflicting ? (
                          <View style={styles.badgeRow}>
                            <SetChangeBadge change={change} />
                            {row.is_conflicting ? <Badge label="Conflict" tone="warning" /> : null}
                          </View>
                        ) : null}
                      </View>
                      {cancelled && !selected ? null : (
                        <Pressable
                          onPress={() => void toggle(row)}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityLabel={`${selected ? `Remove ${row.artist_name} from my schedule` : `Add ${row.artist_name} to my schedule`}${changeSuffix}`}
                          accessibilityState={{ selected, busy }}
                          style={({ pressed }) => [styles.toggle, selected ? styles.toggleOn : styles.toggleOff, pressed && { opacity: 0.8 }]}
                        >
                          {busy ? (
                            <ActivityIndicator size="small" color={colors.textPrimary} />
                          ) : (
                            <>
                              <Ionicons name={selected ? 'checkmark' : 'add'} size={16} color={colors.textPrimary} />
                              <Text style={styles.toggleLabel}>{selected ? 'Added' : 'Add'}</Text>
                            </>
                          )}
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
            {availability === 'partial' ? <UnscheduledFootnote count={unscheduledCount} where="lineup" /> : null}
            <StaleDataNote error={bundle.refreshError ?? lineup.refreshError} />
          </>
        ) : null}
        <FestivalDisclaimer />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // React Native gives horizontal ScrollViews flexGrow/flexShrink 1; in a flex column they would take
  // a share of the free height away from the list below.
  chipScroller: { flexGrow: 0 },
  container: { flex: 1 },
  statePad: { padding: spacing.lg },
  scroll: { flex: 1 },
  scrollContent: { gap: spacing.md, paddingHorizontal: spacing.lg },
  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  listCard: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 64, paddingVertical: spacing.sm + 4 },
  rowDivider: { borderTopColor: 'rgba(44, 51, 39, 0.08)', borderTopWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 3 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  artist: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.textSecondary, fontSize: 13 },
  toggle: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    minHeight: layout.minTouchTarget,
    minWidth: 88,
    paddingHorizontal: spacing.md,
  },
  toggleOn: { backgroundColor: colors.success },
  toggleOff: { backgroundColor: colors.primary },
  toggleLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
});
