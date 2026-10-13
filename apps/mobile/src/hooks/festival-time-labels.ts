/**
 * Labels for set and meetup times that agree with the festival-day grouping (§4.3). The festival-day
 * rules live in `@festival/domain` (shared with `describeSetChange`); this file adds the app-only
 * day-pill label.
 */
import { formatFestivalDate } from '@festival/domain';

export { formatFestivalDayLabel, formatTimeFromDay, isAfterMidnight } from '@festival/domain';

const SHORT_WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'short' };

/**
 * Compact day-pill label with the weekday first, e.g. `Sat 10` — the order used everywhere else in the
 * app. (`{ weekday: 'short', day: 'numeric' }` in one Intl call yields `10 Sat` in en-US.)
 */
export function formatWeekdayDayLabel(value: string, timeZone: string): string {
  return `${formatFestivalDate(value, timeZone, SHORT_WEEKDAY)} ${formatFestivalDate(value, timeZone, { day: 'numeric' })}`;
}
