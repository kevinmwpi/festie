/**
 * Recreates reminders that should exist but do not. Every sign-out (voluntary or a lost session)
 * cancels all reminders (§5.1), while the user's picks and meetups come back after signing in again —
 * from the kept local cache or the server refresh. Without this, those picks would never remind
 * anyone, and nothing would say so.
 *
 * The rule matches what the app schedules in the moment: a reminder for every future picked set
 * (`useSetSelection`) and for every future meetup the user created (Create Meetup). Restoring never
 * prompts — it only runs when notification permission is already granted — and never throws.
 *
 * Schedule changes are applied too: a pick that was cancelled loses its reminder, and a pick that
 * moved gets its reminder moved to the new start (keeping the lead time it was scheduled with).
 */
import { isCancelledSet } from '@festival/domain';
import {
  getCachedProfile,
  getLocalFestival,
  getLocalFestivalBundle,
  getLocalGroupDetail,
  getSelectedSchedule,
} from '@festival/data-access';
import {
  cancelReminderForEntity,
  getReminderPermission,
  getScheduledReminders,
  scheduleMeetupReminder,
  scheduleSetReminder,
  type ReminderEntityType,
  type ReminderResult,
} from '@festival/notification-utils';

import { isSigningOut } from '@/src/providers/session-actions';

/** The signed-in user's profile id, or `null` while signed out or signing out. */
function currentUserId(): string | null {
  return isSigningOut() ? null : (getCachedProfile()?.id ?? null);
}

/**
 * Schedules one reminder for `userId`. A sign-out that began while it was being scheduled has already
 * run (or is about to run) `cancelAllReminders`, so a reminder landing after that is withdrawn again.
 * Resolves `false` when the user is no longer signed in.
 */
async function scheduleForUser(
  userId: string,
  entityType: ReminderEntityType,
  entityId: string,
  schedule: () => Promise<ReminderResult>,
): Promise<boolean> {
  if (currentUserId() !== userId) {
    return false;
  }
  const result = await schedule();
  if (currentUserId() !== userId) {
    if (result.status === 'scheduled') {
      await cancelReminderForEntity(entityType, entityId);
    }
    return false;
  }
  return true;
}

async function scheduledIds(entityType: ReminderEntityType): Promise<Set<string>> {
  return new Set((await getScheduledReminders(entityType)).map((reminder) => reminder.entity_id));
}

/**
 * Schedules the missing reminders of the user's future picks in one festival, moves reminders of
 * picks whose set moved and cancels reminders of picks whose set was cancelled (cache only).
 */
export async function restoreSetReminders(festivalId: string, now = Date.now()): Promise<void> {
  try {
    const userId = currentUserId();
    if (!userId || !festivalId || (await getReminderPermission()) !== 'granted') {
      return;
    }
    const [festival, picks, scheduled] = await Promise.all([
      getLocalFestival(festivalId),
      getSelectedSchedule(festivalId),
      getScheduledReminders('set'),
    ]);
    if (!festival) {
      return;
    }
    const existing = new Map(scheduled.map((reminder) => [reminder.entity_id, reminder]));
    for (const set of picks) {
      const reminder = existing.get(set.id);
      const startMs = new Date(set.start_time).getTime();
      const upToDate = reminder !== undefined && new Date(reminder.starts_at).getTime() === startMs;
      if (isCancelledSet(set) || (startMs <= now && !upToDate)) {
        if (reminder) {
          await cancelReminderForEntity('set', set.id);
        }
        continue;
      }
      if (upToDate || startMs <= now) {
        continue;
      }
      let scheduledNow = false;
      const stillSignedIn = await scheduleForUser(userId, 'set', set.id, async () => {
        const result = await scheduleSetReminder(
          { id: set.id, start_time: set.start_time, artist_name: set.artist_name, stage_name: set.stage_name, festival_id: festivalId },
          { timeZone: festival.timezone, requestPermission: false, minutesBefore: reminder?.minutes_before },
        );
        scheduledNow = result.status === 'scheduled';
        return result;
      });
      if (!stillSignedIn) {
        return;
      }
      // A moved set whose new reminder time has already passed must not keep the old reminder.
      if (reminder && !scheduledNow) {
        await cancelReminderForEntity('set', set.id);
      }
    }
  } catch {
    // Best effort: the next refresh tries again.
  }
}

/** Schedules the missing reminders of the user's own future meetups in the given crews (cache only). */
export async function restoreMeetupReminders(groupIds: Iterable<string>, now = Date.now()): Promise<void> {
  try {
    const userId = currentUserId();
    const ids = [...new Set(groupIds)].filter(Boolean);
    if (!userId || ids.length === 0 || (await getReminderPermission()) !== 'granted') {
      return;
    }
    const existing = await scheduledIds('meetup');
    for (const groupId of ids) {
      const detail = await getLocalGroupDetail(groupId);
      const missing = (detail?.meetups ?? []).filter(
        (meetup) => meetup.created_by_user_id === userId && !existing.has(meetup.id) && new Date(meetup.starts_at).getTime() > now,
      );
      if (!detail || missing.length === 0) {
        continue;
      }
      const bundle = await getLocalFestivalBundle(detail.group.festival_id);
      if (!bundle) {
        continue;
      }
      const stageNames = new Map(bundle.stages.map((stage) => [stage.id, stage.name]));
      for (const meetup of missing) {
        const stillSignedIn = await scheduleForUser(userId, 'meetup', meetup.id, () =>
          scheduleMeetupReminder(
            {
              id: meetup.id,
              title: meetup.title,
              starts_at: meetup.starts_at,
              // Same place label Create Meetup schedules with.
              place: meetup.stage_id ? (stageNames.get(meetup.stage_id) ?? null) : null,
              group_id: groupId,
            },
            { timeZone: bundle.festival.timezone, requestPermission: false },
          ),
        );
        if (!stillSignedIn) {
          return;
        }
      }
    }
  } catch {
    // Best effort: the next refresh tries again.
  }
}
