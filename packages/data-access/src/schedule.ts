import { detectConflict, isCancelledSet } from '@festival/domain';
import { enqueue, flush, getDb, withDbTransaction } from '@festival/sync-engine';

import { SELECTION_COLUMNS, mergeOwnSelections, withRefreshGuard } from './cache';
import { QUALIFIED_SET_COLUMNS } from './festivals';
import { createId } from './ids';
import type { FestivalLineupRow, FestivalSet, LocalSelection, UserSetSelectionRow } from './models';
import { selectAllRows } from './paging';
import { getCachedProfile, requireCachedProfile } from './profile';
import { getSupabase } from './supabase';

export interface ScheduleRow extends FestivalLineupRow {
  selection_id: string | null;
  selected_at: string | null;
  note: string | null;
  /** 1 while the selection is waiting to sync. */
  selection_pending: number | null;
}

const SCHEDULE_SELECT = `SELECT ${QUALIFIED_SET_COLUMNS},
            artists.name AS artist_name, artists.image_url AS artist_image_url, artists.genre AS genre,
            stages.name AS stage_name, stages.zone AS stage_zone,
            user_set_selections.id AS selection_id, user_set_selections.selected_at AS selected_at,
            user_set_selections.note AS note, user_set_selections.pending_sync AS selection_pending`;

/**
 * Re-reads the signed-in user's selections for a festival from the server and merges them into the
 * cache: rows with `pending_sync = 1` are never dropped and rows with a queued delete are never
 * resurrected — including operations that a concurrent flush completes while the fetch is in flight.
 * Resolves the merged local selections.
 */
export async function refreshUserSelections(festivalId: string): Promise<LocalSelection[]> {
  const profile = requireCachedProfile();
  await withRefreshGuard(async (guard) => {
    const client = getSupabase();
    const remote = await selectAllRows<UserSetSelectionRow>((options) =>
      client
        .from('user_set_selections')
        .select(SELECTION_COLUMNS, options)
        .eq('festival_id', festivalId)
        .eq('user_id', profile.id)
        .order('id', { ascending: true }),
    );

    await withDbTransaction(async (tx) => {
      if (guard.stale) {
        return;
      }
      await mergeOwnSelections(tx, profile.id, festivalId, remote, await guard.protectedSelectionSetIds(tx, profile.id));
    });
  });
  return getLocalSelections(festivalId);
}

/** The signed-in user's cached selections for a festival. */
export async function getLocalSelections(festivalId: string): Promise<LocalSelection[]> {
  const profile = getCachedProfile();
  if (!profile) {
    return [];
  }

  const db = await getDb();
  return db.getAllAsync<LocalSelection>(
    `SELECT ${SELECTION_COLUMNS}, pending_sync, synced_at FROM user_set_selections WHERE user_id = ? AND festival_id = ? ORDER BY selected_at ASC;`,
    [profile.id, festivalId],
  );
}

/** Full lineup with the signed-in user's selection state per set (cache only). */
export async function getBrowseSchedule(festivalId: string): Promise<ScheduleRow[]> {
  const userId = getCachedProfile()?.id ?? '';
  const db = await getDb();
  return db.getAllAsync<ScheduleRow>(
    `${SCHEDULE_SELECT}
     FROM sets
     INNER JOIN artists ON artists.id = sets.artist_id
     INNER JOIN stages ON stages.id = sets.stage_id
     LEFT JOIN user_set_selections
       ON user_set_selections.set_id = sets.id
      AND user_set_selections.user_id = ?
     WHERE sets.festival_id = ?
     GROUP BY sets.id
     ORDER BY sets.start_time ASC;`,
    [userId, festivalId],
  );
}

/** Only the sets the signed-in user selected (cache only). */
export async function getSelectedSchedule(festivalId: string): Promise<ScheduleRow[]> {
  const profile = getCachedProfile();
  if (!profile) {
    return [];
  }

  const db = await getDb();
  return db.getAllAsync<ScheduleRow>(
    `${SCHEDULE_SELECT}
     FROM user_set_selections
     INNER JOIN sets ON sets.id = user_set_selections.set_id
     INNER JOIN artists ON artists.id = sets.artist_id
     INNER JOIN stages ON stages.id = sets.stage_id
     WHERE user_set_selections.user_id = ?
       AND user_set_selections.festival_id = ?
     GROUP BY sets.id
     ORDER BY sets.start_time ASC;`,
    [profile.id, festivalId],
  );
}

/**
 * Selects or unselects a set for the signed-in user through the offline queue. Resolves `true` when
 * the set is now selected.
 */
export async function toggleSetSelection(festivalId: string, setId: string): Promise<boolean> {
  const profile = requireCachedProfile();
  const db = await getDb();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM user_set_selections WHERE user_id = ? AND set_id = ? LIMIT 1;',
    [profile.id, setId],
  );
  const now = new Date().toISOString();

  if (existing) {
    await enqueue({
      table: 'user_set_selections',
      type: 'delete',
      payload: { id: existing.id, user_id: profile.id, set_id: setId },
      created_at: now,
    });
    return false;
  }

  await enqueue({
    table: 'user_set_selections',
    type: 'upsert',
    payload: {
      id: createId(),
      user_id: profile.id,
      festival_id: festivalId,
      set_id: setId,
      selected_at: now,
      note: null,
    },
    created_at: now,
  });
  return true;
}

/**
 * Ids of sets that overlap another set in `rows`. Back-to-back sets do not conflict, and cancelled
 * sets conflict with nothing.
 */
export function getConflictSetIds(
  rows: ReadonlyArray<Pick<FestivalSet, 'id' | 'start_time' | 'end_time'> & { status?: string | null }>,
): Set<string> {
  const ordered = rows
    .filter((row) => !isCancelledSet(row))
    .sort((left, right) => Date.parse(left.start_time) - Date.parse(right.start_time));
  const conflictIds = new Set<string>();

  for (let index = 0; index < ordered.length; index += 1) {
    for (let inner = index + 1; inner < ordered.length; inner += 1) {
      if (Date.parse(ordered[inner].start_time) >= Date.parse(ordered[index].end_time)) {
        break;
      }
      if (detectConflict(ordered[index], ordered[inner])) {
        conflictIds.add(ordered[index].id);
        conflictIds.add(ordered[inner].id);
      }
    }
  }

  return conflictIds;
}

/** Lineup with `is_conflicting` set on selected sets that overlap another selected set. */
export async function getLineupWithConflicts(festivalId: string): Promise<Array<ScheduleRow & { is_conflicting: boolean }>> {
  const lineup = await getBrowseSchedule(festivalId);
  const conflictIds = getConflictSetIds(lineup.filter((row) => row.selection_id));
  return lineup.map((row) => ({ ...row, is_conflicting: conflictIds.has(row.id) }));
}

/** Pushes queued changes, then merges the server's selections (online). */
export async function refreshSchedule(festivalId: string): Promise<LocalSelection[]> {
  await flush();
  return refreshUserSelections(festivalId);
}
