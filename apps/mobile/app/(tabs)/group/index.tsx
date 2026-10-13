import {
  Badge,
  colors,
  continuous,
  deriveAccentColors,
  EmptyState,
  elevation,
  layout,
  PressableScale,
  PrimaryButton,
  radii,
  SecondaryButton,
  spacing,
  textStyles,
  useOfflineStatus,
} from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PASTELS } from '@/src/components/palette';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { ErrorState, LoadingState, StaleDataNote } from '@/src/components/StateViews';
import { useFestivalsById, useGroups } from '@/src/hooks/use-groups';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useLocationSharing } from '@/src/location/LocationSharingProvider';
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

/** The crew card's signature pastel yellow from the design reference (`#FDFD96`). Fill only. */
const CREW_CARD_FILL = PASTELS[2];
/** Edge of the white people puck on a crew card. */
const CREW_PUCK_SIZE = 40;

function CrewActions() {
  return (
    <View style={styles.actionRow}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Create a crew"
        style={[styles.actionBtn, styles.actionBtnPrimary]}
        onPress={() => router.push('/(tabs)/group/create')}
      >
        <Ionicons name="add-circle-outline" size={20} color={colors.textPrimary} />
        <Text style={styles.actionBtnLabel}>Create</Text>
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Join a crew with a code"
        style={[styles.actionBtn, styles.actionBtnSecondary]}
        onPress={() => router.push('/(tabs)/group/join')}
      >
        <Ionicons name="enter-outline" size={20} color={colors.link} />
        <Text style={[styles.actionBtnLabel, styles.actionBtnLabelSecondary]}>Join</Text>
      </PressableScale>
    </View>
  );
}

export default function GroupsScreen() {
  const tabBarClearance = useTabBarClearance();
  const groups = useGroups();
  const festivalsById = useFestivalsById();
  const sharing = useLocationSharing();
  const isOffline = useOfflineStatus();
  const activeFestivalAccent = useAppStore((s) => s.activeFestivalAccent);
  const setSelectedGroupId = useAppStore((s) => s.setSelectedGroupId);
  const screenBg = deriveAccentColors(activeFestivalAccent).bgTint;
  useSafeAreaEdgeTint(screenBg);

  const list = groups.data ?? [];
  const hasGroups = list.length > 0;

  let body: React.ReactNode;
  if (groups.isLoading) {
    body = <LoadingState label="Loading your crews…" />;
  } else if (!hasGroups && groups.isRefreshing && !groups.hasRefreshed) {
    body = <LoadingState label="Checking for your crews…" />;
  } else if (!hasGroups && groups.refreshError && !isOffline) {
    body = <ErrorState error={groups.refreshError} onRetry={() => void groups.refetch()} />;
  } else if (!hasGroups) {
    body = (
      <View style={styles.emptyCard}>
        <View style={styles.emptyIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Ionicons name="people" size={48} color={colors.textPrimary} />
        </View>
        <Text style={styles.emptyTitle} accessibilityRole="header">
          Festival is better with friends
        </Text>
        <Text style={styles.emptyDesc}>
          {isOffline
            ? "You're offline. Crews you've joined appear here once you connect."
            : 'Create a crew to compare schedules, plan meetups, and find each other on the map.'}
        </Text>
        <View style={styles.emptyActions}>
          <PrimaryButton
            label="Create crew"
            accessibilityLabel="Create a crew"
            onPress={() => router.push('/(tabs)/group/create')}
          />
          <SecondaryButton
            label="Join with code"
            accessibilityLabel="Join a crew with a code"
            onPress={() => router.push('/(tabs)/group/join')}
          />
        </View>
      </View>
    );
  } else {
    body = (
      <>
        <CrewActions />
        {list.map((group) => {
          const festival = festivalsById.get(group.festival_id);
          const memberLabel = `${group.member_count} member${Number(group.member_count) === 1 ? '' : 's'}`;
          // Truthful status (§5.6): only an active share earns the success badge.
          const sharingStatus = sharing.groupId === group.id ? sharing.status : 'off';
          const sharingBadge =
            sharingStatus === 'sharing'
              ? { label: 'Sharing location', tone: 'success' as const, a11y: ', sharing your location' }
              : sharingStatus === 'permission_denied'
                ? { label: 'Location access off', tone: 'warning' as const, a11y: ', location sharing on but location access is off' }
                : sharingStatus === 'paused'
                  ? { label: 'Sharing paused', tone: 'neutral' as const, a11y: ', location sharing paused' }
                  : null;
          return (
            <PressableScale
              key={group.id}
              accessibilityRole="button"
              accessibilityLabel={`${group.name}, ${festival?.name ?? 'festival'}, ${memberLabel}${group.my_role === 'admin' ? ', you are an admin' : ''}${sharingBadge?.a11y ?? ''}`}
              onPress={() => {
                setSelectedGroupId(group.id);
                router.push(`/(tabs)/group/${group.id}`);
              }}
              style={styles.groupCard}
            >
              <View style={styles.groupIcon}>
                <Ionicons name="people" size={22} color={colors.textPrimary} />
              </View>
              <View style={styles.groupBody}>
                <Text style={styles.groupName} numberOfLines={2}>
                  {group.name}
                </Text>
                <Text style={styles.groupMeta} numberOfLines={2}>
                  {[festival?.name, memberLabel].filter(Boolean).join(' · ')}
                </Text>
                <View style={styles.badges}>
                  {group.my_role === 'admin' ? <Badge label="Admin" /> : null}
                  {festival?.is_demo ? <Badge label="Sample" tone="sample" /> : null}
                  {sharingBadge ? <Badge label={sharingBadge.label} tone={sharingBadge.tone} /> : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} />
            </PressableScale>
          );
        })}
        <StaleDataNote error={groups.refreshError} />
      </>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <ScreenHeader crumbs={['My crews']} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={groups.isRefreshing && !groups.isLoading}
            onRefresh={() => void groups.refetch()}
            tintColor={colors.textPrimary}
          />
        }
      >
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { gap: spacing.md, paddingHorizontal: layout.screenGutter, paddingTop: spacing.sm },

  /* Empty state: the brand card with both ways in */
  emptyCard: {
    ...continuous,
    ...elevation.card,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.xxl,
  },
  emptyIcon: { marginBottom: spacing.xs },
  emptyTitle: { ...textStyles.title2, color: colors.textPrimary, textAlign: 'center' },
  emptyDesc: { ...textStyles.subheadline, color: colors.textSecondary, textAlign: 'center' },
  emptyActions: { alignSelf: 'stretch', gap: spacing.ms, marginTop: spacing.sm },

  /* Create / Join tiles above the list: flat, like buttons */
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    ...continuous,
    alignItems: 'center',
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: layout.buttonHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionBtnPrimary: { backgroundColor: colors.primary },
  /* Matches the shared SecondaryButton: tinted fill, `link` label. */
  actionBtnSecondary: { backgroundColor: colors.tintedFill },
  actionBtnLabel: { ...textStyles.headline, color: colors.textPrimary, flexShrink: 1, textAlign: 'center' },
  actionBtnLabelSecondary: { color: colors.link },

  /* Crew card: the reference yellow, `card` radius */
  groupCard: {
    ...continuous,
    ...elevation.card,
    alignItems: 'center',
    backgroundColor: CREW_CARD_FILL,
    borderRadius: radii.card,
    flexDirection: 'row',
    gap: spacing.md,
    padding: layout.cardPadding,
  },
  groupIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    height: CREW_PUCK_SIZE,
    justifyContent: 'center',
    width: CREW_PUCK_SIZE,
  },
  groupBody: { flex: 1, gap: spacing.xs },
  groupName: { ...textStyles.title2, color: colors.textPrimary },
  groupMeta: { ...textStyles.footnote, color: colors.textSecondary },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
