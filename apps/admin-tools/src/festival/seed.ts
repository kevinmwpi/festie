import type { SupabaseClient } from '@supabase/supabase-js';

import { check } from '../env';
import type { FestivalSeed } from './types';

export interface SeedPlan {
  festivalId: string;
  isNew: boolean;
  currentVersion: number | null;
  nextVersion: number;
  currentStatus: string | null;
  nextStatus: string;
  staleSetIds: string[];
  staleStageIds: string[];
  /** Artists listed in the stored lineup (festival_artists) but no longer in the file. */
  staleLineupArtistIds: string[];
  counts: {
    stages: number;
    artists: number;
    sets: number;
    movedSets: number;
    cancelledSets: number;
    /** Artists in the file without a set: shown as "set times to be announced". */
    unscheduledArtists: number;
  };
}

/** Next version: always bumps past the stored one (clients refetch on change). */
export function nextFestivalVersion(currentVersion: number | null, requestedVersion: number | undefined): number {
  return Math.max((currentVersion ?? 0) + 1, requestedVersion ?? 1);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

const PAGE_SIZE = 1000;

/**
 * All ids of a festival's child rows (PostgREST caps each response at max_rows). Sets also read
 * `status`, so a project without migration 011 fails here, during planning, before anything is
 * written; the lineup read does the same for a project without migration 014.
 */
async function selectIdsForFestival(
  client: SupabaseClient,
  table: 'sets' | 'stages' | 'festival_artists',
  festivalId: string,
): Promise<string[]> {
  const rows: string[] = [];
  const idColumn = table === 'festival_artists' ? 'artist_id' : 'id';
  for (let from = 0; ; from += PAGE_SIZE) {
    const query =
      table === 'sets'
        ? client.from('sets').select('id, status')
        : table === 'stages'
          ? client.from('stages').select('id')
          : client.from('festival_artists').select('artist_id');
    const response = (await query.eq('festival_id', festivalId).order(idColumn).range(from, from + PAGE_SIZE - 1)) as {
      data: Array<Record<string, string>> | null;
      error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null;
    };
    const page =
      check(
        response,
        table === 'festival_artists'
          ? 'Reading the existing lineup (festival_artists; apply migration 014 with `npx supabase db push` first)'
          : `Reading existing ${table}`,
      ) ?? [];
    rows.push(...page.map((row) => row[idColumn]));
    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

export async function planFestivalSeed(client: SupabaseClient, seed: FestivalSeed): Promise<SeedPlan> {
  const festivalId = seed.festival.id;
  const existing = check(
    await client.from('festivals').select('id, version, status').eq('id', festivalId).maybeSingle(),
    'Reading the festival',
  ) as { id: string; version: number; status: string } | null;

  const storedSets = await selectIdsForFestival(client, 'sets', festivalId);
  const storedStages = await selectIdsForFestival(client, 'stages', festivalId);
  const storedLineup = await selectIdsForFestival(client, 'festival_artists', festivalId);

  const fileSetIds = new Set(seed.sets.map((set) => set.id));
  const fileStageIds = new Set(seed.stages.map((stage) => stage.id));
  const fileArtistIds = new Set(seed.artists.map((artist) => artist.id));
  const scheduledArtistIds = new Set(seed.sets.map((set) => set.artist_id));

  return {
    festivalId,
    isNew: existing === null,
    currentVersion: existing?.version ?? null,
    nextVersion: nextFestivalVersion(existing?.version ?? null, seed.festival.version),
    currentStatus: existing?.status ?? null,
    nextStatus: seed.festival.status,
    staleSetIds: storedSets.filter((id) => !fileSetIds.has(id)),
    staleStageIds: storedStages.filter((id) => !fileStageIds.has(id)),
    staleLineupArtistIds: storedLineup.filter((id) => !fileArtistIds.has(id)),
    counts: {
      stages: seed.stages.length,
      artists: seed.artists.length,
      sets: seed.sets.length,
      movedSets: seed.sets.filter((set) => set.status === 'moved').length,
      cancelledSets: seed.sets.filter((set) => set.status === 'cancelled').length,
      unscheduledArtists: seed.artists.filter((artist) => !scheduledArtistIds.has(artist.id)).length,
    },
  };
}

export function describeSeedPlan(plan: SeedPlan): string {
  const lines = [
    `festival ${plan.festivalId}: ${plan.isNew ? 'create' : 'update'}`,
    `  version ${plan.currentVersion ?? '-'} -> ${plan.nextVersion}`,
    `  status  ${plan.currentStatus ?? '-'} -> ${plan.nextStatus}`,
    `  upsert  ${plan.counts.stages} stages, ${plan.counts.artists} artists, ${plan.counts.sets} sets`,
    `  lineup  ${plan.counts.artists} artists, ${plan.counts.unscheduledArtists} without a set (shown as "set times to be announced")`,
    `  changes ${plan.counts.movedSets} moved, ${plan.counts.cancelledSets} cancelled sets`,
    `  delete  ${plan.staleSetIds.length} stale sets, ${plan.staleStageIds.length} stale stages, ${plan.staleLineupArtistIds.length} acts dropped from the lineup`,
  ];
  if (plan.staleSetIds.length > 0) {
    lines.push(
      '  note    deleting a set also deletes users\' picks of it; to keep them, keep the set with status "cancelled"',
    );
  }
  return lines.join('\n');
}

/**
 * Writes a validated festival. Order keeps clients consistent: the festival
 * row keeps its current status/version while children change, then status and
 * the bumped version are written last (clients refetch when version changes).
 * Stale sets/stages/lineup rows of this festival are removed; artists are
 * global and kept. The lineup (festival_artists) is exactly the file's
 * `artists`, so every set's artist is in it (the validator requires that).
 */
export async function applyFestivalSeed(client: SupabaseClient, seed: FestivalSeed, plan: SeedPlan): Promise<void> {
  const { version: _requestedVersion, ...festivalColumns } = seed.festival;
  const now = new Date().toISOString();

  // image_url and its credit columns are registry-managed (media:upload); never touch them here.
  const { image_url: _imageUrl, ...festivalRow } = festivalColumns as typeof festivalColumns & { image_url?: unknown };
  check(
    await client.from('festivals').upsert(
      {
        ...festivalRow,
        map_asset_url: null,
        status: plan.isNew ? 'draft' : plan.currentStatus,
        version: plan.isNew ? plan.nextVersion : plan.currentVersion,
        updated_at: now,
      },
      { onConflict: 'id' },
    ),
    'Writing the festival',
  );

  // billing_order belongs to the festival's lineup row, not to the global artist.
  const artistRows = seed.artists.map(({ billing_order: _billingOrder, ...artist }) => artist);
  for (const rows of chunk(artistRows, 500)) {
    check(await client.from('artists').upsert(rows, { onConflict: 'id' }), 'Writing artists');
  }
  const lineupRows = seed.artists.map((artist) => ({
    festival_id: seed.festival.id,
    artist_id: artist.id,
    billing_order: artist.billing_order ?? null,
  }));
  for (const rows of chunk(lineupRows, 500)) {
    check(await client.from('festival_artists').upsert(rows, { onConflict: 'festival_id,artist_id' }), 'Writing the lineup');
  }
  for (const rows of chunk(seed.stages, 500)) {
    check(await client.from('stages').upsert(rows, { onConflict: 'id' }), 'Writing stages');
  }
  for (const rows of chunk(seed.sets, 500)) {
    check(await client.from('sets').upsert(rows, { onConflict: 'id' }), 'Writing sets');
  }

  for (const ids of chunk(plan.staleSetIds, 200)) {
    // user_set_selections rows cascade with the set.
    check(await client.from('sets').delete().in('id', ids), 'Deleting stale sets');
  }
  for (const ids of chunk(plan.staleLineupArtistIds, 200)) {
    check(
      await client.from('festival_artists').delete().eq('festival_id', seed.festival.id).in('artist_id', ids),
      'Removing acts dropped from the lineup',
    );
  }
  for (const ids of chunk(plan.staleStageIds, 200)) {
    check(
      await client.from('meetups').update({ stage_id: null }).in('stage_id', ids),
      'Detaching meetups from stale stages',
    );
    check(await client.from('stages').delete().in('id', ids), 'Deleting stale stages');
  }

  check(
    await client
      .from('festivals')
      .update({ status: seed.festival.status, version: plan.nextVersion, updated_at: new Date().toISOString() })
      .eq('id', seed.festival.id),
    'Publishing the festival version',
  );
}
