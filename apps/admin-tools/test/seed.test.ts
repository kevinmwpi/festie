import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { applyFestivalSeed, describeSeedPlan, nextFestivalVersion, planFestivalSeed } from '../src/festival/seed';
import { validateFestivalSeed } from '../src/festival/validate';
import { realFestival } from './fixtures';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/**
 * Just enough of supabase-js for planFestivalSeed/applyFestivalSeed: select with eq/in/order/range/
 * maybeSingle, upsert, update, delete. Every write is logged as `op:table:detail`.
 */
function fakeClient(tables: Tables, options: { missingTables?: string[] } = {}) {
  const writes: string[] = [];
  const client = {
    from(table: string) {
      const state = {
        op: 'select' as 'select' | 'upsert' | 'update' | 'delete',
        values: null as unknown,
        filters: [] as Array<(row: Row) => boolean>,
        range: null as [number, number] | null,
        single: false,
      };
      const run = () => {
        if (options.missingTables?.includes(table)) {
          return {
            data: null,
            error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` },
          };
        }
        tables[table] ??= [];
        const matching = tables[table].filter((row) => state.filters.every((filter) => filter(row)));
        switch (state.op) {
          case 'upsert': {
            const rows = state.values as Row[];
            writes.push(`upsert:${table}:${rows.length}`);
            for (const row of rows) {
              const key = table === 'festival_artists' ? (r: Row) => r.festival_id === row.festival_id && r.artist_id === row.artist_id : (r: Row) => r.id === row.id;
              const existing = tables[table].find(key);
              if (existing) {
                Object.assign(existing, row);
              } else {
                tables[table].push({ ...row });
              }
            }
            return { data: null, error: null };
          }
          case 'update':
            writes.push(`update:${table}:${matching.length}:${JSON.stringify(state.values)}`);
            for (const row of matching) {
              Object.assign(row, state.values as Row);
            }
            return { data: null, error: null };
          case 'delete':
            writes.push(`delete:${table}:${matching.map((row) => (table === 'festival_artists' ? row.artist_id : row.id)).sort().join(',')}`);
            tables[table] = tables[table].filter((row) => !matching.includes(row));
            return { data: null, error: null };
          default: {
            let rows = matching;
            if (state.range) {
              rows = rows.slice(state.range[0], state.range[1] + 1);
            }
            return { data: state.single ? (rows[0] ?? null) : rows, error: null };
          }
        }
      };
      const builder = {
        select() {
          return builder;
        },
        upsert(values: Row | Row[]) {
          state.op = 'upsert';
          state.values = Array.isArray(values) ? values : [values];
          return builder;
        },
        update(values: Row) {
          state.op = 'update';
          state.values = values;
          return builder;
        },
        delete() {
          state.op = 'delete';
          return builder;
        },
        eq(column: string, value: unknown) {
          state.filters.push((row) => row[column] === value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          state.filters.push((row) => values.includes(row[column]));
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          state.range = [from, to];
          return builder;
        },
        maybeSingle() {
          state.single = true;
          return builder;
        },
        then<T>(resolve: (value: ReturnType<typeof run>) => T) {
          return Promise.resolve(run()).then(resolve);
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, writes, tables };
}

const FESTIVAL = '11111111-1111-4111-8111-111111111111';
const ARTIST_ONE = '33333333-3333-4333-8333-333333333331';
const ARTIST_TWO = '33333333-3333-4333-8333-333333333332';
const ARTIST_GONE = '33333333-3333-4333-8333-333333333339';

describe('nextFestivalVersion', () => {
  it('always bumps past the stored version', () => {
    expect(nextFestivalVersion(null, undefined)).toBe(1);
    expect(nextFestivalVersion(3, undefined)).toBe(4);
    expect(nextFestivalVersion(3, 2)).toBe(4);
    expect(nextFestivalVersion(3, 10)).toBe(10);
    expect(nextFestivalVersion(null, 5)).toBe(5);
  });
});

describe('festival:seed and the lineup', () => {
  it('writes the lineup from the file’s artists, with billing, and reports acts without a set', async () => {
    const file = realFestival();
    file.festival.status = 'published';
    file.artists[0].billing_order = 1;
    file.sets.pop(); // Artist Two is announced but has no set yet.
    const seed = validateFestivalSeed(file).seed!;
    const { client, writes, tables } = fakeClient({ festivals: [], sets: [], stages: [], festival_artists: [], artists: [], meetups: [] });

    const plan = await planFestivalSeed(client, seed);
    expect(plan).toMatchObject({ isNew: true, nextVersion: 1, staleLineupArtistIds: [], counts: { artists: 2, sets: 1, unscheduledArtists: 1 } });
    expect(describeSeedPlan(plan)).toContain('lineup  2 artists, 1 without a set (shown as "set times to be announced")');
    expect(describeSeedPlan(plan)).toContain('delete  0 stale sets, 0 stale stages, 0 acts dropped from the lineup');

    await applyFestivalSeed(client, seed, plan);
    expect(tables.festival_artists).toEqual([
      { festival_id: FESTIVAL, artist_id: ARTIST_ONE, billing_order: 1 },
      { festival_id: FESTIVAL, artist_id: ARTIST_TWO, billing_order: null },
    ]);
    // billing_order is per festival: the global artist row never carries it.
    expect(tables.artists.map((row) => Object.keys(row).sort())).toEqual([['genre', 'id', 'name'], ['genre', 'id', 'name']]);
    // Lineup rows go in right after the artists they reference and before the version bump.
    expect(writes.map((write) => write.split(':').slice(0, 2).join(':'))).toEqual([
      'upsert:festivals',
      'upsert:artists',
      'upsert:festival_artists',
      'upsert:stages',
      'upsert:sets',
      'update:festivals',
    ]);
    expect(tables.festivals[0]).toMatchObject({ status: 'published', version: 1 });
  });

  it('removes acts dropped from the file from the lineup, after their stale sets', async () => {
    const seed = validateFestivalSeed(realFestival()).seed!;
    const { client, writes, tables } = fakeClient({
      festivals: [{ id: FESTIVAL, version: 2, status: 'published' }],
      sets: [{ id: '44444444-4444-4444-8444-444444444449', festival_id: FESTIVAL, artist_id: ARTIST_GONE, status: 'scheduled' }],
      stages: [],
      festival_artists: [
        { festival_id: FESTIVAL, artist_id: ARTIST_ONE, billing_order: 7 },
        { festival_id: FESTIVAL, artist_id: ARTIST_GONE, billing_order: null },
        // Another festival's lineup is never touched.
        { festival_id: '11111111-1111-4111-8111-111111111112', artist_id: ARTIST_GONE, billing_order: 1 },
      ],
      artists: [],
      meetups: [],
    });

    const plan = await planFestivalSeed(client, seed);
    expect(plan.staleLineupArtistIds).toEqual([ARTIST_GONE]);
    expect(plan.staleSetIds).toEqual(['44444444-4444-4444-8444-444444444449']);
    expect(plan.counts.unscheduledArtists).toBe(0);

    await applyFestivalSeed(client, seed, plan);
    expect(tables.festival_artists).toEqual([
      // Re-seeding without billing clears the old billing (the file is the source of truth).
      { festival_id: FESTIVAL, artist_id: ARTIST_ONE, billing_order: null },
      { festival_id: '11111111-1111-4111-8111-111111111112', artist_id: ARTIST_GONE, billing_order: 1 },
      { festival_id: FESTIVAL, artist_id: ARTIST_TWO, billing_order: null },
    ]);
    const deletes = writes.filter((write) => write.startsWith('delete:'));
    expect(deletes).toEqual([
      'delete:sets:44444444-4444-4444-8444-444444444449',
      `delete:festival_artists:${ARTIST_GONE}`,
    ]);
    expect(tables.festivals[0]).toMatchObject({ version: 3 });
  });

  it('fails during planning, before any write, on a project without migration 014', async () => {
    const seed = validateFestivalSeed(realFestival()).seed!;
    const { client, writes } = fakeClient({ festivals: [], sets: [], stages: [], artists: [] }, { missingTables: ['festival_artists'] });
    await expect(planFestivalSeed(client, seed)).rejects.toThrow(/festival_artists; apply migration 014/);
    expect(writes).toEqual([]);
  });
});
