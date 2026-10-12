import { formatTimeFromDay } from './day-labels';

/**
 * Schedule changes (`sets.status`, server migration 011). A moved set keeps its id, so users'
 * picks and reminders follow it; a cancelled set stays listed so people can see what happened.
 */
export const SET_STATUSES = ['scheduled', 'moved', 'cancelled'] as const;
export type SetStatus = (typeof SET_STATUSES)[number];

export interface SetChangeFields {
  start_time: string;
  status?: string | null;
  original_start_time?: string | null;
  change_note?: string | null;
}

export interface SetChange {
  status: SetStatus;
  /** Chip text: `Moved`, `Cancelled`, or null for a note on a set that kept its slot. */
  label: string | null;
  /**
   * Where a moved set used to be, labelled like every other time in the app: `11:00 PM` on the same
   * festival day, else `Sat 11:00 PM` (`Sat night 1:00 AM` after midnight).
   */
  previousTime: string | null;
  note: string | null;
  /** One sentence for screen readers, e.g. `Moved, was Sat 11:00 PM. Weather.` */
  accessibilityLabel: string;
}

/** Missing or unknown values (an older cache, a newer server) read as `scheduled`. */
export function parseSetStatus(value: string | null | undefined): SetStatus {
  return (SET_STATUSES as readonly string[]).includes(value ?? '') ? (value as SetStatus) : 'scheduled';
}

export function isCancelledSet(set: { status?: string | null }): boolean {
  return parseSetStatus(set.status) === 'cancelled';
}

function trimmedNote(value: string | null | undefined): string | null {
  const note = value?.trim();
  return note ? note : null;
}

function previousTimeLabel(set: SetChangeFields, timeZone: string): string | null {
  const original = set.original_start_time;
  if (!original || Number.isNaN(new Date(original).getTime())) {
    return null;
  }
  if (new Date(original).getTime() === new Date(set.start_time).getTime()) {
    return null;
  }
  return formatTimeFromDay(original, set.start_time, timeZone);
}

/** What to show about a set's schedule change, or null when it simply happens as planned. */
export function describeSetChange(set: SetChangeFields, timeZone: string): SetChange | null {
  const status = parseSetStatus(set.status);
  const note = trimmedNote(set.change_note);
  if (status === 'scheduled' && !note) {
    return null;
  }

  const label = status === 'moved' ? 'Moved' : status === 'cancelled' ? 'Cancelled' : null;
  const previousTime = status === 'moved' ? previousTimeLabel(set, timeZone) : null;
  const headline = label ? (previousTime ? `${label}, was ${previousTime}` : label) : null;
  const accessibilityLabel = [headline, note]
    .filter((part): part is string => Boolean(part))
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ');

  return { status, label, previousTime, note, accessibilityLabel };
}
