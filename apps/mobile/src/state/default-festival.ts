import type { Festival } from '@festival/data-access';

/** Today's calendar date on the device, `YYYY-MM-DD` (compared with festival `end_date`). */
export function localTodayKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function hasFestivalEnded(festival: Pick<Festival, 'end_date'>, today: string): boolean {
  return festival.end_date < today;
}

/**
 * Order for the Fests list: festivals that have not ended (soonest first), then ended ones (most
 * recent first), then demo ("Sample") festivals.
 */
export function orderFestivalsForList<T extends Pick<Festival, 'is_demo' | 'start_date' | 'end_date' | 'name'>>(
  festivals: readonly T[],
  today: string,
): T[] {
  const rank = (festival: T) => (festival.is_demo ? 2 : hasFestivalEnded(festival, today) ? 1 : 0);
  return [...festivals].sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) return byRank;
    const byStart = left.start_date.localeCompare(right.start_date);
    return (rank(left) === 1 ? -byStart : byStart) || left.name.localeCompare(right.name);
  });
}

/**
 * The default-festival rule as a pure function. Tiers, in order: followed festivals, published real
 * festivals, the demo festival. A festival that has not ended (`end_date >= today`) in any tier wins
 * over an ended one in an earlier tier, so a finished festival never hides an upcoming one (or the
 * demo); only when every festival has ended does the first tier's first festival win.
 */
export function pickDefaultFestival(published: readonly Festival[], followedIds: readonly string[], today: string): Festival | null {
  const live = published.filter((festival) => festival.status === 'published');
  const byId = new Map(live.map((festival) => [festival.id, festival]));
  const tiers = [
    followedIds.map((id) => byId.get(id)).filter((festival): festival is Festival => festival !== undefined),
    live.filter((festival) => !festival.is_demo),
    live.filter((festival) => festival.is_demo),
  ];
  for (const tier of tiers) {
    const notEnded = tier.find((festival) => festival.end_date >= today);
    if (notEnded) {
      return notEnded;
    }
  }
  return tiers.find((tier) => tier.length > 0)?.[0] ?? null;
}
