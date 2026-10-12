import { isCancelledSet } from './set-status';
import { DEFAULT_DAY_START_HOUR, festivalDayKey } from './time';

export interface Set {
  id: string;
  artist_id: string;
  stage_id: string;
  start_time: string;
  end_time: string;
  festival_id: string;
  /** `sets.status`; missing on rows cached before it existed (read as scheduled). */
  status?: string | null;
}

type TimedSet = Pick<Set, 'start_time' | 'end_time' | 'status'>;

export interface ScheduleConflict {
  set_a: Set;
  set_b: Set;
  type: 'hard' | 'tight';
}

function toTime(value: string): number {
  return new Date(value).getTime();
}

/**
 * Two sets conflict when their time ranges overlap; back-to-back sets (end == start) do not, and a
 * cancelled set conflicts with nothing.
 */
export function detectConflict(a: TimedSet, b: TimedSet): boolean {
  if (isCancelledSet(a) || isCancelledSet(b)) {
    return false;
  }
  return toTime(a.start_time) < toTime(b.end_time) && toTime(a.end_time) > toTime(b.start_time);
}

export function getConflictsForSet(set: Set, selected: Set[]): Set[] {
  return selected.filter((candidate) => candidate.id !== set.id && detectConflict(set, candidate));
}

/**
 * Groups sets by festival day (see `festivalDayKey`): a 1:00 AM set belongs to the previous day.
 */
export function getSetsByDay(sets: Set[], timeZone: string, dayStartHour = DEFAULT_DAY_START_HOUR): Record<string, Set[]> {
  return [...sets]
    .sort((left, right) => toTime(left.start_time) - toTime(right.start_time))
    .reduce<Record<string, Set[]>>((grouped, currentSet) => {
      const dayKey = festivalDayKey(currentSet.start_time, timeZone, dayStartHour);
      grouped[dayKey] ??= [];
      grouped[dayKey].push(currentSet);
      return grouped;
    }, {});
}

/** The first selected set that has not started yet, skipping cancelled sets. */
export function getNextUpcomingSet(selected: Set[], now: Date): Set | null {
  const nowMs = now.getTime();
  const ordered = [...selected].sort((left, right) => toTime(left.start_time) - toTime(right.start_time));
  return ordered.find((set) => !isCancelledSet(set) && toTime(set.start_time) >= nowMs) ?? null;
}

export function getConflictPairs(selected: Set[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];

  for (let index = 0; index < selected.length; index += 1) {
    const current = selected[index];

    for (let innerIndex = index + 1; innerIndex < selected.length; innerIndex += 1) {
      const candidate = selected[innerIndex];
      if (!detectConflict(current, candidate)) {
        continue;
      }

      conflicts.push({
        set_a: current,
        set_b: candidate,
        type: 'hard',
      });
    }
  }

  return conflicts;
}
