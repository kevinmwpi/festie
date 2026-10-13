import {
  getLocalBlockedUsers,
  listBlockedUsers,
  toUserMessage,
  unblockUser,
  type BlockedUser,
} from '@festival/data-access';
import { isOnline } from '@festival/sync-engine';
import {
  Avatar,
  colors,
  EmptyState,
  InlineMessage,
  layout,
  ListRow,
  ListSection,
  ScreenHeader,
  showToast,
  spacing,
  useOfflineStatus,
} from '@festival/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { goBackOr } from '@/src/providers/launch-route';
import { useCachedProfile } from '@/src/providers/session-state';
import { useFestivalScreenTint } from '@/src/providers/screen-tint';

function blockedName(user: BlockedUser): string {
  return user.display_name?.trim() || 'Blocked user';
}

function blockedSince(user: BlockedUser): string | undefined {
  if (!user.blocked_at) return undefined;
  const date = new Date(user.blocked_at);
  return Number.isNaN(date.getTime())
    ? undefined
    : `Blocked ${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export default function BlockedUsersScreen() {
  const screenTint = useFestivalScreenTint();
  const profile = useCachedProfile();
  const queryClient = useQueryClient();
  const offline = useOfflineStatus();
  const queryKey = React.useMemo(() => ['blocked-users', profile?.auth_user_id ?? null] as const, [profile?.auth_user_id]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);
  const [unblockingId, setUnblockingId] = React.useState<string | null>(null);

  // Cache first: the saved list renders immediately, the server copy replaces it when online.
  const blocked = useQuery({ queryKey, queryFn: getLocalBlockedUsers });

  const refresh = React.useCallback(async () => {
    if (!isOnline()) return;
    setRefreshing(true);
    try {
      const rows = await listBlockedUsers();
      queryClient.setQueryData(queryKey, rows);
      setRefreshError(null);
    } catch (error) {
      setRefreshError(toUserMessage(error));
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, queryKey]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const unblock = React.useCallback(
    (user: BlockedUser) => {
      const name = blockedName(user);
      Alert.alert(
        `Unblock ${name}?`,
        "In crews you share, you'll see each other's meetups and picks again. They won't be told.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unblock',
            onPress: () => {
              setUnblockingId(user.user_id);
              unblockUser(user.user_id)
                .then(() => {
                  queryClient.setQueryData<BlockedUser[]>(queryKey, (rows) => rows?.filter((row) => row.user_id !== user.user_id));
                  // Their content comes back with the next refresh of crew, meetup and schedule data.
                  void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'blocked-users' });
                  showToast(`${name} unblocked`, 'success');
                })
                .catch((error: unknown) => showToast(toUserMessage(error), 'error'))
                .finally(() => setUnblockingId(null));
            },
          },
        ],
      );
    },
    [queryClient, queryKey],
  );

  const rows = blocked.data ?? [];

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: screenTint }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.textSecondary} />}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader title="Blocked users" subtitle="Privacy" onBack={() => goBackOr('/settings')} />

      {offline ? <InlineMessage tone="muted" message="You're offline. Showing your saved list; unblocking needs a connection." /> : null}
      {!offline && refreshError ? <InlineMessage tone="muted" message={`Couldn't refresh: ${refreshError}`} /> : null}

      {blocked.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.textSecondary} accessibilityLabel="Loading blocked users" />
        </View>
      ) : blocked.isError ? (
        <InlineMessage message={toUserMessage(blocked.error)} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No one blocked"
          description="When you block someone in a crew, they appear here. You won't see their meetups, picks or location, and they won't see yours."
        />
      ) : (
        <ListSection footer="Blocked people can't see your meetups, picks or location in crews you share, and you won't see theirs.">
          {rows.map((user) => (
            <ListRow
              key={user.user_id}
              leading={<Avatar name={blockedName(user)} avatarType={user.avatar_type} avatarValue={user.avatar_value} size={40} accessibilityLabel={null} />}
              title={blockedName(user)}
              subtitle={blockedSince(user)}
              value="Unblock"
              valueTone="action"
              // Unblocking happens here (after a confirmation), so no navigation chevron.
              accessory="none"
              loading={unblockingId === user.user_id}
              accessibilityLabel={`Unblock ${blockedName(user)}`}
              // The label replaces the row text, so the blocked date is read as the hint.
              accessibilityHint={blockedSince(user)}
              onPress={() => unblock(user)}
            />
          ))}
        </ListSection>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.lg, padding: layout.screenGutter, paddingBottom: spacing.xxxl + spacing.xl },
  loading: { alignItems: 'center', paddingVertical: spacing.xxl },
});
