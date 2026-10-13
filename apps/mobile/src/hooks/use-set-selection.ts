import { toggleSetSelection, toUserMessage, type Festival } from '@festival/data-access';
import { isCancelledSet } from '@festival/domain';
import { cancelReminderForEntity, scheduleSetReminder } from '@festival/notification-utils';
import { showToast } from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { invalidateSelectionQueries } from './query-keys';

export interface SelectableSet {
  id: string;
  start_time: string;
  artist_name: string;
  stage_name: string;
  /** `sets.status`: a cancelled set gets no reminder. */
  status?: string | null;
}

/** Shown at most once per app session so repeated picks do not nag. */
let deniedHintShown = false;

/**
 * Adds or removes a set from the user's schedule (queued — works offline) and keeps its reminder in
 * step: adding schedules a reminder 15 minutes before the set's absolute start (asking for notification
 * permission the first time, in context), removing cancels it. A declined permission is explained once.
 * A cancelled set never gets a reminder (screens only offer to remove one).
 */
export function useSetSelection(festival: Pick<Festival, 'id' | 'timezone'> | null | undefined) {
  const queryClient = useQueryClient();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyRef = useRef(new Set<string>());

  const toggle = useCallback(
    async (set: SelectableSet) => {
      if (!festival || busyRef.current.has(set.id)) {
        return;
      }
      busyRef.current.add(set.id);
      setBusyIds(new Set(busyRef.current));
      try {
        const selected = await toggleSetSelection(festival.id, set.id);
        await invalidateSelectionQueries(queryClient);
        if (selected && isCancelledSet(set)) {
          await cancelReminderForEntity('set', set.id);
        } else if (selected) {
          const result = await scheduleSetReminder(
            { id: set.id, start_time: set.start_time, artist_name: set.artist_name, stage_name: set.stage_name, festival_id: festival.id },
            { timeZone: festival.timezone },
          );
          if (result.status === 'permission_denied' && !deniedHintShown) {
            deniedHintShown = true;
            showToast('Added. Turn on notifications in Settings to get set reminders.');
          }
        } else {
          await cancelReminderForEntity('set', set.id);
        }
      } catch (error) {
        showToast(toUserMessage(error), 'error');
      } finally {
        busyRef.current.delete(set.id);
        setBusyIds(new Set(busyRef.current));
      }
    },
    [festival, queryClient],
  );

  return { toggle, busyIds };
}
