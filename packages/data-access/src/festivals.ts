import { getDb, replaceRowsForFestival, upsertRows, withDbTransaction, type LocalDatabase } from '@festival/sync-engine';

import { createChangeTracker, withRefreshGuard } from './cache';
import { getErrorCode } from './errors';
import { createId } from './ids';
import type { Artist, Festival, FestivalBundle, FestivalLineupRow, FestivalSet, LocalUserFestival, Stage } from './models';
import { readOptionalRow, selectAllRows, selectAllRowsIn } from './paging';
import { getCachedProfile, requireCachedProfile } from './profile';
import { requireStoredSession } from './session';
import { getSupabase, unwrapResult } from './supabase';

export const FESTIVAL_COLUMNS =
  'id, name, start_date, end_date, timezone, venue_name, accent_color, image_url, map_asset_url, version, status, is_demo, latitude, longitude, default_zoom, bounds_sw_lat, bounds_sw_lng, bounds_ne_lat, bounds_ne_lng, source_url, updated_at';
export const STAGE_COLUMNS = 'id, festival_id, name, zone, latitude, longitude';
export const SET_COLUMNS =
  'id, festival_id, artist_id, stage_id, start_time, end_time, set_type, status, original_start_time, change_note';
/** `SET_COLUMNS` prefixed with `sets.`, for local SQL that joins sets with other tables. */
export const QUALIFIED_SET_COLUMNS = SET_COLUMNS.split(', ')
  .map((column) => `sets.${column}`)
  .join(', ');
export const ARTIST_COLUMNS = 'id, name, image_url, genre';
const USER_FESTIVAL_COLUMNS = 'id, user_id, festival_id, selected_at';
const IN_FILTER_CHUNK = 150;

type LocalFestivalRow = Omit<Festival, 'is_demo'> & { is_demo: number | boolean; bundle_version?: number | null };

function toFestival(row: LocalFestivalRow): Festival {
  const { bundle_version: _bundleVersion, ...festival } = row;
  return { ...festival, is_demo: festival.is_demo === true || Number(festival.is_demo) === 1 };
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function deleteFestivalsLocally(db: LocalDatabase, festivalIds: string[]): Promise<void> {
  for (const ids of chunk(festivalIds, IN_FILTER_CHUNK)) {
    const marks = placeholders(ids.length);
    await db.runAsync(`DELETE FROM sets WHERE festival_id IN (${marks});`, ids);
    await db.runAsync(`DELETE FROM stages WHERE festival_id IN (${marks});`, ids);
    await db.runAsync(`DELETE FROM festivals WHERE id IN (${marks});`, ids);
  }
  await db.runAsync('DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM sets);');
}

/** Cached festivals (published as of the last refresh); demo festivals sort last. */
export async function getLocalFestivals(): Promise<Festival[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalFestivalRow>('SELECT * FROM festivals ORDER BY is_demo ASC, start_date ASC, name ASC;');
  return rows.map(toFestival);
}

export async function getLocalFestival(festivalId: string): Promise<Festival | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<LocalFestivalRow>('SELECT * FROM festivals WHERE id = ?;', [festivalId]);
  return row ? toFestival(row) : null;
}

/**
 * Fetches the published festival list (light columns), upserts it and deletes cached festivals,
 * stages and sets that are no longer published. Call on launch and pull-to-refresh when online.
 */
export async function refreshFestivalCatalog(): Promise<Festival[]> {
  const client = getSupabase();
  const festivals = await selectAllRows<Festival>((options) =>
    client.from('festivals').select(FESTIVAL_COLUMNS, options).eq('status', 'published').order('id', { ascending: true }),
  );
  const publishedIds = new Set(festivals.map((festival) => festival.id));

  await withDbTransaction(async (tx) => {
    await upsertRows('festivals', festivals as unknown as Array<Record<string, unknown>>, tx);
    const local = await tx.getAllAsync<{ id: string }>('SELECT id FROM festivals;');
    const removed = local.map((row) => row.id).filter((id) => !publishedIds.has(id));
    if (removed.length > 0) {
      await deleteFestivalsLocally(tx, removed);
    }
  });

  return getLocalFestivals();
}

async function fetchArtists(artistIds: string[]): Promise<Artist[]> {
  const client = getSupabase();
  return selectAllRowsIn<Artist>(artistIds, (ids, options) =>
    client.from('artists').select(ARTIST_COLUMNS, options).in('id', ids).order('id', { ascending: true }),
  );
}

/**
 * Makes sure the full bundle (stages, sets, artists) of a festival is cached. A light
 * `select id, version` runs first; the bundle is downloaded only when the version changed. Resolves the
 * cached bundle, or `null` when the festival is no longer published (it is then removed locally).
 */
export async function fetchAndCacheFestival(festivalId: string): Promise<FestivalBundle | null> {
  const client = getSupabase();
  // `count` tells PostgREST's "not published" (count 0) apart from an empty reply from something else,
  // which must not delete the cached festival.
  const light = readOptionalRow<{ id: string; version: number }>(
    await client.from('festivals').select('id, version', { count: 'exact' }).eq('id', festivalId).maybeSingle(),
  );

  const db = await getDb();
  if (!light) {
    await withDbTransaction((tx) => deleteFestivalsLocally(tx, [festivalId]));
    return null;
  }

  const local = await db.getFirstAsync<{ bundle_version: number | null }>('SELECT bundle_version FROM festivals WHERE id = ?;', [
    festivalId,
  ]);
  if (local && local.bundle_version !== null && Number(local.bundle_version) === light.version) {
    return getLocalFestivalBundle(festivalId);
  }

  const festival = readOptionalRow<Festival>(
    await client.from('festivals').select(FESTIVAL_COLUMNS, { count: 'exact' }).eq('id', festivalId).maybeSingle(),
  );
  if (!festival) {
    await withDbTransaction((tx) => deleteFestivalsLocally(tx, [festivalId]));
    return null;
  }

  // Paged: a festival can have more sets than PostgREST returns per request, and a truncated bundle
  // would be cached under the current version and never fetched again.
  const stages = await selectAllRows<Stage>((options) =>
    client.from('stages').select(STAGE_COLUMNS, options).eq('festival_id', festivalId).order('id', { ascending: true }),
  );
  const sets = await selectAllRows<FestivalSet>((options) =>
    client.from('sets').select(SET_COLUMNS, options).eq('festival_id', festivalId).order('id', { ascending: true }),
  );
  const artists = await fetchArtists([...new Set(sets.map((set) => set.artist_id))]);

  await withDbTransaction(async (tx) => {
    await upsertRows('festivals', [{ ...festival, bundle_version: festival.version }], tx);
    await replaceRowsForFestival('stages', festivalId, stages as unknown as Array<Record<string, unknown>>, tx);
    await replaceRowsForFestival('sets', festivalId, sets as unknown as Array<Record<string, unknown>>, tx);
    await upsertRows('artists', artists as unknown as Array<Record<string, unknown>>, tx);
  });

  return getLocalFestivalBundle(festivalId);
}

export async function getLocalFestivalBundle(festivalId: string): Promise<FestivalBundle | null> {
  const db = await getDb();
  const festivalRow = await db.getFirstAsync<LocalFestivalRow>('SELECT * FROM festivals WHERE id = ?;', [festivalId]);
  if (!festivalRow) {
    return null;
  }

  const stages = await db.getAllAsync<Stage>(`SELECT ${STAGE_COLUMNS} FROM stages WHERE festival_id = ? ORDER BY name ASC;`, [festivalId]);
  const sets = await db.getAllAsync<FestivalSet>(`SELECT ${SET_COLUMNS} FROM sets WHERE festival_id = ? ORDER BY start_time ASC;`, [
    festivalId,
  ]);
  const artists = await db.getAllAsync<Artist>(
    `SELECT ${ARTIST_COLUMNS} FROM artists WHERE id IN (SELECT DISTINCT artist_id FROM sets WHERE festival_id = ?) ORDER BY name ASC;`,
    [festivalId],
  );

  return { festival: toFestival(festivalRow), stages, artists, sets };
}

/** True once the festival's stages/sets have been cached at least once. */
export async function hasCachedFestivalBundle(festivalId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ bundle_version: number | null }>('SELECT bundle_version FROM festivals WHERE id = ?;', [festivalId]);
  return Boolean(row && row.bundle_version !== null);
}

export async function getLocalFestivalLineup(festivalId: string): Promise<FestivalLineupRow[]> {
  const db = await getDb();
  return db.getAllAsync<FestivalLineupRow>(
    `SELECT ${QUALIFIED_SET_COLUMNS},
            artists.name AS artist_name, artists.image_url AS artist_image_url, artists.genre AS genre,
            stages.name AS stage_name, stages.zone AS stage_zone
     FROM sets
     INNER JOIN artists ON artists.id = sets.artist_id
     INNER JOIN stages ON stages.id = sets.stage_id
     WHERE sets.festival_id = ?
     ORDER BY sets.start_time ASC;`,
    [festivalId],
  );
}

// ---- Followed festivals (user_festivals) --------------------------------------------------------

/** Festivals the signed-in user follows, from the local cache (empty without a cached profile). */
export async function getLocalUserFestivals(): Promise<LocalUserFestival[]> {
  const profile = getCachedProfile();
  if (!profile) {
    return [];
  }

  const db = await getDb();
  return db.getAllAsync<LocalUserFestival>(
    `SELECT ${USER_FESTIVAL_COLUMNS} FROM user_festivals WHERE user_id = ? ORDER BY selected_at ASC;`,
    [profile.id],
  );
}

/** Festivals followed or unfollowed while a `refreshUserFestivals` is in flight (see `ChangeTracker`). */
const userFestivalChanges = createChangeTracker();

/**
 * Replaces the cached followed festivals with the server's list. A festival followed or unfollowed
 * while the fetch is in flight keeps its local state (the fetched list may predate it).
 */
export async function refreshUserFestivals(): Promise<LocalUserFestival[]> {
  const profile = requireCachedProfile();
  await userFestivalChanges.track((changedDuringRefresh) =>
    withRefreshGuard(async (guard) => {
      const client = getSupabase();
      const rows = await selectAllRows<LocalUserFestival>((options) =>
        client.from('user_festivals').select(USER_FESTIVAL_COLUMNS, options).eq('user_id', profile.id).order('id', { ascending: true }),
      );

      await withDbTransaction(async (tx) => {
        if (guard.stale) {
          return;
        }
        const kept = [...changedDuringRefresh];
        await tx.runAsync(
          kept.length
            ? `DELETE FROM user_festivals WHERE user_id = ? AND festival_id NOT IN (${placeholders(kept.length)});`
            : 'DELETE FROM user_festivals WHERE user_id = ?;',
          [profile.id, ...kept],
        );
        await upsertRows(
          'user_festivals',
          rows.filter((row) => !changedDuringRefresh.has(row.festival_id)) as unknown as Array<Record<string, unknown>>,
          tx,
        );
      });
    }),
  );

  return getLocalUserFestivals();
}

/** Follows a festival (online write; already following is not an error). */
export async function followFestival(festivalId: string): Promise<void> {
  const profile = requireCachedProfile();
  requireStoredSession();
  const row: LocalUserFestival = {
    id: createId(),
    user_id: profile.id,
    festival_id: festivalId,
    selected_at: new Date().toISOString(),
  };
  const { error, status } = await getSupabase().from('user_festivals').insert(row);
  if (error && getErrorCode(error) !== '23505') {
    unwrapResult({ data: null, error, status });
  }

  userFestivalChanges.note(festivalId);
  const db = await getDb();
  const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM user_festivals WHERE user_id = ? AND festival_id = ?;', [
    profile.id,
    festivalId,
  ]);
  if (!existing) {
    await upsertRows('user_festivals', [row as unknown as Record<string, unknown>]);
  }
}

/** Unfollows a festival (online write). */
export async function unfollowFestival(festivalId: string): Promise<void> {
  const profile = requireCachedProfile();
  requireStoredSession();
  unwrapResult(await getSupabase().from('user_festivals').delete().eq('user_id', profile.id).eq('festival_id', festivalId));
  userFestivalChanges.note(festivalId);
  const db = await getDb();
  await db.runAsync('DELETE FROM user_festivals WHERE user_id = ? AND festival_id = ?;', [profile.id, festivalId]);
}

/** Follows or unfollows; resolves `true` when the festival is now followed. */
export async function toggleUserFestival(festivalId: string): Promise<boolean> {
  const followed = (await getLocalUserFestivals()).some((row) => row.festival_id === festivalId);
  if (followed) {
    await unfollowFestival(festivalId);
    return false;
  }

  await followFestival(festivalId);
  return true;
}
