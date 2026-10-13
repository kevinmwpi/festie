/**
 * Announcement mode (server migration 014): a festival can be published with its lineup before the
 * organizer publishes set times. `festival_artists` lists every announced act; sets arrive later,
 * sometimes one day or stage at a time.
 */
export type LineupAvailability =
  /** No artists and no sets: the lineup is not out yet. */
  | 'empty'
  /** Artists announced, no set yet: "set times to be announced". */
  | 'tba'
  /** Some artists have sets, others are still waiting for a time. */
  | 'partial'
  /** Every announced artist has a set. */
  | 'scheduled';

export interface LineupCounts {
  /** Sets of the festival, any status. */
  setCount: number;
  /** Announced artists without any set in this festival. */
  unscheduledCount: number;
}

export function describeLineupAvailability({ setCount, unscheduledCount }: LineupCounts): LineupAvailability {
  if (setCount <= 0) {
    return unscheduledCount > 0 ? 'tba' : 'empty';
  }
  return unscheduledCount > 0 ? 'partial' : 'scheduled';
}

/** "1 artist" / "12 artists" for copy that counts announced acts. */
export function formatArtistCount(count: number): string {
  return `${count} ${count === 1 ? 'artist' : 'artists'}`;
}
