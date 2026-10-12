/**
 * Labels for set and meetup times that agree with the festival-day grouping: festival days run from
 * 06:00 to 06:00, so a 1:00 AM set is listed under the previous day and labelled with that day.
 */
import { festivalDayKey, formatFestivalDate, formatFestivalTime } from './time';

const SHORT_WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'short' };

/** Whether `iso` falls after midnight but belongs to the previous festival day (e.g. a 1:00 AM set). */
export function isAfterMidnight(iso: string, timeZone: string): boolean {
  return festivalDayKey(iso, timeZone) !== festivalDayKey(iso, timeZone, 0);
}

/**
 * The festival day `iso` belongs to, e.g. `Fri`, or `Fri night` for a set after midnight that is listed
 * under Friday. `options` are `Intl.DateTimeFormat` date options (default: short weekday).
 */
export function formatFestivalDayLabel(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions = SHORT_WEEKDAY): string {
  let dayKey: string;
  try {
    dayKey = festivalDayKey(iso, timeZone);
  } catch {
    // Not a timestamp the day logic understands: fall back to its plain date.
    return formatFestivalDate(iso, timeZone, options);
  }
  const day = formatFestivalDate(dayKey, timeZone, options);
  return isAfterMidnight(iso, timeZone) ? `${day} night` : day;
}

/**
 * `2:00 PM` when `iso` is on the same festival day as `reference` (now, or another item's start);
 * otherwise `Sat 2:00 PM` (`Fri night 1:00 AM` after midnight), so a time never reads as "today" when
 * it is not.
 */
export function formatTimeFromDay(iso: string, reference: string | number | Date, timeZone: string): string {
  const time = formatFestivalTime(iso, timeZone);
  const referenceDate = typeof reference === 'number' ? new Date(reference) : reference;
  if (festivalDayKey(iso, timeZone) === festivalDayKey(referenceDate, timeZone)) {
    return time;
  }
  return `${formatFestivalDayLabel(iso, timeZone)} ${time}`;
}
