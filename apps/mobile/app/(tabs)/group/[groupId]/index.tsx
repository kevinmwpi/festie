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
  continuous,
  deriveAccentColors,
  DestructiveButton,
  elevation,
  EmptyState,
  IconButton,
  layout,
  PressableScale,
  radii,
  SecondaryButton,
  showToast,
  spacing,
  tabularNums,
  TextLink,
  textStyles,
  upright,
  useOfflineStatus,
} from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
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
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

/** Meetups that started more than this long ago move under "Earlier". */
const MEETUP_GRACE_MS = 60 * 60 * 1000;

/** Edge of the member avatars (the `Avatar` default); row separators start where the name does. */
const MEMBER_AVATAR_SIZE = 44;

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
        <Text style={[styles.memberName, member.is_blocked && styles.memberNameMuted]} numberOfLines={3}>
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
      style={({ pressed }) => [styles.memberRow, pressed && styles.memberRowPressed]}
    >
      {content}
      {busy ? (
        <ActivityIndicator color={member.is_blocked ? colors.link : colors.textPrimary} />
      ) : member.is_blocked ? (
        <Text style={styles.blockedAction}>Unblock</Text>
      ) : (
        <Ionicons
          name="chevron-forward"
          size={17}
          color={colors.textTertiary}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
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
  const whenSpoken = clock.timeZone ? `${clock.date(meetup.starts_at)}, ${clock.time(meetup.starts_at)}` : null;
  const byLine = isMine ? 'Created by you' : `By ${creatorName}`;
  // One VoiceOver stop for the meetup's facts; the options button, notes and photo controls stay separate.
  const infoLabel = [meetup.title, whenSpoken, placeLabel, byLine, meetup.pending_sync === 1 ? 'Waiting to sync' : null]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={styles.meetupCard}>
      <View style={styles.meetupHeader}>
        {/* The slot is one title line tall, so the dot centres on the title's first line. */}
        <View style={styles.meetupDotSlot}>
          <View style={styles.meetupDot} />
        </View>
        <View style={styles.meetupInfo} accessible accessibilityLabel={infoLabel}>
          <Text style={styles.meetupTitle}>{meetup.title}</Text>
          {when ? <Text style={styles.meetupTime}>{when}</Text> : null}
          {placeLabel ? <Text style={styles.meetupPlace}>{placeLabel}</Text> : null}
          <Text style={styles.meetupBy}>{byLine}</Text>
          {meetup.pending_sync === 1 ? <Badge label="Waiting to sync" /> : null}
        </View>
        <IconButton
          icon={<Ionicons name="ellipsis-horizontal" size={20} color={colors.textPrimary} />}
          accessibilityLabel={`Options for ${meetup.title}`}
          onPress={onMore}
        />
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
  const activeFestivalAccent = useAppStore((state) => state.activeFestivalAccent);
  const screenBg = deriveAccentColors(festival?.accent_color || activeFestivalAccent).bgTint;
  useSafeAreaEdgeTint(screenBg);
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
      <View style={[styles.container, { backgroundColor: screenBg }]}>
        <SubScreenHeader title="Crew" />
        <View style={styles.statePad}>{body}</View>
      </View>
    );
  }

  const memberCount = members.length;

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        refreshControl={
          <RefreshControl refreshing={detail.isRefreshing} onRefresh={() => void detail.refetch()} tintColor={colors.textPrimary} />
        }
      >
        <SubScreenHeader
          title={group.name}
          label={[festival?.name, `${memberCount} member${memberCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
        />

        <View style={styles.inner}>
          {/* Invite */}
          <View style={styles.card}>
            <View style={styles.codeRow}>
              <Text style={styles.sectionHeader} accessibilityRole="header">
                Invite code
              </Text>
              <View style={styles.codePill} accessible accessibilityLabel={`Invite code ${group.invite_code.split('').join(' ')}`}>
                {/* One line at every text size: a wrap would split the code mid-word and read as a different
                    code, so at the largest sizes it shrinks to fit instead. The pill's label has the full code. */}
                <Text style={styles.codeValue} numberOfLines={1} adjustsFontSizeToFit>
                  {group.invite_code}
                </Text>
              </View>
            </View>
            <SecondaryButton label="Share invite" onPress={() => void shareInvite()} />
            {isAdmin ? (
              <TextLink
                label={rotating ? 'Getting a new code…' : 'Get a new code'}
                busy={rotating}
                onPress={confirmRotate}
                accessibilityLabel="Get a new invite code"
                role="button"
              />
            ) : null}
          </View>

          {/* Quick actions */}
          <View style={styles.actionRow}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Crew schedule"
              style={[styles.actionButton, styles.actionButtonPrimary]}
              onPress={() => router.push(`/(tabs)/group/${groupId}/schedule`)}
            >
              <Ionicons name="calendar-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.actionButtonLabel}>Crew schedule</Text>
            </PressableScale>
            {/* "Meetup" is the word the empty-meetups line below tells people to tap: keep the two in step. */}
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="New meetup"
              style={[styles.actionButton, styles.actionButtonSecondary]}
              onPress={() => router.push(`/(tabs)/group/${groupId}/meetup/create`)}
            >
              <Ionicons name="location-outline" size={20} color={colors.link} />
              <Text style={[styles.actionButtonLabel, styles.actionButtonLabelSecondary]}>Meetup</Text>
            </PressableScale>
          </View>

          <LocationSharingCard groupId={groupId} groupName={group.name} resolveGroupName={resolveGroupName} />

          {/* Meetups */}
          <View style={styles.card}>
            <Text style={styles.sectionHeader} accessibilityRole="header">
              Upcoming meetups
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
                role="button"
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
            <Text style={[styles.sectionHeader, tabularNums]} accessibilityRole="header">
              Members · {memberCount}
            </Text>
            <View>
              {members.map((member, index) => {
                const isMe = member.user_id === me;
                return (
                  <React.Fragment key={member.id}>
                    {index > 0 ? <View style={styles.memberSeparator} /> : null}
                    <MemberRow
                      member={member}
                      isMe={isMe}
                      busy={busyMemberId === member.user_id}
                      onPress={isMe ? undefined : () => setMemberSheet(member)}
                    />
                  </React.Fragment>
                );
              })}
            </View>
          </View>

          <StaleDataNote error={detail.refreshError} />

          {/* Leave / report */}
          <View style={styles.dangerZone}>
            <TextLink
              label="Report this crew"
              onPress={() => setReportTarget({ type: 'group', id: group.id, label: 'Report this crew' })}
              role="button"
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
  /* The festival wash (`screenBg`) is applied inline; it is translucent over the Stack's `colors.background`. */
  container: { flex: 1 },
  statePad: { padding: layout.screenGutter },
  scroll: { flex: 1 },
  inner: { gap: spacing.md, paddingHorizontal: layout.screenGutter },

  card: {
    ...continuous,
    ...elevation.card,
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: layout.cardPadding,
  },
  sectionHeader: { ...textStyles.footnote, color: colors.textSecondary, fontWeight: '600' },
  mutedText: { ...textStyles.subheadline, color: colors.textSecondary },

  codeRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  codePill: { backgroundColor: colors.inputBg, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  codeValue: { ...textStyles.title3, ...upright, ...tabularNums, color: colors.textPrimary, fontWeight: '700', letterSpacing: 3 },

  /* Quick actions: flat, like buttons */
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionButton: {
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
  actionButtonPrimary: { backgroundColor: colors.primary },
  /* Matches the shared SecondaryButton: tinted fill, `link` label. */
  actionButtonSecondary: { backgroundColor: colors.tintedFill },
  actionButtonLabel: { ...textStyles.headline, color: colors.textPrimary, flexShrink: 1, textAlign: 'center' },
  actionButtonLabelSecondary: { color: colors.link },

  /* Member rows run edge to edge inside the card so the pressed highlight spans its full width. */
  memberRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.ms,
    marginHorizontal: -layout.cardPadding,
    minHeight: layout.minTouchTarget,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.sm,
  },
  memberRowPressed: { backgroundColor: colors.fill },
  memberSeparator: {
    backgroundColor: colors.separator,
    height: StyleSheet.hairlineWidth,
    marginLeft: MEMBER_AVATAR_SIZE + spacing.ms,
    marginRight: -layout.cardPadding,
  },
  memberInfo: { alignItems: 'flex-start', flex: 1, gap: spacing.xs },
  memberName: { ...textStyles.headline, color: colors.textPrimary },
  memberNameMuted: { color: colors.textSecondary },
  blockedAction: { ...textStyles.subheadline, color: colors.link, fontWeight: '600' },

  meetupCard: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.sm, paddingTop: spacing.md },
  meetupHeader: { flexDirection: 'row', gap: spacing.md },
  meetupDotSlot: { height: textStyles.headline.lineHeight, justifyContent: 'center' },
  meetupDot: { backgroundColor: colors.primary, borderRadius: radii.pill, height: spacing.ms, width: spacing.ms },
  meetupInfo: { alignItems: 'flex-start', flex: 1, gap: spacing.xxs },
  meetupTitle: { ...textStyles.headline, color: colors.textPrimary },
  meetupTime: { ...textStyles.footnote, ...tabularNums, color: colors.textSecondary, fontWeight: '600' },
  meetupPlace: { ...textStyles.footnote, color: colors.textPrimary, fontWeight: '600' },
  meetupBy: { ...textStyles.caption1, color: colors.textSecondary },
  meetupNotes: { ...textStyles.subheadline, color: colors.textSecondary },

  dangerZone: { gap: spacing.md, paddingTop: spacing.sm },
});
