import {
  getGroupLocations,
  getLocalMeetups,
  isAppErrorCode,
  refreshGroupDetail,
  type FestivalBundle,
  type FriendLocation,
  type GroupSummary,
  type LocalMeetup,
} from '@festival/data-access';
import {
  getFestivalCamera,
  getMeetupCoordinate,
  getNextStageSet,
  getStageCoordinate,
  indexStagesById,
  type LngLat,
} from '@festival/map-utils';
import {
  Chip,
  colors,
  deriveAccentColors,
  EmptyState,
  IconButton,
  layout,
  radii,
  showToast,
  spacing,
  useOfflineStatus,
} from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import Mapbox from '@rnmapbox/maps';
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/src/components/Avatar';
import { ActionSheet, type SheetAction } from '@/src/components/BottomSheet';
import { TimeZoneHint } from '@/src/components/FestivalNotes';
import { LocationSharingCard } from '@/src/components/LocationSharingCard';
import { LocationSharingSheet } from '@/src/components/LocationSharingSheet';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { FestivalBundleState, NoFestivalState, StaleDataNote } from '@/src/components/StateViews';
import { isMapboxConfigured } from '@/src/config/app-info';
import { invalidateGroupQueries, queryKeys } from '@/src/hooks/query-keys';
import { useCacheFirstQuery } from '@/src/hooks/use-cache-first-query';
import { useActiveFestival, useFestivalClock, type FestivalClock } from '@/src/hooks/use-festival';
import { useGroups } from '@/src/hooks/use-groups';
import { formatAgo, useNow } from '@/src/hooks/use-now';
import { OFFLINE_MAP_STYLE, useOfflinePack, type OfflinePackState } from '@/src/hooks/use-offline-pack';
import { useUserKey } from '@/src/hooks/use-session';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { visibleFriendLocations, withDeviceClockTimes, type DeviceTimed } from '@/src/location/friend-visibility';
import { cancelCrewReminders } from '@/src/notifications/crew-reminders';
import { restoreMeetupReminders } from '@/src/notifications/restore-reminders';
import { STOP_NOT_CONFIRMED_MESSAGE, useLocationSharing } from '@/src/location/LocationSharingProvider';
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

const FRIEND_POLL_MS = 30_000;
const NO_MEETUPS: LocalMeetup[] = [];
const NO_FRIENDS: Array<DeviceTimed<FriendLocation>> = [];

/* ─── Data ──────────────────────────────────────────────── */

/** Crews for the active festival and the one the map focuses on (store selection, else the first). */
function useMapGroup(festivalId: string | null) {
  const groups = useGroups();
  const selectedGroupId = useAppStore((state) => state.selectedGroupId);
  const setSelectedGroupId = useAppStore((state) => state.setSelectedGroupId);
  const festivalGroups = React.useMemo(
    () => (groups.data ?? []).filter((group) => group.festival_id === festivalId),
    [festivalId, groups.data],
  );
  const group = festivalGroups.find((candidate) => candidate.id === selectedGroupId) ?? festivalGroups[0] ?? null;
  return { groups: festivalGroups, allGroups: groups.data ?? [], group, select: setSelectedGroupId };
}

/**
 * Whether foreground location is granted (never prompts), so the own-location dot shows only with
 * access (§5.6). Re-checked on focus, when the app returns to the foreground (a change in iOS Settings,
 * an expired "Allow Once") and when the sharing status changes (a grant from the sharing sheet).
 */
function useLocationGranted(sharingStatus: string): boolean {
  const [granted, setGranted] = React.useState(false);
  const latestCheck = React.useRef(0);
  const check = React.useCallback(() => {
    const id = ++latestCheck.current;
    void Location.getForegroundPermissionsAsync()
      .then((permission) => {
        if (id === latestCheck.current) setGranted(permission.granted);
      })
      .catch(() => undefined);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      check();
      return () => {
        // Ignore a check still in flight when the screen loses focus.
        latestCheck.current += 1;
      };
    }, [check]),
  );
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, [check]);
  React.useEffect(() => {
    check();
  }, [check, sharingStatus]);
  return granted;
}

/** Friends' positions, polled every 30 s only while this screen is focused and online. */
function useFriendLocations(groupId: string | null) {
  const userKey = useUserKey();
  const queryClient = useQueryClient();
  const [focused, setFocused] = React.useState(false);
  useFocusEffect(
    React.useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const query = useQuery({
    queryKey: queryKeys.friendLocations(userKey, groupId ?? 'none'),
    queryFn: async () => {
      try {
        const rows = await getGroupLocations(groupId!);
        // Ages on the device clock, so a phone set fast or slow neither hides fresh positions nor
        // keeps old ones (see friend-visibility.ts).
        return withDeviceClockTimes(rows, Date.now());
      } catch (error) {
        if (isAppErrorCode(error, 'not_group_member')) {
          // data-access purged the crew locally; drop its reminders and refresh the crew lists.
          await cancelCrewReminders(groupId!);
          await invalidateGroupQueries(queryClient);
          return [];
        }
        throw error;
      }
    },
    enabled: focused && Boolean(groupId),
    refetchInterval: focused ? FRIEND_POLL_MS : false,
    refetchIntervalInBackground: false,
    networkMode: 'online',
    staleTime: 0,
    retry: false,
  });
  return query;
}

function useMeetups(groupId: string | null) {
  const userKey = useUserKey();
  return useCacheFirstQuery<LocalMeetup[]>({
    queryKey: queryKeys.meetups(userKey, groupId ?? 'none'),
    readLocal: () => (groupId ? getLocalMeetups(groupId) : Promise.resolve([])),
    refresh: groupId
      ? async () => {
          if ((await refreshGroupDetail(groupId)) !== null) void restoreMeetupReminders([groupId]);
        }
      : undefined,
    enabled: Boolean(groupId),
    refreshStaleTime: 2 * 60_000,
  });
}

/* ─── Pins ──────────────────────────────────────────────── */

function StagePin({ name, nextLabel, accent }: { name: string; nextLabel: string | null; accent: string }) {
  return (
    <View style={[styles.stagePin, { borderColor: accent }]} accessible accessibilityLabel={`Stage ${name}${nextLabel ? `, next: ${nextLabel}` : ''}`}>
      <View style={styles.stagePinRow}>
        <View style={[styles.stageDot, { backgroundColor: accent }]} />
        <Text style={styles.stagePinText} numberOfLines={1}>
          {name}
        </Text>
      </View>
      {nextLabel ? (
        <Text style={styles.stagePinTime} numberOfLines={1}>
          {nextLabel}
        </Text>
      ) : null}
    </View>
  );
}

function MeetupPin({ title, time }: { title: string; time: string }) {
  return (
    <View style={styles.meetupPin} accessible accessibilityLabel={`Meetup ${title} at ${time}`}>
      <Ionicons name="location" size={14} color={colors.textPrimary} />
      <Text style={styles.meetupPinText} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.meetupPinTime}>{time}</Text>
    </View>
  );
}

function FriendPin({ friend, ago, accent }: { friend: FriendLocation; ago: string; accent: string }) {
  return (
    <View style={styles.friendPin} accessible accessibilityLabel={`${friend.display_name}, last seen ${ago}`}>
      <View style={[styles.friendRing, { borderColor: accent }]}>
        <Avatar name={friend.display_name} avatarType={friend.avatar_type} avatarValue={friend.avatar_value} size={34} />
      </View>
      <View style={styles.friendLabel}>
        <Text style={styles.friendLabelText} numberOfLines={1}>
          {friend.display_name.split(' ')[0]} · {ago}
        </Text>
      </View>
    </View>
  );
}

/* ─── Controls ──────────────────────────────────────────── */

function offlinePackLabel(state: OfflinePackState, isOffline: boolean): string | null {
  switch (state.kind) {
    case 'none':
      return isOffline ? null : 'Save map offline';
    case 'downloading':
      return `Saving map… ${state.percent}%`;
    case 'paused':
      return `Map ${state.percent}% saved · paused`;
    case 'complete':
      return 'Map saved offline';
    case 'error':
      return isOffline ? 'Offline map failed' : 'Retry offline map';
    case 'checking':
      return 'Checking offline map…';
    default:
      return null;
  }
}

function ControlPill({
  label,
  icon,
  active,
  busy,
  onPress,
  accessibilityHint,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active?: boolean;
  busy?: boolean;
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.pill, active && styles.pillActive, pressed && { opacity: 0.85 }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Ionicons name={icon} size={14} color={colors.textPrimary} />}
      <Text style={styles.pillLabel}>{label}</Text>
    </Pressable>
  );
}

function GroupChips({ groups, selectedId, onSelect, accent }: { groups: GroupSummary[]; selectedId: string | null; onSelect: (id: string) => void; accent: string }) {
  if (groups.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={styles.groupChips}>
      {groups.map((group) => (
        <Chip key={group.id} label={group.name} active={group.id === selectedId} accentColor={accent} onPress={() => onSelect(group.id)} />
      ))}
    </ScrollView>
  );
}

/* ─── Fallback (no map) ─────────────────────────────────── */

function FallbackLists({
  bundle,
  meetups,
  friends,
  clock,
  now,
  group,
  hasGroups,
  stageLabel,
}: {
  bundle: FestivalBundle;
  meetups: LocalMeetup[];
  friends: Array<DeviceTimed<FriendLocation>>;
  clock: FestivalClock;
  now: number;
  group: GroupSummary | null;
  hasGroups: boolean;
  stageLabel: (stageId: string | null) => string | null;
}) {
  const stages = [...bundle.stages].sort((left, right) => left.name.localeCompare(right.name));
  const artistsById = new Map(bundle.artists.map((artist) => [artist.id, artist.name]));
  const upcomingMeetups = meetups.filter((meetup) => Date.parse(meetup.starts_at) >= now - 60 * 60_000);

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionLabel} accessibilityRole="header">
          STAGES · NEXT UP
        </Text>
        {stages.length === 0 ? <Text style={styles.muted}>Stages appear once the festival publishes them.</Text> : null}
        {stages.map((stage) => {
          const next = getNextStageSet(stage.id, bundle.sets, new Date(now));
          return (
            <View key={stage.id} style={styles.listRow}>
              <View style={[styles.listIcon, { backgroundColor: '#F0F4FF' }]}>
                <Ionicons name="flag-outline" size={18} color={colors.textPrimary} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>{stage.name}</Text>
                <Text style={styles.listSub}>
                  {next
                    ? `Next: ${artistsById.get(next.artist_id) ?? 'TBA'} · ${clock.day(next.start_time)} ${clock.time(next.start_time)}${next.status === 'moved' ? ' (moved)' : ''}`
                    : bundle.sets.length === 0
                      ? 'Set times to be announced'
                      : 'No more sets'}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel} accessibilityRole="header">
          {group ? `MEETUPS · ${group.name.toUpperCase()}` : 'MEETUPS'}
        </Text>
        {!hasGroups ? (
          <Text style={styles.muted}>Join or create a crew to plan meetups.</Text>
        ) : upcomingMeetups.length === 0 ? (
          <Text style={styles.muted}>No upcoming meetups.</Text>
        ) : (
          upcomingMeetups.map((meetup) => (
            <View key={meetup.id} style={styles.listRow}>
              <View style={[styles.listIcon, { backgroundColor: colors.successBg }]}>
                <Ionicons name="location-outline" size={18} color={colors.textPrimary} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>{meetup.title}</Text>
                <Text style={styles.listSub}>
                  {[`${clock.date(meetup.starts_at, { weekday: 'short' })} ${clock.time(meetup.starts_at)}`, stageLabel(meetup.stage_id)]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      {group ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel} accessibilityRole="header">
            FRIENDS SHARING
          </Text>
          {friends.length === 0 ? (
            <Text style={styles.muted}>No one in {group.name} is sharing their location right now.</Text>
          ) : (
            friends.map((friend) => (
              <View key={friend.user_id} style={styles.listRow}>
                <Avatar name={friend.display_name} avatarType={friend.avatar_type} avatarValue={friend.avatar_value} />
                <View style={styles.listText}>
                  <Text style={styles.listTitle}>{friend.display_name}</Text>
                  <Text style={styles.listSub}>Last seen {formatAgo(friend.seen_at, now)}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}
    </>
  );
}

/* ─── Screen ────────────────────────────────────────────── */

export default function MapScreen() {
  const tabBarClearance = useTabBarClearance();
  const { festivalId, accent, bundle, festival } = useActiveFestival();
  const screenBg = deriveAccentColors(accent).bgTint;
  useSafeAreaEdgeTint(screenBg);
  const solidAccent = deriveAccentColors(accent).solid;
  const clock = useFestivalClock(festival);
  const isOffline = useOfflineStatus();
  const now = useNow(30_000);
  const sharing = useLocationSharing();
  const locationGranted = useLocationGranted(sharing.status);

  const { groups, allGroups, group, select } = useMapGroup(festivalId);
  const meetupsQuery = useMeetups(group?.id ?? null);
  const friendsQuery = useFriendLocations(group?.id ?? null);
  const meetups = meetupsQuery.data ?? NO_MEETUPS;
  // The last poll stays cached offline or after an error: never show a position past its 15 minutes.
  const friendsData = friendsQuery.data ?? NO_FRIENDS;
  const friends = React.useMemo(() => visibleFriendLocations(friendsData, now), [friendsData, now]);

  const camera = festival ? getFestivalCamera(festival) : null;
  const showMap = isMapboxConfigured() && camera !== null;
  const offlinePack = useOfflinePack(festival, showMap);
  const cameraRef = React.useRef<Mapbox.Camera>(null);

  const [sheetVisible, setSheetVisible] = React.useState(false);
  const [controlsSheet, setControlsSheet] = React.useState<'sharing' | 'offline' | null>(null);
  // The offline-map sheet only describes a saved, paused or failed pack. When the pack moves on
  // underneath it (a reconnect resumes the download, a remove finishes), close it rather than leave
  // copy that no longer matches the pill.
  const packKind = offlinePack.state.kind;
  const packSheetApplies = packKind === 'complete' || packKind === 'paused' || packKind === 'error';
  React.useEffect(() => {
    if (!packSheetApplies) {
      setControlsSheet((current) => (current === 'offline' ? null : current));
    }
  }, [packSheetApplies]);

  const stagesById = React.useMemo(() => indexStagesById(bundle.data?.stages ?? []), [bundle.data]);
  const artistsById = React.useMemo(() => new Map((bundle.data?.artists ?? []).map((artist) => [artist.id, artist.name])), [bundle.data]);
  const stageLabel = React.useCallback((stageId: string | null) => (stageId ? (stagesById.get(stageId)?.name ?? null) : null), [stagesById]);

  const resolveGroupName = React.useCallback((id: string) => allGroups.find((candidate) => candidate.id === id)?.name ?? null, [allGroups]);
  const sharingHere = group !== null && sharing.groupId === group.id && sharing.status !== 'off';
  const otherGroupName = sharing.groupId && group && sharing.groupId !== group.id ? (resolveGroupName(sharing.groupId) ?? 'another crew') : null;

  const header = <ScreenHeader crumbs={['Map', festival?.name]} />;

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

  if (!bundle.data || !festival) {
    return (
      <View style={[styles.container, { backgroundColor: screenBg }]}>
        {header}
        <View style={styles.statePad}>
          <FestivalBundleState
            hasBundle={false}
            isLoading={bundle.isLoading}
            isRefreshing={bundle.isRefreshing}
            hasRefreshed={bundle.hasRefreshed}
            refreshError={bundle.refreshError}
            isOffline={isOffline}
            onRetry={() => void bundle.refetch()}
          />
        </View>
      </View>
    );
  }

  /* No token or no coordinates: list view, no fake map. */
  if (!showMap || !camera) {
    return (
      <View style={[styles.container, { backgroundColor: screenBg }]}>
        {header}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]}
          refreshControl={
            <RefreshControl
              refreshing={meetupsQuery.isRefreshing}
              onRefresh={() => void Promise.all([bundle.refetch(), meetupsQuery.refetch(), friendsQuery.refetch()])}
              tintColor={colors.textPrimary}
            />
          }
        >
          <EmptyState
            title="Map view unavailable"
            description={
              camera === null
                ? "This festival hasn't published map coordinates yet. Here's what's on and where your crew is."
                : "The map can't be shown right now. Here's what's on and where your crew is."
            }
          />
          <GroupChips groups={groups} selectedId={group?.id ?? null} onSelect={select} accent={accent} />
          <TimeZoneHint hint={clock.hint} />
          <FallbackLists
            bundle={bundle.data}
            meetups={meetups}
            friends={friends}
            clock={clock}
            now={now}
            group={group}
            hasGroups={groups.length > 0}
            stageLabel={stageLabel}
          />
          {group ? <LocationSharingCard groupId={group.id} groupName={group.name} resolveGroupName={resolveGroupName} /> : null}
          <StaleDataNote error={meetupsQuery.refreshError ?? friendsQuery.error} />
        </ScrollView>
      </View>
    );
  }

  /* Live map */

  const stagePins = bundle.data.stages
    .map((stage) => {
      const coordinate = getStageCoordinate(stage);
      if (!coordinate) return null;
      const next = getNextStageSet(stage.id, bundle.data!.sets, new Date(now));
      const nextLabel = next
        ? `${artistsById.get(next.artist_id) ?? 'Next'} · ${clock.timeFrom(next.start_time, now)}${next.status === 'moved' ? ' (moved)' : ''}`
        : null;
      return { id: stage.id, name: stage.name, coordinate, nextLabel };
    })
    .filter((pin): pin is { id: string; name: string; coordinate: LngLat; nextLabel: string | null } => pin !== null);

  const meetupPins = meetups
    .filter((meetup) => Date.parse(meetup.starts_at) >= now - 60 * 60_000)
    .map((meetup) => {
      const coordinate = getMeetupCoordinate(meetup, stagesById);
      return coordinate ? { meetup, coordinate } : null;
    })
    .filter((pin): pin is { meetup: LocalMeetup; coordinate: LngLat } => pin !== null);

  const recenter = () => {
    if (camera.bounds) {
      cameraRef.current?.fitBounds(camera.bounds.ne, camera.bounds.sw, 40, 600);
    } else {
      cameraRef.current?.setCamera({ centerCoordinate: camera.center, zoomLevel: camera.zoom, animationDuration: 600 });
    }
  };

  let sharingLabel = 'Share location';
  if (sharingHere) {
    sharingLabel = sharing.status === 'permission_denied' ? 'Location access off' : sharing.status === 'paused' ? 'Sharing paused' : 'Sharing location';
  } else if (otherGroupName) {
    sharingLabel = `Sharing with ${otherGroupName}`;
  }

  const onSharingPress = () => {
    if (!group) return;
    if (sharingHere) {
      setControlsSheet('sharing');
    } else {
      setSheetVisible(true);
    }
  };

  const packLabel = offlinePackLabel(offlinePack.state, isOffline);
  const onPackPress = () => {
    const kind = offlinePack.state.kind;
    if (kind === 'none') {
      if (!onlineManager.isOnline()) return;
      void offlinePack.download();
    } else if (kind === 'complete' || kind === 'error' || kind === 'paused') {
      setControlsSheet('offline');
    }
  };

  const packState = offlinePack.state;
  const offlineSheetMessage =
    packState.kind === 'error'
      ? `${packState.message}${isOffline ? '' : ' You can also remove what was saved.'}`
      : packState.kind === 'paused'
        ? `Part of the festival area is saved. Saving continues when you're back online.`
        : packState.kind === 'complete'
          ? packState.updateAvailable
            ? "The festival area is saved on this device, so the map works without signal. A newer map downloads when you're back online."
            : 'The festival area is saved on this device, so the map works without signal.'
          : undefined;
  const offlineSheetActions: SheetAction[] = [
    ...((packState.kind === 'error' || packState.kind === 'paused') && !isOffline
      ? [{ label: packState.kind === 'error' ? 'Try again' : 'Continue saving', onPress: () => void offlinePack.download() }]
      : []),
    { label: 'Remove offline map', destructive: true, hint: 'Deletes the saved map from this device', onPress: () => void offlinePack.remove() },
  ];

  const controlActions: SheetAction[] =
    controlsSheet === 'sharing'
      ? [
          ...(sharing.status === 'permission_denied'
            ? [
                sharing.canAskAgain
                  ? {
                      // Neutral label (App Review 5.1.1): the iOS permission prompt follows this tap.
                      label: 'Turn location back on',
                      hint: 'iOS asks for location access next',
                      onPress: () => void sharing.requestAccess(),
                    }
                  : { label: 'Open Settings', onPress: () => void Linking.openSettings() },
              ]
            : []),
          {
            label: 'Stop sharing my location',
            destructive: true,
            onPress: () =>
              void sharing.stop().then((removed) => {
                if (!removed) showToast(STOP_NOT_CONFIRMED_MESSAGE, 'error');
              }),
          },
        ]
      : controlsSheet === 'offline'
        ? offlineSheetActions
        : [];

  return (
    <View style={styles.container}>
      {/* Screens run to the bottom edge of the display, so the map fills it, under the floating tab bar
          and the home indicator. */}
      <Mapbox.MapView
        style={styles.map}
        styleURL={OFFLINE_MAP_STYLE}
        scaleBarEnabled={false}
        logoPosition={{ bottom: tabBarClearance + 4, left: 12 }}
        attributionPosition={{ bottom: tabBarClearance + 4, right: 12 }}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={
            camera.bounds
              ? { bounds: { ne: camera.bounds.ne, sw: camera.bounds.sw, paddingTop: 140, paddingBottom: 160, paddingLeft: 24, paddingRight: 24 } }
              : { centerCoordinate: camera.center, zoomLevel: camera.zoom }
          }
        />
        {locationGranted ? <Mapbox.UserLocation visible showsUserHeadingIndicator={false} /> : null}

        {stagePins.map((pin) => (
          <Mapbox.MarkerView key={`stage-${pin.id}`} coordinate={pin.coordinate} anchor={{ x: 0.5, y: 1 }} allowOverlap>
            <StagePin name={pin.name} nextLabel={pin.nextLabel} accent={solidAccent} />
          </Mapbox.MarkerView>
        ))}

        {meetupPins.map((pin) => (
          <Mapbox.MarkerView key={`meetup-${pin.meetup.id}`} coordinate={pin.coordinate} anchor={{ x: 0.5, y: 1 }} allowOverlap>
            <MeetupPin title={pin.meetup.title} time={clock.timeFrom(pin.meetup.starts_at, now)} />
          </Mapbox.MarkerView>
        ))}

        {friends.map((friend) => (
          <Mapbox.MarkerView key={`friend-${friend.user_id}`} coordinate={[friend.lng, friend.lat]} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
            <FriendPin friend={friend} ago={formatAgo(friend.seen_at, now)} accent={solidAccent} />
          </Mapbox.MarkerView>
        ))}
      </Mapbox.MapView>

      {/* Top overlay */}
      <View style={styles.topOverlay} pointerEvents="box-none">
        <View style={styles.titleCard}>
          <Text style={styles.titleCardName} numberOfLines={1} accessibilityRole="header">
            {festival.name}
          </Text>
          <Text style={styles.titleCardSub} numberOfLines={1}>
            {group ? group.name : groups.length === 0 ? 'Join a crew to see friends here' : ''}
          </Text>
        </View>
        <GroupChips groups={groups} selectedId={group?.id ?? null} onSelect={select} accent={accent} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={styles.controlRow}>
          {group ? (
            <ControlPill
              label={sharingLabel}
              icon={sharingHere ? 'radio' : 'navigate-outline'}
              active={sharingHere && sharing.status === 'sharing'}
              onPress={onSharingPress}
              accessibilityHint={sharingHere ? 'Shows options to stop sharing' : `Starts sharing your location with ${group.name}`}
            />
          ) : null}
          {packLabel ? (
            <ControlPill
              label={packLabel}
              icon={
                offlinePack.state.kind === 'complete'
                  ? 'cloud-done-outline'
                  : offlinePack.state.kind === 'paused'
                    ? 'cloud-offline-outline'
                    : offlinePack.state.kind === 'error'
                      ? 'alert-circle-outline'
                      : 'cloud-download-outline'
              }
              busy={offlinePack.state.kind === 'downloading' || offlinePack.state.kind === 'checking'}
              onPress={offlinePack.state.kind === 'downloading' || offlinePack.state.kind === 'checking' ? undefined : onPackPress}
            />
          ) : null}
        </ScrollView>
      </View>

      <View style={[styles.recenter, { bottom: tabBarClearance + 64 }]}>
        <IconButton icon={<Ionicons name="locate-outline" size={20} color={colors.textPrimary} />} accessibilityLabel="Show the whole festival" onPress={recenter} />
      </View>

      {/* Bottom summary */}
      <View style={[styles.legend, { bottom: tabBarClearance + 8 }]} accessibilityLiveRegion="polite">
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: solidAccent }]} />
          <Text style={styles.legendText}>{stagePins.length} stages</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
          <Text style={styles.legendText}>{meetupPins.length} meetups</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
          <Text style={styles.legendText}>
            {group ? (friendsQuery.isError && friends.length === 0 ? 'Friends offline' : `${friends.length} friends`) : 'No crew'}
          </Text>
        </View>
      </View>

      {group ? (
        <LocationSharingSheet
          visible={sheetVisible}
          groupId={group.id}
          groupName={group.name}
          otherGroupName={otherGroupName}
          onClose={() => setSheetVisible(false)}
        />
      ) : null}
      <ActionSheet
        visible={controlsSheet !== null}
        title={controlsSheet === 'offline' ? 'Offline map' : 'Location sharing'}
        message={
          controlsSheet === 'offline'
            ? offlineSheetMessage
            : group
              ? `Your crew ${group.name} can see your location while Festie is open.`
              : undefined
        }
        actions={controlActions}
        onClose={() => setControlsSheet(null)}
      />
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────── */

const styles = StyleSheet.create({
  // React Native gives horizontal ScrollViews flexGrow/flexShrink 1; in a flex column they would take
  // a share of the free height away from the list below.
  chipScroller: { flexGrow: 0 },
  container: { flex: 1 },
  // All four edges: an absolute view with only `top` gets a content-sized (zero) height.
  map: StyleSheet.absoluteFillObject,
  statePad: { padding: spacing.lg },
  scroll: { flex: 1 },
  scrollContent: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },

  /* Fallback lists */
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  muted: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  listRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 56 },
  listIcon: { alignItems: 'center', borderRadius: 16, height: 44, justifyContent: 'center', width: 44 },
  listText: { flex: 1, gap: 2 },
  listTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  listSub: { color: colors.textSecondary, fontSize: 13 },
  groupChips: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },

  /* Live map overlay */
  topOverlay: { gap: spacing.sm, left: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, position: 'absolute', right: 0, top: 0 },
  titleCard: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: radii.xl,
    maxWidth: '100%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  titleCardName: { color: colors.textPrimary, fontFamily: 'Georgia', fontSize: 20, fontStyle: 'italic', fontWeight: '700' },
  titleCardSub: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  controlRow: { flexDirection: 'row', gap: spacing.sm },
  pill: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 6,
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  pillActive: { backgroundColor: colors.success },
  pillLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  recenter: { position: 'absolute', right: spacing.lg },

  /* Pins */
  stagePin: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    gap: 2,
    maxWidth: 180,
    minWidth: 80,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  stagePinRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  stageDot: { borderRadius: 4, height: 8, width: 8 },
  stagePinText: { color: colors.textPrimary, fontSize: 11, fontWeight: '800' },
  stagePinTime: { color: colors.textSecondary, fontSize: 10, fontWeight: '600' },
  meetupPin: {
    alignItems: 'center',
    backgroundColor: colors.success,
    borderColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    gap: 1,
    maxWidth: 180,
    minWidth: 80,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  meetupPinText: { color: colors.textPrimary, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  meetupPinTime: { color: colors.textPrimary, fontSize: 10, fontWeight: '600' },
  friendPin: { alignItems: 'center', gap: 2 },
  friendRing: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 3,
    padding: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  friendLabel: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 },
  friendLabelText: { color: colors.textPrimary, fontSize: 10, fontWeight: '700' },

  /* Legend */
  legend: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    left: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    position: 'absolute',
    right: spacing.lg + 56,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  legendDot: { borderRadius: 4, height: 8, width: 8 },
  legendText: { color: colors.textPrimary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
});
