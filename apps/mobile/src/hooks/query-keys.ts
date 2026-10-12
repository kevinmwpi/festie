/**
 * React Query keys. Every key for user data includes the auth user id (§5.1), so a different account
 * on the same device can never be served another user's cached rows; `performSignOut` also clears
 * the whole cache. Public festival data (catalog, bundles) is keyed without it.
 *
 * Background-refresh queries (see `useCacheFirstQuery`) live under the separate `'refresh'` root so
 * that invalidating a local read never triggers a network round trip by itself.
 */
import type { QueryClient } from '@tanstack/react-query';

/** Stand-in id for keys built while signed out (never shared with a real user id). */
export const SIGNED_OUT_KEY = 'signed-out';

export const queryKeys = {
  profile: (uid: string) => ['profile', uid] as const,
  festivals: () => ['festivals'] as const,
  festivalBundle: (festivalId: string) => ['festival-bundle', festivalId] as const,
  /** Announced artists without a set yet (public catalog data, derived from the bundle). */
  unscheduledArtists: (festivalId: string) => ['unscheduled-artists', festivalId] as const,
  imageCredits: () => ['image-credits'] as const,
  userFestivals: (uid: string) => ['user-festivals', uid] as const,
  lineup: (uid: string, festivalId: string) => ['lineup', uid, festivalId] as const,
  schedule: (uid: string, festivalId: string) => ['schedule', uid, festivalId] as const,
  groups: (uid: string) => ['groups', uid] as const,
  groupDetail: (uid: string, groupId: string) => ['group', uid, groupId] as const,
  groupSchedule: (uid: string, groupId: string, festivalId: string) => ['group-schedule', uid, groupId, festivalId] as const,
  meetups: (uid: string, groupId: string) => ['meetups', uid, groupId] as const,
  friendLocations: (uid: string, groupId: string) => ['friend-locations', uid, groupId] as const,
  blockedUsers: (uid: string) => ['blocked-users', uid] as const,
  totemUrl: (uid: string, path: string) => ['totem-url', uid, path] as const,
  locationPermission: () => ['location-permission'] as const,
};

/** Local reads that change when the user's picks change. */
export function invalidateSelectionQueries(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['lineup'] }),
    queryClient.invalidateQueries({ queryKey: ['schedule'] }),
    queryClient.invalidateQueries({ queryKey: ['group-schedule'] }),
  ]).then(() => undefined);
}

/** Local reads of crews, members and meetups. */
export function invalidateGroupQueries(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['groups'] }),
    queryClient.invalidateQueries({ queryKey: ['group'] }),
    queryClient.invalidateQueries({ queryKey: ['meetups'] }),
    queryClient.invalidateQueries({ queryKey: ['group-schedule'] }),
    queryClient.invalidateQueries({ queryKey: ['friend-locations'] }),
  ]).then(() => undefined);
}

/**
 * After a block/unblock: the blocked user's meetups, picks and positions disappear everywhere. Pass
 * `blockedUserId` after a block: their cached position is removed at once, since the map's refetch
 * needs the network (and while it is in flight the cached rows would still render).
 */
export function invalidateAfterBlockChange(queryClient: QueryClient, blockedUserId?: string): Promise<void> {
  if (blockedUserId) {
    queryClient.setQueriesData<ReadonlyArray<{ user_id: string }>>({ queryKey: ['friend-locations'] }, (rows) =>
      rows?.filter((row) => row.user_id !== blockedUserId),
    );
  }
  return Promise.all([
    invalidateGroupQueries(queryClient),
    invalidateSelectionQueries(queryClient),
    queryClient.invalidateQueries({ queryKey: ['blocked-users'] }),
  ]).then(() => undefined);
}
