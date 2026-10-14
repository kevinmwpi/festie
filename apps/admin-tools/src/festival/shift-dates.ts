import {
  daysBetween,
  formatInstantInZone,
  isValidDateString,
  parseOffsetTimestamp,
  shiftWallTimeByDays,
  wallTimeIn,
  zonedTimeToInstant,
  addDays,
} from '../lib/time';
import type { FestivalSeed } from './types';

export interface ShiftResult {
  seed: FestivalSeed;
  days: number;
}

function shiftTimestamp(value: string, days: number, timeZone: string): string {
  const instant = parseOffsetTimestamp(value);
  if (!instant) {
    throw new Error(`Invalid timestamp "${value}"`);
  }
  const wall = shiftWallTimeByDays(wallTimeIn(instant, timeZone), days);
  return formatInstantInZone(zonedTimeToInstant(wall, timeZone), timeZone);
}

/**
 * Moves a demo festival so it starts on `newStart`, keeping every set at the
 * same local wall-clock time in the festival's time zone (DST-safe). Used to
 * make "now/next" states live during App Review. Real festivals are refused:
 * their dates are facts.
 */
export function shiftFestivalDates(seed: FestivalSeed, newStart: string): ShiftResult {
  if (!seed.festival.is_demo) {
    throw new Error('festival:shift-dates only moves demo festivals (festival.is_demo must be true)');
  }
  if (!isValidDateString(newStart)) {
    throw new Error(`--start must be a calendar date YYYY-MM-DD (got "${newStart}")`);
  }
  const days = daysBetween(seed.festival.start_date, newStart);
  const timeZone = seed.festival.timezone;
  return {
    days,
    seed: {
      ...seed,
      festival: {
        ...seed.festival,
        start_date: addDays(seed.festival.start_date, days),
        end_date: addDays(seed.festival.end_date, days),
      },
      sets: seed.sets.map((set) => ({
        ...set,
        start_time: shiftTimestamp(set.start_time, days, timeZone),
        end_time: shiftTimestamp(set.end_time, days, timeZone),
        original_start_time: set.original_start_time ? shiftTimestamp(set.original_start_time, days, timeZone) : null,
      })),
    },
  };
}
