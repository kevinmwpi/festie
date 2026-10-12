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
  counts: { stages: number; artists: number; sets: number; movedSets: number; cancelledSets: number };
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
 * `status`, so a project without migration 011 fails here, during planning, before anything is written.
 */
async function selectIdsForFestival(
  client: SupabaseClient,
  table: 'sets' | 'stages',
  festivalId: string,
): Promise<Array<{ id: string }>> {
  const rows: Array<{ id: string }> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const query = table === 'sets' ? client.from('sets').select('id, status') : client.from('stages').select('id');
    const page = check(
      await query.eq('festival_id', festivalId).order('id').range(from, from + PAGE_SIZE - 1),
      `Reading existing ${table}`,
    ) as Array<{ id: string }>;
    rows.push(...page);
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

  const fileSetIds = new Set(seed.sets.map((set) => set.id));
  const fileStageIds = new Set(seed.stages.map((stage) => stage.id));

  return {
    festivalId,
    isNew: existing === null,
    currentVersion: existing?.version ?? null,
    nextVersion: nextFestivalVersion(existing?.version ?? null, seed.festival.version),
    currentStatus: existing?.status ?? null,
    nextStatus: seed.festival.status,
    staleSetIds: storedSets.map((row) => row.id).filter((id) => !fileSetIds.has(id)),
    staleStageIds: storedStages.map((row) => row.id).filter((id) => !fileStageIds.has(id)),
    counts: {
      stages: seed.stages.length,
      artists: seed.artists.length,
      sets: seed.sets.length,
      movedSets: seed.sets.filter((set) => set.status === 'moved').length,
      cancelledSets: seed.sets.filter((set) => set.status === 'cancelled').length,
    },
  };
}

export function describeSeedPlan(plan: SeedPlan): string {
  const lines = [
    `festival ${plan.festivalId}: ${plan.isNew ? 'create' : 'update'}`,
    `  version ${plan.currentVersion ?? '-'} -> ${plan.nextVersion}`,
    `  status  ${plan.currentStatus ?? '-'} -> ${plan.nextStatus}`,
    `  upsert  ${plan.counts.stages} stages, ${plan.counts.artists} artists, ${plan.counts.sets} sets`,
    `  changes ${plan.counts.movedSets} moved, ${plan.counts.cancelledSets} cancelled sets`,
    `  delete  ${plan.staleSetIds.length} stale sets, ${plan.staleStageIds.length} stale stages`,
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
 * Stale sets/stages of this festival are removed; artists are global and kept.
 */
export async function applyFestivalSeed(client: SupabaseClient, seed: FestivalSeed, plan: SeedPlan): Promise<void> {
  const { version: _requestedVersion, ...festivalColumns } = seed.festival;
  const now = new Date().toISOString();

  check(
    await client.from('festivals').upsert(
      {
        ...festivalColumns,
        image_url: null,
        map_asset_url: null,
        status: plan.isNew ? 'draft' : plan.currentStatus,
        version: plan.isNew ? plan.nextVersion : plan.currentVersion,
        updated_at: now,
      },
      { onConflict: 'id' },
    ),
    'Writing the festival',
  );

  for (const rows of chunk(seed.artists, 500)) {
    check(await client.from('artists').upsert(rows, { onConflict: 'id' }), 'Writing artists');
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
