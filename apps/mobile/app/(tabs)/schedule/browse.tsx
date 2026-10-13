import { describeLineupAvailability, describeSetChange, festivalDayKey, listFestivalDays } from '@festival/domain';
import {
  Badge,
  Chip,
  colors,
  deriveAccentColors,
  elevation,
  EmptyState,
  FieldInput,
  layout,
  ListSection,
  motion,
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
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

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
const LONG_DATE: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };
/** Search icon size, matching the field's `body` text. */
const SEARCH_ICON_SIZE = 17;
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

  const header = <SubScreenHeader title="Add sets" label={festival ? festival.name : 'Browse the lineup'} />;

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
        // Dragging the results puts the keyboard away; while it is open, iOS insets the list by the
        // keyboard's height so the last rows can still scroll above it.
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
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
            {/* Announcement mode: while no set has a time there is nothing to search or filter, so the
                field, the day picker and the time-zone hint wait for the first set times. */}
            {rows.length > 0 ? (
              <>
                <View style={styles.searchField}>
                  <FieldInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search artists or stages"
                    autoCorrect={false}
                    returnKeyType="search"
                    accessibilityLabel="Search artists or stages"
                    style={styles.searchInput}
                  />
                  {/* Drawn over the field's leading padding; decorative, and taps pass through to the field. */}
                  <View
                    style={styles.searchIcon}
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <Ionicons name="search" size={SEARCH_ICON_SIZE} color={colors.textSecondary} />
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={styles.filterRow}>
                  {[ALL, ...days].map((day) => (
                    <Chip
                      key={day}
                      variant="ink"
                      active={dayFilter === day}
                      onPress={() => setDayFilter(day)}
                      label={day === ALL ? 'All days' : clock.date(day)}
                      accessibilityLabel={day === ALL ? 'All days' : clock.date(day, LONG_DATE)}
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
              <ListSection>
                {filteredRows.map((row) => {
                  const selected = Boolean(row.selection_id);
                  const busy = busyIds.has(row.id);
                  const change = describeSetChange(row, clock.timeZone);
                  const cancelled = change?.status === 'cancelled';
                  const changeSuffix = change ? `. ${change.accessibilityLabel}` : '';
                  return (
                    <View key={row.id} style={styles.row}>
                      <View style={styles.rowText}>
                        <Text style={[styles.artist, cancelled && cancelledTextStyle]}>{row.artist_name}</Text>
                        <Text style={[styles.meta, cancelled && cancelledTextStyle]}>
                          {row.stage_name} · {keepTimesTogether(`${clock.day(row.start_time)} ${clock.range(row.start_time, row.end_time)}`)}
                        </Text>
                        <SetChangeDetail change={change} />
                        {change?.label || row.is_conflicting ? (
                          <View style={styles.badgeRow}>
                            <SetChangeBadge change={change} />
                            {row.is_conflicting ? <Badge label="Conflict" tone="warning" /> : null}
                          </View>
                        ) : null}
                      </View>
                      {/* A cancelled set cannot be added; one already picked keeps its button so it can be removed. */}
                      {cancelled && !selected ? null : (
                        <PressableScale
                          onPress={() => void toggle(row)}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityLabel={`${selected ? `Remove ${row.artist_name} from my schedule` : `Add ${row.artist_name} to my schedule`}${changeSuffix}`}
                          accessibilityState={{ selected, busy }}
                          pressedScale={motion.pressedScaleSmall}
                          style={[styles.toggle, selected ? styles.toggleOn : styles.toggleOff]}
                        >
                          {busy ? (
                            <ActivityIndicator size="small" color={colors.textPrimary} />
                          ) : (
                            <>
                              <Ionicons name={selected ? 'checkmark' : 'add'} size={17} color={colors.textPrimary} />
                              <Text style={styles.toggleLabel}>{selected ? 'Added' : 'Add'}</Text>
                            </>
                          )}
                        </PressableScale>
                      )}
                    </View>
                  );
                })}
              </ListSection>
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
  // a share of the free height away from the list below. The negative margin bleeds the row to the
  // screen edges, so chips scroll out from under the gutter instead of stopping 20pt in.
  chipScroller: { flexGrow: 0, marginHorizontal: -layout.screenGutter },
  container: { flex: 1 },
  statePad: { padding: layout.screenGutter },
  scroll: { flex: 1 },
  scrollContent: { gap: spacing.md, paddingHorizontal: layout.screenGutter },
  searchField: { justifyContent: 'center' },
  searchInput: { paddingLeft: spacing.md + SEARCH_ICON_SIZE + spacing.sm },
  searchIcon: { left: spacing.md, position: 'absolute' },
  // Vertical padding keeps the chips' 44pt hitSlop inside the horizontal ScrollView.
  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: layout.screenGutter, paddingVertical: spacing.xs },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.ms,
  },
  rowText: { flex: 1, gap: spacing.xxs },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  artist: { ...textStyles.headline, color: colors.textPrimary },
  meta: { ...textStyles.footnote, ...tabularNums, color: colors.textSecondary },
  toggle: {
    ...elevation.raised,
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: layout.minTouchTarget,
    // Two touch targets wide, so the busy spinner (and "Add" vs "Added") barely changes its width.
    minWidth: layout.minTouchTarget * 2,
    paddingHorizontal: spacing.ms,
  },
  toggleOn: { backgroundColor: colors.success },
  toggleOff: { backgroundColor: colors.primary },
  toggleLabel: { ...textStyles.subheadline, color: colors.textPrimary, fontWeight: '600' },
});
