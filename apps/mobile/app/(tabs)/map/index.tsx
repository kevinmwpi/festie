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
  continuous,
  deriveAccentColors,
  elevation,
  EmptyState,
  IconButton,
  iconRadius,
  layout,
  ListRow,
  ListSection,
  PressableScale,
  radii,
  showToast,
  spacing,
  tabularNums,
  textStyles,
  useOfflineStatus,
  useReduceMotion,
} from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import Mapbox from '@rnmapbox/maps';
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, AppState, Linking, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

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

/** Camera move of the recenter button; 0 (a cut) with Reduce Motion on. */
const RECENTER_DURATION_MS = 600;
/**
 * Top-overlay height (title card and control pills, default text size) assumed until the overlay has been
 * measured. The map reads its first framing before any onLayout lands, so that framing always uses this
 * estimate; `CREW_CHIPS_HEIGHT` is added when the crew chips row is shown.
 */
const INITIAL_TOP_OVERLAY_HEIGHT = 140;
/** The crew chips row in the top overlay: chip, its scroller's vertical padding, and the overlay gap. */
const CREW_CHIPS_HEIGHT = layout.chipHeight + 2 * spacing.xs + spacing.sm;
/**
 * Most of the map's height the camera padding may take. Mapbox cannot frame bounds whose vertical padding
 * exceeds the map (it keeps the current camera), which wrapped overlays at the largest text sizes can reach
 * on a small phone; the padding is scaled down to leave the festival at least a quarter of the map.
 */
const MAX_CAMERA_PADDING_SHARE = 0.75;

/**
 * Pins float over the map with `allowOverlap`, so past this text size they would cover each other and the
 * festival. Each marker's accessibility label carries its full text.
 */
const PIN_MAX_FONT_SCALE = 1.4;

/** Friend pin: the avatar inside a white inset and the festival-accent ring (a stroke, so off the 4pt grid). */
const FRIEND_AVATAR_SIZE = 34;
const FRIEND_RING_INSET = spacing.xxs;
const FRIEND_RING_BORDER = 3;
const FRIEND_RING_SIZE = FRIEND_AVATAR_SIZE + 2 * (FRIEND_RING_INSET + FRIEND_RING_BORDER);

/** Icon tiles and avatars leading the rows of the no-map lists. */
const LIST_TILE_SIZE = 36;

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
    <View style={[styles.pin, styles.stagePin, { borderColor: accent }]} accessible accessibilityLabel={`Stage ${name}${nextLabel ? `, next: ${nextLabel}` : ''}`}>
      <View style={styles.stagePinRow}>
        <View style={[styles.stageDot, { backgroundColor: accent }]} />
        <Text style={styles.pinTitle} numberOfLines={2} maxFontSizeMultiplier={PIN_MAX_FONT_SCALE}>
          {name}
        </Text>
      </View>
      {nextLabel ? (
        <Text style={styles.stagePinTime} numberOfLines={2} maxFontSizeMultiplier={PIN_MAX_FONT_SCALE}>
          {nextLabel}
        </Text>
      ) : null}
    </View>
  );
}

function MeetupPin({ title, time }: { title: string; time: string }) {
  return (
    <View style={[styles.pin, styles.meetupPin]} accessible accessibilityLabel={`Meetup ${title} at ${time}`}>
      <Ionicons name="location" size={14} color={colors.textPrimary} />
      <Text style={[styles.pinTitle, styles.pinTextCentered]} numberOfLines={2} maxFontSizeMultiplier={PIN_MAX_FONT_SCALE}>
        {title}
      </Text>
      <Text style={styles.meetupPinTime} maxFontSizeMultiplier={PIN_MAX_FONT_SCALE}>
        {time}
      </Text>
    </View>
  );
}

function FriendPin({ friend, ago, accent }: { friend: FriendLocation; ago: string; accent: string }) {
  const nameLabel = (
    <Text style={styles.friendLabelText} numberOfLines={1} maxFontSizeMultiplier={PIN_MAX_FONT_SCALE}>
      {friend.display_name.split(' ')[0]} · {ago}
    </Text>
  );
  return (
    <View style={styles.friendPin} accessible accessibilityLabel={`${friend.display_name}, last seen ${ago}`}>
      {/* An invisible copy of the name label above the avatar balances the real one below it, so the avatar
          is the pin's vertical centre: the marker is anchored at y 0.5, which keeps the avatar (not the gap
          above the name) on the friend's position at any text size. */}
      <View
        style={[styles.friendLabel, styles.friendLabelSpacer]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {nameLabel}
      </View>
      <View style={[styles.friendRing, { borderColor: accent }]}>
        <Avatar name={friend.display_name} avatarType={friend.avatar_type} avatarValue={friend.avatar_value} size={FRIEND_AVATAR_SIZE} />
      </View>
      <View style={styles.friendLabel}>{nameLabel}</View>
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
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: Boolean(busy) }}
      style={[styles.overlaySurface, styles.pill, active && styles.pillActive]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Ionicons name={icon} size={16} color={colors.textPrimary} />}
      <Text style={styles.pillLabel}>{label}</Text>
    </PressableScale>
  );
}

function GroupChips({ groups, selectedId, onSelect, accent }: { groups: GroupSummary[]; selectedId: string | null; onSelect: (id: string) => void; accent: string }) {
  if (groups.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={styles.chipRow}>
      {groups.map((group) => (
        <Chip key={group.id} label={group.name} active={group.id === selectedId} accentColor={accent} onPress={() => onSelect(group.id)} />
      ))}
    </ScrollView>
  );
}

/* ─── Fallback (no map) ─────────────────────────────────── */

/** Icon tile leading a no-map list row (decorative: `ListRow` hides `leading` from screen readers). */
function ListTile({ icon, backgroundColor }: { icon: React.ComponentProps<typeof Ionicons>['name']; backgroundColor: string }) {
  return (
    <View style={[styles.listTile, { backgroundColor }]}>
      <Ionicons name={icon} size={20} color={colors.textPrimary} />
    </View>
  );
}

/** A section's empty-state line, inside its card. */
function SectionNote({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionNote}>{children}</Text>;
}

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

  // Inset-grouped sections (sentence-case header above a card of rows), like Settings.
  return (
    <>
      <ListSection title="Stages · next up">
        {stages.length === 0 ? <SectionNote>Stages appear once the festival publishes them.</SectionNote> : null}
        {stages.map((stage) => {
          const next = getNextStageSet(stage.id, bundle.sets, new Date(now));
          return (
            <ListRow
              key={stage.id}
              leading={<ListTile icon="flag-outline" backgroundColor={colors.inputBg} />}
              title={stage.name}
              subtitle={
                next
                  ? `Next: ${artistsById.get(next.artist_id) ?? 'TBA'} · ${clock.day(next.start_time)} ${clock.time(next.start_time)}`
                  : 'No more sets'
              }
            />
          );
        })}
      </ListSection>

      <ListSection title={group ? `Meetups · ${group.name}` : 'Meetups'}>
        {!hasGroups ? (
          <SectionNote>Join or create a crew to plan meetups.</SectionNote>
        ) : upcomingMeetups.length === 0 ? (
          <SectionNote>No upcoming meetups.</SectionNote>
        ) : (
          upcomingMeetups.map((meetup) => (
            <ListRow
              key={meetup.id}
              leading={<ListTile icon="location-outline" backgroundColor={colors.successBg} />}
              title={meetup.title}
              subtitle={[`${clock.date(meetup.starts_at, { weekday: 'short' })} ${clock.time(meetup.starts_at)}`, stageLabel(meetup.stage_id)]
                .filter(Boolean)
                .join(' · ')}
            />
          ))
        )}
      </ListSection>

      {group ? (
        <ListSection title="Friends sharing">
          {friends.length === 0 ? (
            <SectionNote>No one in {group.name} is sharing their location right now.</SectionNote>
          ) : (
            friends.map((friend) => (
              <ListRow
                key={friend.user_id}
                leading={
                  <Avatar name={friend.display_name} avatarType={friend.avatar_type} avatarValue={friend.avatar_value} size={LIST_TILE_SIZE} />
                }
                title={friend.display_name}
                subtitle={`Last seen ${formatAgo(friend.seen_at, now)}`}
              />
            ))
          )}
        </ListSection>
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
  const reduceMotion = useReduceMotion();
  // Measured overlay sizes: they grow with the text size, and the camera framing, the Mapbox logo and the
  // recenter button are placed around them. `null` until measured.
  const [topOverlayHeight, setTopOverlayHeight] = React.useState<number | null>(null);
  const [legendHeight, setLegendHeight] = React.useState<number>(layout.minTouchTarget);
  // The live map's height (the map fills its container). Until measured, the window height stands in: the
  // padding cap is a share of it, so it still leaves the map room on the first framing.
  const [mapHeight, setMapHeight] = React.useState<number | null>(null);
  const { height: windowHeight } = useWindowDimensions();

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
              tintColor={colors.textSecondary}
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
      const nextLabel = next ? `${artistsById.get(next.artist_id) ?? 'Next'} · ${clock.timeFrom(next.start_time, now)}` : null;
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

  const stagesLegend = `${stagePins.length} stages`;
  const meetupsLegend = `${meetupPins.length} meetups`;
  const friendsLegend = group ? (friendsQuery.isError && friends.length === 0 ? 'Friends offline' : `${friends.length} friends`) : 'No crew';

  // Bottom stack, from the tab bar up: the legend with the recenter button beside it, then the Mapbox logo
  // and attribution (i) above the legend, so no control ever covers them.
  const overlayBottom = tabBarClearance + spacing.sm;
  const ornamentBottom = overlayBottom + legendHeight + spacing.sm;
  // The festival fits between the top overlay and the legend. The first view is framed before the overlays
  // are measured, so it uses their estimates (the crew chips row is known from the crew count); the recenter
  // button uses the measured heights.
  const topPadding = (topOverlayHeight ?? INITIAL_TOP_OVERLAY_HEIGHT + (groups.length >= 2 ? CREW_CHIPS_HEIGHT : 0)) + spacing.sm;
  const bottomPadding = ornamentBottom;
  const maxVerticalPadding = (mapHeight ?? windowHeight) * MAX_CAMERA_PADDING_SHARE;
  const paddingScale = Math.min(1, maxVerticalPadding / (topPadding + bottomPadding));
  const cameraPadding = {
    paddingTop: Math.floor(topPadding * paddingScale),
    paddingRight: layout.screenGutter,
    paddingBottom: Math.floor(bottomPadding * paddingScale),
    paddingLeft: layout.screenGutter,
  };

  const recenter = () => {
    const animationDuration = reduceMotion ? 0 : RECENTER_DURATION_MS;
    if (camera.bounds) {
      cameraRef.current?.fitBounds(
        camera.bounds.ne,
        camera.bounds.sw,
        [cameraPadding.paddingTop, cameraPadding.paddingRight, cameraPadding.paddingBottom, cameraPadding.paddingLeft],
        animationDuration,
      );
    } else {
      cameraRef.current?.setCamera({ centerCoordinate: camera.center, zoomLevel: camera.zoom, animationDuration });
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
    <View style={styles.container} onLayout={(event) => setMapHeight(Math.floor(event.nativeEvent.layout.height))}>
      {/* Screens run to the bottom edge of the display, so the map fills it, under the floating tab bar
          and the home indicator. The logo and attribution sit above the legend (Mapbox's terms keep the
          wordmark visible); on iOS Mapbox may measure these margins from the safe area, which only lifts
          them further clear of it. */}
      <Mapbox.MapView
        style={styles.map}
        styleURL={OFFLINE_MAP_STYLE}
        scaleBarEnabled={false}
        logoPosition={{ bottom: ornamentBottom, left: layout.screenGutter }}
        attributionPosition={{ bottom: ornamentBottom, right: layout.screenGutter }}
      >
        {/* `defaultSettings` is read once, when the map first lays out; later changes never move the camera. */}
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={
            camera.bounds
              ? { bounds: { ne: camera.bounds.ne, sw: camera.bounds.sw, ...cameraPadding } }
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
      <View
        style={styles.topOverlay}
        pointerEvents="box-none"
        onLayout={(event) => setTopOverlayHeight(Math.ceil(event.nativeEvent.layout.height))}
      >
        <View style={[styles.overlaySurface, styles.titleCard]}>
          <Text style={styles.titleCardName} numberOfLines={2} accessibilityRole="header">
            {festival.name}
          </Text>
          <Text style={styles.titleCardSub} numberOfLines={2}>
            {group ? group.name : groups.length === 0 ? 'Join a crew to see friends here' : ''}
          </Text>
        </View>
        <GroupChips groups={groups} selectedId={group?.id ?? null} onSelect={select} accent={accent} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.chipScroller, styles.controlScroller]}
          contentContainerStyle={styles.chipRow}
        >
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

      {/* The recenter button frames the festival area (not the user's own position). */}
      <View style={[styles.recenter, { bottom: overlayBottom }]}>
        <IconButton icon={<Ionicons name="expand-outline" size={20} color={colors.textPrimary} />} accessibilityLabel="Show the whole festival" onPress={recenter} />
      </View>

      {/* Bottom summary: one VoiceOver element. Not a live region, since the friend count changes with
          every 30 s poll. */}
      <View
        style={[styles.overlaySurface, styles.legend, { bottom: overlayBottom }]}
        onLayout={(event) => setLegendHeight(Math.ceil(event.nativeEvent.layout.height))}
        accessible
        accessibilityLabel={[stagesLegend, meetupsLegend, friendsLegend].join(', ')}
      >
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: solidAccent }]} />
          <Text style={styles.legendText}>{stagesLegend}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
          <Text style={styles.legendText}>{meetupsLegend}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
          <Text style={styles.legendText}>{friendsLegend}</Text>
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
  // a share of the free height away from the list below. The negative margin runs the scroller to the
  // screen edges (chips scroll out under the edge instead of stopping at the gutter); `chipRow` puts the
  // gutter back inside it.
  chipScroller: { flexGrow: 0, marginHorizontal: -layout.screenGutter },
  // Chips are 36pt tall with a 4pt hitSlop above and below: the vertical padding keeps that slop inside
  // the scroller, which would otherwise clip the 44pt target.
  chipRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: layout.screenGutter, paddingVertical: spacing.xs },
  container: { flex: 1 },
  // Fills the whole screen: rnmapbox sizes the native map to this wrapper, so it needs every edge (a wrapper
  // with only top/left/right has no height and the map collapses to nothing).
  map: StyleSheet.absoluteFillObject,
  statePad: { padding: layout.screenGutter },
  scroll: { flex: 1 },
  scrollContent: { gap: spacing.md, paddingHorizontal: layout.screenGutter, paddingTop: spacing.sm },

  /* Fallback lists */
  listTile: {
    ...continuous,
    alignItems: 'center',
    borderRadius: iconRadius(LIST_TILE_SIZE),
    height: LIST_TILE_SIZE,
    justifyContent: 'center',
    width: LIST_TILE_SIZE,
  },
  sectionNote: {
    ...textStyles.subheadline,
    color: colors.textSecondary,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.ms,
  },

  /* Live map overlay */
  // One surface for everything floating over the map (title card, control pills, legend). Opaque white, not
  // the 95% `overlay`, because it carries the floating shadow and translucent fills get none (iOS cannot
  // path them and redraws the shadow offscreen while the map pans; Android shows it through as a grey cast).
  // The hairline edge separates it from the Street style's pale land, which is almost white.
  overlaySurface: {
    ...continuous,
    ...elevation.floating,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  topOverlay: { gap: spacing.sm, left: 0, paddingHorizontal: layout.screenGutter, paddingTop: spacing.md, position: 'absolute', right: 0, top: 0 },
  titleCard: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  titleCardName: { ...textStyles.title3, color: colors.textPrimary },
  titleCardSub: { ...textStyles.footnote, color: colors.textSecondary },
  // Lets the pills' floating shadow draw below the scroller instead of being cut off at its bottom edge.
  controlScroller: { overflow: 'visible' },
  pill: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pillActive: { backgroundColor: colors.success },
  pillLabel: { ...textStyles.footnote, color: colors.textPrimary, fontWeight: '600' },
  recenter: { position: 'absolute', right: layout.screenGutter },

  /* Pins */
  pin: {
    ...continuous,
    ...elevation.raised,
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 2,
    gap: spacing.xxs,
    // A label, not a card: wide enough for short names, never wider than a third of the map.
    maxWidth: 180,
    minWidth: 80,
    paddingHorizontal: spacing.ms,
    paddingVertical: spacing.xs,
  },
  pinTitle: { ...textStyles.caption1, color: colors.textPrimary, flexShrink: 1, fontWeight: '600' },
  pinTextCentered: { textAlign: 'center' },
  stagePin: { backgroundColor: colors.surface },
  stagePinRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  stageDot: { borderRadius: radii.xs, height: 8, width: 8 },
  stagePinTime: { ...textStyles.caption2, ...tabularNums, color: colors.textSecondary, fontWeight: '500', textAlign: 'center' },
  meetupPin: { backgroundColor: colors.success, borderColor: colors.surface },
  meetupPinTime: { ...textStyles.caption2, ...tabularNums, color: colors.textPrimary, fontWeight: '500' },
  friendPin: { alignItems: 'center', gap: spacing.xxs },
  friendRing: {
    ...elevation.raised,
    backgroundColor: colors.surface,
    borderRadius: FRIEND_RING_SIZE / 2,
    borderWidth: FRIEND_RING_BORDER,
    padding: FRIEND_RING_INSET,
  },
  friendLabel: {
    backgroundColor: colors.overlay,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  friendLabelSpacer: { opacity: 0 },
  friendLabelText: { ...textStyles.caption1, ...tabularNums, color: colors.textPrimary, fontWeight: '600' },

  /* Legend */
  legend: {
    alignContent: 'center',
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    left: layout.screenGutter,
    // Matches the recenter button beside it; wraps onto more lines (growing upward) at large text sizes.
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    // Leaves the recenter button its own column at the end of the row.
    right: layout.screenGutter + layout.minTouchTarget + spacing.sm,
    rowGap: spacing.xs,
  },
  legendItem: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: spacing.xs },
  legendDot: { borderRadius: radii.xs, height: 8, width: 8 },
  legendText: { ...textStyles.footnote, ...tabularNums, color: colors.textPrimary, flexShrink: 1, fontWeight: '500' },
});
