import {
  getLocalFestivals,
  getLocalUserFestivals,
  refreshFestivalCatalog,
  refreshUserFestivals,
  toggleUserFestival,
  toUserMessage,
  type Festival,
} from '@festival/data-access';
import {
  Badge,
  colors,
  continuous,
  deriveAccentColors,
  elevation,
  EmptyState,
  iconRadius,
  IconButton,
  layout,
  motion,
  PressableScale,
  radii,
  SecondaryButton,
  showToast,
  spacing,
  tabularNums,
  textStyles,
  useOfflineStatus,
} from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Avatar } from '@/src/components/Avatar';
import { FestivalDisclaimer } from '@/src/components/FestivalNotes';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { ErrorState, LoadingState, StaleDataNote } from '@/src/components/StateViews';
import { queryKeys } from '@/src/hooks/query-keys';
import { useCacheFirstQuery } from '@/src/hooks/use-cache-first-query';
import { useCurrentProfile } from '@/src/hooks/use-current-profile';
import { formatFestivalDateRange } from '@/src/hooks/use-festival';
import { useUserKey } from '@/src/hooks/use-session';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { ensureActiveFestival, useAppStore } from '@/src/state/app-store';

/** Edge of the festival's accent swatch tile. */
const SWATCH_SIZE = 64;
/** Edge of the follow toggle, white ring included. */
const TOGGLE_SIZE = 48;
/** Width of the toggle's white cut-out ring. */
const TOGGLE_RING = 4;
/** Card outline. 2pt in both states, so the selected (ink) outline does not shift the layout. */
const CARD_BORDER = 2;
/**
 * From the xxxLarge text size up (iOS `fontScale` 1.35 and the accessibility sizes) the swatch moves
 * above the name: beside the tile and the toggle the name would get only a few characters per line.
 */
const STACK_FONT_SCALE = 1.3;

function FestivalCard({
  festival,
  isFollowing,
  isActive,
  busy,
  stacked,
  onToggle,
  onSelect,
}: {
  festival: Festival;
  isFollowing: boolean;
  isActive: boolean;
  busy: boolean;
  stacked: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const accent = deriveAccentColors(festival.accent_color ?? colors.primary);
  const dates = formatFestivalDateRange(festival);
  const meta = [festival.venue_name, dates].filter(Boolean).join(' • ');

  // The card body and the follow toggle are sibling buttons: a toggle nested inside an accessible
  // Pressable is one VoiceOver element with it and could never be focused or activated. The body is the
  // visible card (wash, outline and padding), so the card scales as one when pressed. The toggle sits in
  // a sibling slot over the card's trailing edge. The slot is a plain View, not a button: it catches taps
  // in the strip around the toggle (the gap before it, the trailing padding, above and below it), so a tap
  // that misses the toggle does nothing, as before, and does not open the festival.
  return (
    <View>
      <PressableScale
        onPress={onSelect}
        accessibilityRole="button"
        accessibilityLabel={`${festival.name}${festival.is_demo ? ', sample festival' : ''}, ${meta}${isFollowing ? ', following' : ''}`}
        accessibilityHint="Opens this festival's lineup"
        accessibilityState={{ selected: isActive }}
        style={[
          styles.card,
          stacked ? styles.cardStacked : styles.cardRow,
          // Card wash = soft tint of the festival's own accent. It is translucent, so it carries no shadow.
          { backgroundColor: accent.bgTint },
          isActive && styles.cardActive,
        ]}
      >
        <View style={[styles.iconBox, { backgroundColor: accent.solid }]}>
          <Ionicons name="flag" size={28} color={colors.textPrimary} />
        </View>

        <View style={[styles.cardText, stacked ? styles.cardTextStacked : styles.cardTextRow]}>
          {festival.is_demo ? <Badge label="Sample" tone="sample" /> : null}
          <Text style={styles.festivalName}>{festival.name}</Text>
          <Text style={styles.festivalMeta}>{meta}</Text>
        </View>
      </PressableScale>

      <View style={[styles.toggleSlot, stacked ? styles.toggleSlotStacked : styles.toggleSlotRow]}>
        <PressableScale
          onPress={onToggle}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={isFollowing ? `Unfollow ${festival.name}` : `Follow ${festival.name}`}
          accessibilityState={{ selected: isFollowing, busy }}
          hitSlop={4}
          pressedScale={motion.pressedScaleSmall}
          style={[styles.toggleButton, isFollowing ? styles.toggleFollowing : styles.toggleNotFollowing]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : isFollowing ? (
            <Ionicons name="checkmark" size={20} color={colors.textPrimary} />
          ) : (
            <Ionicons name="add" size={20} color={colors.textPrimary} />
          )}
        </PressableScale>
      </View>
    </View>
  );
}

export default function FestivalsScreen() {
  const tabBarClearance = useTabBarClearance();
  const stackCards = useWindowDimensions().fontScale > STACK_FONT_SCALE;
  const queryClient = useQueryClient();
  const userKey = useUserKey();
  const isOffline = useOfflineStatus();
  const profile = useCurrentProfile().data;
  const activeFestivalId = useAppStore((s) => s.activeFestivalId);
  const setActiveFestival = useAppStore((s) => s.setActiveFestival);
  const activeFestivalAccent = useAppStore((s) => s.activeFestivalAccent);
  const screenBg = deriveAccentColors(activeFestivalAccent).bgTint;
  useSafeAreaEdgeTint(screenBg);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const catalog = useCacheFirstQuery({
    queryKey: queryKeys.festivals(),
    readLocal: getLocalFestivals,
    refresh: async () => {
      await refreshFestivalCatalog();
      await ensureActiveFestival();
    },
  });

  const following = useCacheFirstQuery({
    queryKey: queryKeys.userFestivals(userKey),
    readLocal: getLocalUserFestivals,
    refresh: async () => {
      await refreshUserFestivals();
      await ensureActiveFestival();
    },
  });

  const festivals = React.useMemo(() => {
    const list = catalog.data ?? [];
    // Demo ("Sample") festivals always sort last; otherwise keep the cache order (by start date).
    return [...list].sort((left, right) => Number(left.is_demo) - Number(right.is_demo));
  }, [catalog.data]);

  const followingIds = React.useMemo(
    () => new Set((following.data ?? []).map((row) => row.festival_id)),
    [following.data],
  );

  const handleToggle = React.useCallback(
    async (festival: Festival) => {
      setBusyId(festival.id);
      try {
        const nowFollowing = await toggleUserFestival(festival.id);
        await queryClient.invalidateQueries({ queryKey: queryKeys.userFestivals(userKey) });
        await ensureActiveFestival();
        showToast(nowFollowing ? `Following ${festival.name}.` : `Unfollowed ${festival.name}.`);
      } catch (error) {
        showToast(toUserMessage(error), 'error');
      } finally {
        setBusyId(null);
      }
    },
    [queryClient, userKey],
  );

  const handleSelect = React.useCallback(
    (festival: Festival) => {
      setActiveFestival(festival);
      router.navigate('/(tabs)/lineup');
    },
    [setActiveFestival],
  );

  const handleRefresh = React.useCallback(async () => {
    await Promise.all([catalog.refetch(), following.refetch()]);
  }, [catalog, following]);

  const activeName = festivals.find((festival) => festival.id === activeFestivalId)?.name;
  const isEmpty = festivals.length === 0;

  let emptyContent: React.ReactNode = null;
  if (isEmpty) {
    if (catalog.isLoading || (catalog.isRefreshing && !catalog.hasRefreshed)) {
      emptyContent = <LoadingState label="Loading festivals…" />;
    } else if (isOffline) {
      emptyContent = (
        <EmptyState
          title="You're offline"
          description="Connect to the internet once to download the festival list. After that it works without signal."
        />
      );
    } else if (catalog.refreshError) {
      emptyContent = <ErrorState error={catalog.refreshError} onRetry={() => void catalog.refetch()} />;
    } else {
      emptyContent = (
        <EmptyState
          title="No festivals yet"
          description="Festivals appear here as soon as their schedules are published. Pull down to check again."
        />
      );
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <ScreenHeader
        crumbs={['Explore festivals', activeName]}
        right={
          <IconButton
            icon={
              <Avatar
                name={profile?.display_name}
                avatarType={profile?.avatar_type}
                avatarValue={profile?.avatar_value}
                size={38}
              />
            }
            accessibilityLabel="Settings and profile"
            onPress={() => router.push('/settings')}
          />
        }
      />

      <View style={styles.countBar}>
        <Text style={styles.countLabel} accessibilityRole="header">
          All events
        </Text>
        <Text style={styles.countFollowing}>{followingIds.size} following</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={catalog.isRefreshing && !catalog.isLoading}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.textPrimary}
          />
        }
      >
        {emptyContent}
        {festivals.map((festival) => (
          <FestivalCard
            key={festival.id}
            festival={festival}
            isFollowing={followingIds.has(festival.id)}
            isActive={festival.id === activeFestivalId}
            busy={busyId === festival.id}
            stacked={stackCards}
            onToggle={() => void handleToggle(festival)}
            onSelect={() => handleSelect(festival)}
          />
        ))}
        {!isEmpty ? <StaleDataNote error={catalog.refreshError ?? following.refreshError} /> : null}
        {!isEmpty && catalog.localError ? (
          <SecondaryButton label="Reload festivals" onPress={() => void catalog.refetch()} />
        ) : null}
        <FestivalDisclaimer />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  countBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenGutter,
    paddingVertical: spacing.sm,
  },
  countLabel: { ...textStyles.footnote, color: colors.textSecondary, fontWeight: '600' },
  countFollowing: { ...textStyles.footnote, ...tabularNums, color: colors.textPrimary, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: {
    gap: spacing.md,
    paddingHorizontal: layout.screenGutter,
  },

  /*
   * Festival card: the body button is the card, washed in the festival's accent. In the row layout its
   * trailing padding is reserved for the follow toggle and is covered by the toggle slot below.
   */
  card: {
    ...continuous,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: CARD_BORDER,
    padding: layout.cardPadding,
  },
  cardRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingRight: layout.cardPadding + TOGGLE_SIZE + spacing.md,
  },
  cardStacked: { alignItems: 'flex-start', gap: spacing.ms },
  // The current festival: an ink outline (≥ 3:1 on every wash), the colour of the app's primary selection.
  cardActive: { borderColor: colors.textPrimary },
  iconBox: {
    ...continuous,
    alignItems: 'center',
    borderRadius: iconRadius(SWATCH_SIZE),
    height: SWATCH_SIZE,
    justifyContent: 'center',
    width: SWATCH_SIZE,
  },
  cardText: { gap: spacing.xs },
  cardTextRow: { flex: 1 },
  cardTextStacked: { alignSelf: 'stretch' },
  festivalName: { ...textStyles.title2, color: colors.textPrimary },
  festivalMeta: { ...textStyles.footnote, ...tabularNums, color: colors.textSecondary },

  /*
   * Follow toggle: a 48pt soft square with a white cut-out ring, over the card's trailing edge. Its slot
   * is a non-pressable strip from the card's trailing edge to 16pt before the toggle: taps there land on
   * the slot, not on the card body beneath it.
   */
  toggleSlot: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: CARD_BORDER + layout.cardPadding,
    position: 'absolute',
    right: 0,
    top: 0,
    width: CARD_BORDER + layout.cardPadding + TOGGLE_SIZE + spacing.md,
  },
  // Row cards: the full height of the card, the card's trailing padding (see `cardRow`).
  toggleSlotRow: { bottom: 0 },
  // Stacked cards: only the swatch row, with the toggle level with the swatch; the name below stays tappable.
  toggleSlotStacked: {
    height: CARD_BORDER + layout.cardPadding + SWATCH_SIZE,
    paddingTop: CARD_BORDER + layout.cardPadding,
  },
  toggleButton: {
    ...continuous,
    ...elevation.raised,
    alignItems: 'center',
    borderColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: TOGGLE_RING,
    height: TOGGLE_SIZE,
    justifyContent: 'center',
    width: TOGGLE_SIZE,
  },
  toggleFollowing: { backgroundColor: colors.success },
  toggleNotFollowing: { backgroundColor: colors.surface },
});
