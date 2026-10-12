import {
  Badge,
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
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '@/src/components/ScreenHeader';
import { ErrorState, LoadingState, StaleDataNote } from '@/src/components/StateViews';
import { useFestivalsById, useGroups } from '@/src/hooks/use-groups';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useLocationSharing } from '@/src/location/LocationSharingProvider';
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

function CrewActions() {
  return (
    <View style={styles.actionRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create a crew"
        style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.primary }, pressed && styles.pressed]}
        onPress={() => router.push('/(tabs)/group/create')}
      >
        <Ionicons name="add-circle-outline" size={18} color={colors.textPrimary} />
        <Text style={styles.actionBtnLabel}>Create</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Join a crew with a code"
        style={({ pressed }) => [styles.actionBtn, styles.actionBtnSecondary, pressed && styles.pressed]}
        onPress={() => router.push('/(tabs)/group/join')}
      >
        <Ionicons name="enter-outline" size={18} color={colors.textPrimary} />
        <Text style={styles.actionBtnLabel}>Join</Text>
      </Pressable>
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
        <Ionicons name="people" size={48} color={colors.textPrimary} style={{ marginBottom: 4 }} />
        <Text style={styles.emptyTitle} accessibilityRole="header">
          Festival is better with friends
        </Text>
        <Text style={styles.emptyDesc}>
          {isOffline
            ? "You're offline. Crews you've joined appear here once you connect."
            : 'Create a crew to compare schedules, plan meetups, and find each other on the map.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a crew"
          style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}
          onPress={() => router.push('/(tabs)/group/create')}
        >
          <Text style={styles.createBtnLabel}>Create Crew</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Join a crew with a code"
          style={({ pressed }) => [styles.joinBtn, pressed && styles.pressed]}
          onPress={() => router.push('/(tabs)/group/join')}
        >
          <Text style={styles.joinBtnLabel}>Join with Code</Text>
        </Pressable>
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
            <Pressable
              key={group.id}
              accessibilityRole="button"
              accessibilityLabel={`${group.name}, ${festival?.name ?? 'festival'}, ${memberLabel}${group.my_role === 'admin' ? ', you are an admin' : ''}${sharingBadge?.a11y ?? ''}`}
              onPress={() => {
                setSelectedGroupId(group.id);
                router.push(`/(tabs)/group/${group.id}`);
              }}
              style={({ pressed }) => [styles.groupCard, pressed && { transform: [{ scale: 0.98 }] }]}
            >
              <View style={styles.groupIcon}>
                <Ionicons name="people" size={22} color={colors.textPrimary} />
              </View>
              <View style={styles.groupBody}>
                <Text style={styles.groupName} numberOfLines={2}>
                  {group.name}
                </Text>
                <Text style={styles.groupMeta} numberOfLines={1}>
                  {[festival?.name, memberLabel].filter(Boolean).join(' · ').toUpperCase()}
                </Text>
                <View style={styles.badges}>
                  {group.my_role === 'admin' ? <Badge label="Admin" /> : null}
                  {festival?.is_demo ? <Badge label="Sample" tone="sample" /> : null}
                  {sharingBadge ? <Badge label={sharingBadge.label} tone={sharingBadge.tone} /> : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          );
        })}
        <StaleDataNote error={groups.refreshError} />
      </>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <ScreenHeader crumbs={['My Crews']} />
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
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 32,
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  emptyDesc: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 8 },
  createBtn: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 16,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  createBtnLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 2 },
  joinBtn: {
    width: '100%',
    alignItems: 'center',
    borderRadius: 16,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
    paddingVertical: 16,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  joinBtnLabel: { color: colors.link, fontSize: 13, fontWeight: '700' },

  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radii.xl,
    minHeight: layout.minTouchTarget + 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  actionBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  actionBtnLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },

  /* Crew card — reference yellow, 40px radius */
  groupCard: {
    backgroundColor: '#FDFD96',
    borderRadius: radii.card,
    padding: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  groupIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  groupBody: { flex: 1, gap: 4 },
  groupName: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 20,
    fontWeight: '700',
  },
  groupMeta: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
