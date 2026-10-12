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
  deriveAccentColors,
  EmptyState,
  IconButton,
  layout,
  radii,
  SecondaryButton,
  showToast,
  spacing,
  useOfflineStatus,
} from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/src/components/Avatar';
import { FestivalDisclaimer } from '@/src/components/FestivalNotes';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { ErrorState, LoadingState, StaleDataNote } from '@/src/components/StateViews';
import { queryKeys } from '@/src/hooks/query-keys';
import { useCacheFirstQuery } from '@/src/hooks/use-cache-first-query';
import { useCurrentProfile } from '@/src/hooks/use-current-profile';
import { formatFestivalDateRange } from '@/src/hooks/use-festival';
import { useUserKey } from '@/src/hooks/use-session';
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { ensureActiveFestival, useAppStore } from '@/src/state/app-store';

function FestivalCard({
  festival,
  isFollowing,
  isActive,
  busy,
  onToggle,
  onSelect,
}: {
  festival: Festival;
  isFollowing: boolean;
  isActive: boolean;
  busy: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const accent = deriveAccentColors(festival.accent_color ?? colors.primary);
  const dates = formatFestivalDateRange(festival);
  const meta = [festival.venue_name, dates].filter(Boolean).join(' • ');

  const [pressed, setPressed] = React.useState(false);

  // The card body and the follow toggle are sibling buttons: a toggle nested inside an accessible
  // Pressable is one VoiceOver element with it and could never be focused or activated.
  return (
    <View
      style={[
        styles.card,
        // Card background = soft tint of the festival accent, as in the reference.
        { backgroundColor: accent.bgTint },
        isActive && styles.cardActive,
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={styles.cardInner}>
        <Pressable
          onPress={onSelect}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          accessibilityRole="button"
          accessibilityLabel={`${festival.name}${festival.is_demo ? ', sample festival' : ''}, ${meta}${isFollowing ? ', following' : ''}`}
          accessibilityHint="Opens this festival's lineup"
          accessibilityState={{ selected: isActive }}
          style={styles.cardBody}
        >
          <View style={[styles.iconBox, { backgroundColor: accent.solid }]}>
            <Ionicons name="flag" size={28} color={colors.textPrimary} />
          </View>

          <View style={styles.cardText}>
            {festival.is_demo ? <Badge label="Sample" tone="sample" /> : null}
            <Text style={styles.festivalName} numberOfLines={2}>
              {festival.name}
            </Text>
            <Text style={styles.festivalMeta}>{meta.toUpperCase()}</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={onToggle}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={isFollowing ? `Unfollow ${festival.name}` : `Follow ${festival.name}`}
          accessibilityState={{ selected: isFollowing, busy }}
          hitSlop={4}
          style={({ pressed: togglePressed }) => [
            styles.toggleButton,
            isFollowing ? styles.toggleFollowing : styles.toggleNotFollowing,
            togglePressed && { transform: [{ scale: 0.88 }] },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : isFollowing ? (
            <Ionicons name="checkmark" size={20} color={colors.textPrimary} />
          ) : (
            <Ionicons name="add" size={20} color={colors.textPrimary} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

export default function FestivalsScreen() {
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
        crumbs={['Explore Festivals', activeName]}
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
        <Text style={styles.countLabel}>All Events</Text>
        <Text style={styles.countFollowing}>{followingIds.size} Following</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  countLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
    color: colors.textSecondary,
  },
  countFollowing: {
    color: colors.textPrimary,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: layout.tabBarClearance,
    gap: spacing.md,
  },

  /* Festival card — bg = festival tint, rounded-[40px] */
  card: {
    borderRadius: radii.card,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.05)',
    // Padding lives on the body button (and the toggle's margin) so the whole card stays tappable.
    paddingRight: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardActive: {
    borderColor: 'rgba(0,0,0,0.15)',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardBody: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingLeft: spacing.xl,
    paddingVertical: spacing.lg,
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardText: { flex: 1, gap: 4 },
  festivalName: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  festivalMeta: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  /* Follow toggle — 48×48, white border */
  toggleButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  toggleFollowing: { backgroundColor: colors.success },
  toggleNotFollowing: { backgroundColor: '#FFFFFF' },
});
