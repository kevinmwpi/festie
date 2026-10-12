import {
  blockUser,
  deleteMeetup,
  getCachedProfile,
  isAppErrorCode,
  leaveGroup,
  removeGroupMember,
  rotateInviteCode,
  toUserMessage,
  unblockUser,
  type GroupMember,
  type LocalMeetup,
} from '@festival/data-access';
import { cancelReminderForEntity, syncMeetupReminders } from '@festival/notification-utils';
import {
  Badge,
  colors,
  DestructiveButton,
  EmptyState,
  IconButton,
  layout,
  radii,
  SecondaryButton,
  showToast,
  spacing,
  TextLink,
  useOfflineStatus,
} from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/src/components/Avatar';
import { ActionSheet, type SheetAction } from '@/src/components/BottomSheet';
import { LocationSharingCard } from '@/src/components/LocationSharingCard';
import { ReportSheet, type ReportTarget } from '@/src/components/ReportSheet';
import { SubScreenHeader } from '@/src/components/ScreenHeader';
import { ErrorState, LoadingState, StaleDataNote } from '@/src/components/StateViews';
import { TotemPhoto } from '@/src/components/TotemPhoto';
import { buildInviteShareMessage } from '@/src/config/app-info';
import { invalidateAfterBlockChange, invalidateGroupQueries } from '@/src/hooks/query-keys';
import { useFestivalBundle, useFestivalClock, type FestivalClock } from '@/src/hooks/use-festival';
import { useGroupDetail, useGroups } from '@/src/hooks/use-groups';
import { useNow } from '@/src/hooks/use-now';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useAddTotemPhoto } from '@/src/hooks/use-totem-photo';
import { stopLocationSharingForGroup } from '@/src/location/LocationSharingProvider';
import { cancelCrewReminders } from '@/src/notifications/crew-reminders';
import { useAppStore } from '@/src/state/app-store';

/** Meetups that started more than this long ago move under "Earlier". */
const MEETUP_GRACE_MS = 60 * 60 * 1000;

function memberName(member: GroupMember): string {
  if (member.is_blocked) return 'Blocked user';
  return member.user?.display_name ?? 'Festie user';
}

/* ─── Member row ────────────────────────────────────────── */

function MemberRow({
  member,
  isMe,
  busy,
  onPress,
}: {
  member: GroupMember;
  isMe: boolean;
  busy: boolean;
  onPress?: () => void;
}) {
  const name = memberName(member);
  const content = (
    <>
      <Avatar
        name={member.user?.display_name}
        avatarType={member.user?.avatar_type}
        avatarValue={member.user?.avatar_value}
        muted={member.is_blocked}
      />
      <View style={styles.memberInfo}>
        <Text style={[styles.memberName, member.is_blocked && styles.memberNameMuted]} numberOfLines={1}>
          {isMe ? `${name} (you)` : name}
        </Text>
        {member.role === 'admin' ? <Badge label="Admin" /> : null}
      </View>
    </>
  );

  if (!onPress) {
    return <View style={styles.memberRow}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`${name}${member.role === 'admin' ? ', admin' : ''}`}
      accessibilityHint={member.is_blocked ? 'Shows options like unblock or report' : 'Shows options like report or block'}
      accessibilityState={{ busy }}
      style={({ pressed }) => [styles.memberRow, pressed && styles.pressed]}
    >
      {content}
      {busy ? (
        <ActivityIndicator color={member.is_blocked ? colors.link : colors.textPrimary} />
      ) : member.is_blocked ? (
        <Text style={styles.blockedAction}>Unblock</Text>
      ) : (
        <Text style={styles.chevron}>›</Text>
      )}
    </Pressable>
  );
}

/* ─── Meetup card ───────────────────────────────────────── */

function MeetupCard({
  meetup,
  clock,
  placeLabel,
  creatorName,
  isMine,
  uploading,
  onMore,
  onReportPhoto,
  onAddPhoto,
}: {
  meetup: LocalMeetup;
  clock: FestivalClock;
  placeLabel: string | null;
  creatorName: string;
  isMine: boolean;
  uploading: boolean;
  onMore: () => void;
  onReportPhoto: () => void;
  onAddPhoto: () => void;
}) {
  // Without the festival's time zone a label would be in device time (§5.5): show none until it's known.
  const when = clock.timeZone ? `${clock.date(meetup.starts_at)} · ${clock.time(meetup.starts_at)}` : null;
  return (
    <View style={styles.meetupCard}>
      <View style={styles.meetupHeader}>
        <View style={styles.meetupDot} />
        <View style={styles.meetupInfo}>
          <Text style={styles.meetupTitle}>{meetup.title}</Text>
          {when ? <Text style={styles.meetupTime}>{when.toUpperCase()}</Text> : null}
          {placeLabel ? <Text style={styles.meetupPlace}>{placeLabel}</Text> : null}
          <Text style={styles.meetupBy}>{isMine ? 'Created by you' : `By ${creatorName}`}</Text>
          {meetup.pending_sync === 1 ? <Badge label="Waiting to sync" /> : null}
        </View>
        <IconButton icon="⋯" accessibilityLabel={`Options for ${meetup.title}`} onPress={onMore} />
      </View>
      {meetup.notes ? <Text style={styles.meetupNotes}>{meetup.notes}</Text> : null}
      {meetup.totem_path ? (
        <TotemPhoto path={meetup.totem_path} meetupTitle={meetup.title} onReport={isMine ? undefined : onReportPhoto} />
      ) : isMine && meetup.pending_sync !== 1 ? (
        <SecondaryButton label="Add totem photo" onPress={onAddPhoto} loading={uploading} />
      ) : null}
    </View>
  );
}

/* ─── Screen ────────────────────────────────────────────── */

export default function GroupDetailScreen() {
  const tabBarClearance = useTabBarClearance();
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = (Array.isArray(params.groupId) ? params.groupId[0] : params.groupId) ?? '';
  const queryClient = useQueryClient();
  const isOffline = useOfflineStatus();
  const now = useNow();
  const setSelectedGroupId = useAppStore((state) => state.setSelectedGroupId);
  const selectedGroupId = useAppStore((state) => state.selectedGroupId);

  const detail = useGroupDetail(groupId);
  const groups = useGroups();
  const group = detail.data?.group ?? null;
  const bundle = useFestivalBundle(group?.festival_id ?? null);
  const festival = bundle.data?.festival ?? null;
  const clock = useFestivalClock(festival);
  const { addPhoto, uploadingId } = useAddTotemPhoto();
  const me = getCachedProfile()?.id ?? null;
  const isAdmin = detail.data?.my_role === 'admin';

  const [memberSheet, setMemberSheet] = React.useState<GroupMember | null>(null);
  const [meetupSheet, setMeetupSheet] = React.useState<LocalMeetup | null>(null);
  const [reportTarget, setReportTarget] = React.useState<ReportTarget | null>(null);
  const [busyMemberId, setBusyMemberId] = React.useState<string | null>(null);
  const [leaving, setLeaving] = React.useState(false);
  const [rotating, setRotating] = React.useState(false);
  const [showEarlier, setShowEarlier] = React.useState(false);

  React.useEffect(() => {
    if (groupId) setSelectedGroupId(groupId);
  }, [groupId, setSelectedGroupId]);

  const members = detail.data?.members ?? [];
  const meetups = detail.data?.meetups ?? [];
  const membersById = React.useMemo(() => new Map(members.map((member) => [member.user_id, member])), [members]);
  const stagesById = React.useMemo(() => new Map((bundle.data?.stages ?? []).map((stage) => [stage.id, stage])), [bundle.data]);

  const placeLabel = React.useCallback(
    (meetup: LocalMeetup): string | null => {
      const stage = meetup.stage_id ? stagesById.get(meetup.stage_id) : null;
      if (stage) return stage.name;
      if (meetup.latitude !== null && meetup.longitude !== null) return 'Pinned on the map';
      return null;
    },
    [stagesById],
  );

  const upcoming = meetups.filter((meetup) => new Date(meetup.starts_at).getTime() >= now - MEETUP_GRACE_MS);
  const earlier = meetups.filter((meetup) => new Date(meetup.starts_at).getTime() < now - MEETUP_GRACE_MS).reverse();

  // Keep meetup reminders in step (deleted meetups lose theirs; moved ones are rescheduled). A crew that
  // is gone from this device (removed, deleted, left elsewhere) loses all of them.
  const crewGone = detail.data === null && !detail.isLoading;
  React.useEffect(() => {
    if (crewGone) void cancelCrewReminders(groupId);
  }, [crewGone, groupId]);
  React.useEffect(() => {
    if (!festival || !detail.data) return;
    void syncMeetupReminders(
      detail.data.meetups.map((meetup) => ({
        id: meetup.id,
        title: meetup.title,
        starts_at: meetup.starts_at,
        place: placeLabel(meetup),
      })),
      { timeZone: festival.timezone, groupId },
    );
  }, [detail.data, festival, groupId, placeLabel]);

  const resolveGroupName = React.useCallback(
    (id: string) => (groups.data ?? []).find((candidate) => candidate.id === id)?.name ?? null,
    [groups.data],
  );

  /** A crew call failed with not_group_member: data-access already purged it locally. */
  const handleRemovedFromCrew = React.useCallback(async () => {
    await stopLocationSharingForGroup(groupId);
    await cancelCrewReminders(groupId);
    await invalidateGroupQueries(queryClient);
    if (selectedGroupId === groupId) setSelectedGroupId(null);
    showToast("You're no longer a member of this crew.");
    router.replace('/(tabs)/group');
  }, [groupId, queryClient, selectedGroupId, setSelectedGroupId]);

  const runCrewAction = React.useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        if (isAppErrorCode(error, 'not_group_member')) {
          await handleRemovedFromCrew();
        } else {
          showToast(toUserMessage(error), 'error');
        }
      }
    },
    [handleRemovedFromCrew],
  );

  /* Invite */

  const shareInvite = React.useCallback(async () => {
    if (!group) return;
    try {
      await Share.share({ message: buildInviteShareMessage(group.name, group.invite_code) });
    } catch {
      // Dismissed.
    }
  }, [group]);

  const confirmRotate = React.useCallback(() => {
    Alert.alert('Get a new invite code?', 'The current code and links stop working. People already in the crew stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'New code',
        onPress: () => {
          setRotating(true);
          void runCrewAction(async () => {
            const code = await rotateInviteCode(groupId);
            await detail.refetch();
            showToast(`New invite code: ${code}`, 'success');
          }).finally(() => setRotating(false));
        },
      },
    ]);
  }, [detail, groupId, runCrewAction]);

  /* Members */

  const confirmBlock = React.useCallback(
    (member: GroupMember) => {
      const name = memberName(member);
      Alert.alert(
        `Block ${name}?`,
        "You won't see their meetups, picks or location, and they won't see your location. They aren't told. You can unblock them here or in Settings.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block',
            style: 'destructive',
            onPress: () => {
              setBusyMemberId(member.user_id);
              void runCrewAction(async () => {
                await blockUser(member.user_id);
                await invalidateAfterBlockChange(queryClient, member.user_id);
                showToast(`${name} is blocked.`);
              }).finally(() => setBusyMemberId(null));
            },
          },
        ],
      );
    },
    [queryClient, runCrewAction],
  );

  const unblock = React.useCallback(
    (member: GroupMember) => {
      setBusyMemberId(member.user_id);
      void runCrewAction(async () => {
        await unblockUser(member.user_id);
        await invalidateAfterBlockChange(queryClient);
        await detail.refetch();
        showToast('Unblocked.');
      }).finally(() => setBusyMemberId(null));
    },
    [detail, queryClient, runCrewAction],
  );

  const confirmRemove = React.useCallback(
    (member: GroupMember) => {
      const name = member.is_blocked ? 'this blocked user' : memberName(member);
      Alert.alert(`Remove ${name} from the crew?`, 'They lose access to the crew, its meetups and members’ locations. They can only rejoin with a new invite.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setBusyMemberId(member.user_id);
            void runCrewAction(async () => {
              await removeGroupMember(groupId, member.user_id);
              await detail.refetch();
              await invalidateGroupQueries(queryClient);
              showToast(member.is_blocked ? 'Removed from the crew.' : `${name} was removed.`);
            }).finally(() => setBusyMemberId(null));
          },
        },
      ]);
    },
    [detail, groupId, queryClient, runCrewAction],
  );

  const memberActions = React.useMemo((): SheetAction[] => {
    if (!memberSheet) return [];
    let actions: SheetAction[];
    if (memberSheet.is_blocked) {
      // Blocked members stay reportable and removable without unblocking (which would bring their content back).
      actions = [
        { label: 'Unblock', hint: 'Their meetups, picks and location show again', onPress: () => unblock(memberSheet) },
        { label: 'Report this user', onPress: () => setReportTarget({ type: 'user', id: memberSheet.user_id, label: 'Report this user' }) },
      ];
    } else {
      const name = memberName(memberSheet);
      actions = [
        { label: `Report ${name}`, onPress: () => setReportTarget({ type: 'user', id: memberSheet.user_id, label: `Report ${name}` }) },
        { label: `Block ${name}`, destructive: true, hint: 'Asks for confirmation', onPress: () => confirmBlock(memberSheet) },
      ];
    }
    if (isAdmin) {
      actions.push({ label: 'Remove from crew', destructive: true, hint: 'Asks for confirmation', onPress: () => confirmRemove(memberSheet) });
    }
    return actions;
  }, [confirmBlock, confirmRemove, isAdmin, memberSheet, unblock]);

  /* Meetups */

  const confirmDeleteMeetup = React.useCallback(
    (meetup: LocalMeetup, asAdmin: boolean) => {
      Alert.alert(
        asAdmin ? 'Remove this meetup?' : 'Delete this meetup?',
        asAdmin ? `"${meetup.title}" and its photo are removed for everyone in the crew.` : `"${meetup.title}" and its photo are deleted for everyone in the crew.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: asAdmin ? 'Remove' : 'Delete',
            style: 'destructive',
            onPress: () =>
              void runCrewAction(async () => {
                await deleteMeetup(meetup.id);
                await cancelReminderForEntity('meetup', meetup.id);
                await invalidateGroupQueries(queryClient);
                showToast('Meetup deleted.');
              }),
          },
        ],
      );
    },
    [queryClient, runCrewAction],
  );

  const meetupActions = React.useMemo((): SheetAction[] => {
    if (!meetupSheet) return [];
    const mine = meetupSheet.created_by_user_id === me;
    if (mine) {
      const actions: SheetAction[] = [];
      if (meetupSheet.pending_sync !== 1) {
        actions.push({
          label: meetupSheet.totem_path ? 'Replace totem photo' : 'Add totem photo',
          onPress: () => void addPhoto(meetupSheet),
        });
      }
      actions.push({ label: 'Delete meetup', destructive: true, hint: 'Asks for confirmation', onPress: () => confirmDeleteMeetup(meetupSheet, false) });
      return actions;
    }
    const actions: SheetAction[] = [
      { label: 'Report meetup', onPress: () => setReportTarget({ type: 'meetup', id: meetupSheet.id, label: 'Report this meetup' }) },
    ];
    if (meetupSheet.totem_path) {
      actions.push({ label: 'Report photo', onPress: () => setReportTarget({ type: 'photo', id: meetupSheet.id, label: 'Report this photo' }) });
    }
    if (isAdmin) {
      actions.push({ label: 'Remove meetup', destructive: true, hint: 'Asks for confirmation', onPress: () => confirmDeleteMeetup(meetupSheet, true) });
    }
    return actions;
  }, [addPhoto, confirmDeleteMeetup, isAdmin, me, meetupSheet]);

  /* Leave */

  const confirmLeave = React.useCallback(() => {
    if (!group) return;
    Alert.alert(
      `Leave ${group.name}?`,
      'You stop sharing your location with this crew and lose its meetups and picks on this device. You can rejoin with an invite code.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            setLeaving(true);
            void (async () => {
              try {
                await stopLocationSharingForGroup(groupId);
                await leaveGroup(groupId);
                await cancelCrewReminders(groupId);
                if (selectedGroupId === groupId) setSelectedGroupId(null);
                await invalidateGroupQueries(queryClient);
                showToast(`You left ${group.name}.`);
                router.replace('/(tabs)/group');
              } catch (error) {
                if (isAppErrorCode(error, 'not_group_member')) {
                  await handleRemovedFromCrew();
                } else {
                  showToast(toUserMessage(error), 'error');
                }
              } finally {
                setLeaving(false);
              }
            })();
          },
        },
      ],
    );
  }, [group, groupId, handleRemovedFromCrew, queryClient, selectedGroupId, setSelectedGroupId]);

  /* Render */

  if (!group) {
    let body: React.ReactNode;
    if (detail.isLoading || (detail.isRefreshing && !detail.hasRefreshed)) {
      body = <LoadingState label="Loading crew…" />;
    } else if (detail.refreshError && !isOffline) {
      body = <ErrorState error={detail.refreshError} onRetry={() => void detail.refetch()} />;
    } else if (detail.hasRefreshed) {
      body = (
        <EmptyState
          title="Not in this crew"
          description="You're no longer a member of this crew, or it was deleted."
          action={<SecondaryButton label="Back to my crews" onPress={() => router.replace('/(tabs)/group')} />}
        />
      );
    } else {
      body = (
        <EmptyState
          title="Not on this device yet"
          description="Connect to the internet to load this crew."
          action={<SecondaryButton label="Back to my crews" onPress={() => router.replace('/(tabs)/group')} />}
        />
      );
    }
    return (
      <View style={styles.container}>
        <SubScreenHeader title="Crew" />
        <View style={styles.statePad}>{body}</View>
      </View>
    );
  }

  const memberCount = members.length;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        refreshControl={
          <RefreshControl refreshing={detail.isRefreshing} onRefresh={() => void detail.refetch()} tintColor={colors.textPrimary} />
        }
      >
        <SubScreenHeader
          title={group.name}
          label={[festival?.name, `${memberCount} member${memberCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ').toUpperCase()}
        />

        <View style={styles.inner}>
          {/* Invite */}
          <View style={styles.card}>
            <View style={styles.codeRow}>
              <Text style={styles.sectionLabel}>INVITE CODE</Text>
              <View style={styles.codePill} accessible accessibilityLabel={`Invite code ${group.invite_code.split('').join(' ')}`}>
                <Text style={styles.codeValue}>{group.invite_code}</Text>
              </View>
            </View>
            <SecondaryButton label="Share invite" onPress={() => void shareInvite()} />
            {isAdmin ? (
              <TextLink label={rotating ? 'Getting a new code…' : 'Get a new code'} onPress={confirmRotate} accessibilityLabel="Get a new invite code" />
            ) : null}
          </View>

          {/* Quick actions */}
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Crew schedule"
              style={({ pressed }) => [styles.actionButton, styles.actionButtonPrimary, pressed && styles.pressed]}
              onPress={() => router.push(`/(tabs)/group/${groupId}/schedule`)}
            >
              <Text style={styles.actionButtonLabel}>📅 Crew Schedule</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New meetup"
              style={({ pressed }) => [styles.actionButton, styles.actionButtonSecondary, pressed && styles.pressed]}
              onPress={() => router.push(`/(tabs)/group/${groupId}/meetup/create`)}
            >
              <Text style={styles.actionButtonLabel}>📍 Meetup</Text>
            </Pressable>
          </View>

          <LocationSharingCard groupId={groupId} groupName={group.name} resolveGroupName={resolveGroupName} />

          {/* Meetups */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel} accessibilityRole="header">
              UPCOMING MEETUPS
            </Text>
            {festival ? null : <Text style={styles.mutedText}>Times appear once the festival is downloaded.</Text>}
            {upcoming.length === 0 ? (
              <Text style={styles.mutedText}>No upcoming meetups — tap Meetup to plan one.</Text>
            ) : (
              upcoming.map((meetup) => (
                <MeetupCard
                  key={meetup.id}
                  meetup={meetup}
                  clock={clock}
                  placeLabel={placeLabel(meetup)}
                  creatorName={membersById.get(meetup.created_by_user_id)?.user?.display_name ?? 'a crew member'}
                  isMine={meetup.created_by_user_id === me}
                  uploading={uploadingId === meetup.id}
                  onMore={() => setMeetupSheet(meetup)}
                  onReportPhoto={() => setReportTarget({ type: 'photo', id: meetup.id, label: 'Report this photo' })}
                  onAddPhoto={() => void addPhoto(meetup)}
                />
              ))
            )}
            {earlier.length > 0 ? (
              <TextLink
                label={showEarlier ? 'Hide earlier meetups' : `Show earlier meetups (${earlier.length})`}
                onPress={() => setShowEarlier((value) => !value)}
              />
            ) : null}
            {showEarlier
              ? earlier.map((meetup) => (
                  <MeetupCard
                    key={meetup.id}
                    meetup={meetup}
                    clock={clock}
                    placeLabel={placeLabel(meetup)}
                    creatorName={membersById.get(meetup.created_by_user_id)?.user?.display_name ?? 'a crew member'}
                    isMine={meetup.created_by_user_id === me}
                    uploading={uploadingId === meetup.id}
                    onMore={() => setMeetupSheet(meetup)}
                    onReportPhoto={() => setReportTarget({ type: 'photo', id: meetup.id, label: 'Report this photo' })}
                    onAddPhoto={() => void addPhoto(meetup)}
                  />
                ))
              : null}
          </View>

          {/* Members */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel} accessibilityRole="header">
              MEMBERS · {memberCount}
            </Text>
            {members.map((member) => {
              const isMe = member.user_id === me;
              return (
                <MemberRow
                  key={member.id}
                  member={member}
                  isMe={isMe}
                  busy={busyMemberId === member.user_id}
                  onPress={isMe ? undefined : () => setMemberSheet(member)}
                />
              );
            })}
          </View>

          <StaleDataNote error={detail.refreshError} />

          {/* Leave / report */}
          <View style={styles.dangerZone}>
            <TextLink
              label="Report this crew"
              onPress={() => setReportTarget({ type: 'group', id: group.id, label: 'Report this crew' })}
            />
            <DestructiveButton label="Leave crew" onPress={confirmLeave} loading={leaving} />
          </View>
        </View>
      </ScrollView>

      <ActionSheet
        visible={memberSheet !== null}
        title={memberSheet ? memberName(memberSheet) : undefined}
        message={memberSheet?.is_blocked ? "You blocked this user. You don't see their meetups, picks or location, and they aren't told." : undefined}
        actions={memberActions}
        onClose={() => setMemberSheet(null)}
      />
      <ActionSheet
        visible={meetupSheet !== null}
        title={meetupSheet?.title}
        actions={meetupActions}
        onClose={() => setMeetupSheet(null)}
      />
      <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  statePad: { padding: spacing.lg },
  scroll: { flex: 1 },
  inner: { gap: spacing.md, paddingHorizontal: spacing.lg },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },

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
    gap: spacing.md,
  },
  sectionLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 2 },
  mutedText: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },

  codeRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  codePill: { backgroundColor: '#F0F4FF', borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  codeValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', letterSpacing: 3 },

  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.xl,
    minHeight: layout.minTouchTarget + 12,
    paddingHorizontal: spacing.md,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  actionButtonPrimary: { backgroundColor: colors.primary },
  actionButtonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderCard },
  actionButtonLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },

  memberRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 60,
    paddingTop: spacing.sm,
  },
  memberInfo: { flex: 1, gap: 4, alignItems: 'flex-start' },
  memberName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  memberNameMuted: { color: colors.textSecondary, fontStyle: 'italic' },
  chevron: { color: colors.textSecondary, fontSize: 24, fontWeight: '300' },
  blockedAction: { color: colors.link, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },

  meetupCard: { borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.sm, paddingTop: spacing.md },
  meetupHeader: { flexDirection: 'row', gap: spacing.md },
  meetupDot: { backgroundColor: colors.primary, borderRadius: 5, height: 10, marginTop: 6, width: 10 },
  meetupInfo: { flex: 1, gap: 3, alignItems: 'flex-start' },
  meetupTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  meetupTime: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  meetupPlace: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  meetupBy: { color: colors.textSecondary, fontSize: 12 },
  meetupNotes: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },

  dangerZone: { gap: spacing.md, paddingTop: spacing.sm },
});
