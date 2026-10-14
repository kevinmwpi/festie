import {
  fetchAndCacheFestival,
  getLocalFestivalBundle,
  type Festival,
  type FestivalBundle,
} from '@festival/data-access';
import {
  festivalTimeZoneLabel,
  formatFestivalDate,
  formatFestivalTime,
  formatFestivalTimeRange,
  timesAreDeviceLocal,
} from '@festival/domain';
import { useMemo } from 'react';

import { restoreSetReminders } from '@/src/notifications/restore-reminders';
import { useAppStore } from '@/src/state/app-store';

import { formatFestivalDayLabel, formatTimeFromDay } from './festival-time-labels';
import { queryKeys } from './query-keys';
import { useCacheFirstQuery } from './use-cache-first-query';

/**
 * Downloads the festival bundle when its version changed, then brings the user's set reminders in
 * line with it (moved picks are rescheduled, cancelled picks lose their reminder). Never prompts.
 */
async function refreshBundleAndReminders(festivalId: string): Promise<FestivalBundle | null> {
  const bundle = await fetchAndCacheFestival(festivalId);
  void restoreSetReminders(festivalId);
  return bundle;
}

/**
 * A festival's cached bundle (festival, stages, artists, sets), refreshed in the background with the
 * cheap version check of `fetchAndCacheFestival` (the full bundle only downloads when it changed).
 */
export function useFestivalBundle(festivalId: string | null | undefined) {
  return useCacheFirstQuery<FestivalBundle | null>({
    queryKey: queryKeys.festivalBundle(festivalId ?? 'none'),
    readLocal: () => (festivalId ? getLocalFestivalBundle(festivalId) : Promise.resolve(null)),
    refresh: festivalId ? () => refreshBundleAndReminders(festivalId) : undefined,
    enabled: Boolean(festivalId),
    refreshStaleTime: 5 * 60_000,
  });
}

/** The active festival (app store) and its cached bundle. */
export function useActiveFestival() {
  const festivalId = useAppStore((state) => state.activeFestivalId);
  const accent = useAppStore((state) => state.activeFestivalAccent);
  const bundle = useFestivalBundle(festivalId);
  return { festivalId, accent, bundle, festival: bundle.data?.festival ?? null };
}

export interface FestivalClock {
  timeZone: string;
  /** `true` when the festival zone cannot be resolved and times are in device time. */
  deviceLocal: boolean;
  /** Short zone label, e.g. `PDT` or `GMT+2`. */
  label: string;
  /** "Times shown in festival local time (PDT)" or the device-time variant (§5.5). */
  hint: string;
  time: (iso: string) => string;
  range: (startIso: string, endIso: string) => string;
  /** Formats a day key / date-only string / timestamp as a festival date. */
  date: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  /**
   * The festival day a set or meetup belongs to (days run 06:00–06:00), matching the day tabs:
   * `Fri`, or `Fri night` for a 1:00 AM set listed under Friday. Default options: short weekday.
   */
  day: (iso: string, options?: Intl.DateTimeFormatOptions) => string;
  /**
   * `2:00 PM` when `iso` is on the same festival day as `reference` (epoch ms such as now, or another
   * timestamp), else prefixed with its festival day: `Sat 2:00 PM`.
   */
  timeFrom: (iso: string, reference: string | number) => string;
}

/**
 * The instant whose zone abbreviation labels the festival's times: now while the festival is on,
 * otherwise midday (UTC) of its first or last day, so an April festival viewed in winter reads `PDT`
 * like every time on screen rather than today's `PST`.
 */
function labelReferenceDate(startDate: string | undefined, endDate: string | undefined): Date {
  const now = new Date();
  const start = startDate ? new Date(`${startDate}T12:00:00Z`) : null;
  const end = endDate ? new Date(`${endDate}T12:00:00Z`) : null;
  if (start && !Number.isNaN(start.getTime()) && now < start) return start;
  if (end && !Number.isNaN(end.getTime()) && now > end) return end;
  return now;
}

/** Festival-time formatting helpers (§4.3) bound to one festival's time zone. */
export function useFestivalClock(
  festival: Pick<Festival, 'timezone' | 'start_date' | 'end_date'> | null | undefined,
): FestivalClock {
  const timeZone = festival?.timezone ?? '';
  const startDate = festival?.start_date;
  const endDate = festival?.end_date;
  return useMemo(() => {
    const deviceLocal = timesAreDeviceLocal(timeZone);
    const label = festivalTimeZoneLabel(timeZone, labelReferenceDate(startDate, endDate));
    return {
      timeZone,
      deviceLocal,
      label,
      hint: deviceLocal ? "Times shown in your device's time zone" : `Times shown in festival local time (${label})`,
      time: (iso: string) => formatFestivalTime(iso, timeZone),
      range: (startIso: string, endIso: string) => formatFestivalTimeRange(startIso, endIso, timeZone),
      date: (value: string, options?: Intl.DateTimeFormatOptions) => formatFestivalDate(value, timeZone, options),
      day: (iso: string, options?: Intl.DateTimeFormatOptions) => formatFestivalDayLabel(iso, timeZone, options),
      timeFrom: (iso: string, reference: string | number) => formatTimeFromDay(iso, reference, timeZone),
    };
  }, [endDate, startDate, timeZone]);
}

/** "Apr 10 – Apr 12, 2027" from date-only festival dates (calendar dates, time-zone independent). */
export function formatFestivalDateRange(festival: Pick<Festival, 'start_date' | 'end_date' | 'timezone'>): string {
  const sameYear = festival.start_date.slice(0, 4) === festival.end_date.slice(0, 4);
  const start = formatFestivalDate(festival.start_date, festival.timezone, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  if (festival.start_date === festival.end_date) {
    return formatFestivalDate(festival.start_date, festival.timezone, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const end = formatFestivalDate(festival.end_date, festival.timezone, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${start} – ${end}`;
}
