import { getLocalUserFestivals, refreshUserFestivals, toggleUserFestival, toUserMessage, type Festival } from '@festival/data-access';
import { showToast } from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { ensureActiveFestival } from '@/src/state/app-store';

import { queryKeys } from './query-keys';
import { useCacheFirstQuery } from './use-cache-first-query';
import { useUserKey } from './use-session';

/**
 * Follow state of the signed-in user's festivals (cache first, refreshed online) and a toggle that
 * writes online, re-reads the cache and toasts the outcome. Shared by the Fests list and the
 * Lineup's "set times to be announced" notice, so following works wherever the festival is shown.
 *
 * `reapplyDefault` (Fests list only): after a background refresh, re-pick the default festival from
 * the refreshed follows. Screens that show one festival pass `false` so a refresh on focus never swaps
 * the festival under the reader; the toggle itself always re-applies the default.
 */
export function useFollowFestivals({ reapplyDefault = true }: { reapplyDefault?: boolean } = {}) {
  const queryClient = useQueryClient();
  const userKey = useUserKey();
  const [busyId, setBusyId] = useState<string | null>(null);

  const following = useCacheFirstQuery({
    queryKey: queryKeys.userFestivals(userKey),
    readLocal: getLocalUserFestivals,
    refresh: async () => {
      await refreshUserFestivals();
      if (reapplyDefault) {
        await ensureActiveFestival();
      }
    },
  });

  const followingIds = useMemo(() => new Set((following.data ?? []).map((row) => row.festival_id)), [following.data]);

  const toggle = useCallback(
    async (festival: Pick<Festival, 'id' | 'name'>) => {
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

  return { following, followingIds, busyId, toggle };
}
