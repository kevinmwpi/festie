import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@festival/sync-engine';

import { LINEUP_COLUMNS, fetchAndCacheFestival, getLocalFestivalBundle, getLocalUnscheduledArtists, refreshFestivalCatalog } from '../src/festivals';
import { getBrowseSchedule } from '../src/schedule';
import { setupDataAccessTest, storeProfile, storeSession, teardownDataAccessTest } from './helpers';
import type { FakeSupabase, QueryCall } from './mocks/supabase-client';

const FESTIVAL = 'f1';
const OTHER = 'f2';

function festivalRow(id: string, version: number) {
  return { id, name: `Fest ${id}`, start_date: '2027-06-01', end_date: '2027-06-02', timezone: 'UTC', version, status: 'published', is_demo: false };
}

function serverSet(id: string, artistId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    festival_id: FESTIVAL,
    artist_id: artistId,
    stage_id: 'stage-1',
    start_time: '2027-06-01T20:00:00Z',
    end_time: '2027-06-01T21:00:00Z',
    set_type: 'performance',
    status: 'scheduled',
    original_start_time: null,
    change_note: null,
    ...overrides,
  };
}

interface Server {
  version: number;
  sets: Array<Record<string, unknown>>;
  lineup: Array<{ festival_id: string; artist_id: string; billing_order: number | null }>;
  artists: Record<string, string>;
  /** Replies to `festival_artists` reads with this PostgREST error instead of rows. */
  lineupError?: { code: string; message: string };
}

function filterValue(call: QueryCall, column: string): unknown {
  return call.filters.find(([, name]) => name === column)?.[2];
}

function serve(fake: FakeSupabase, server: Server): void {
  fake.setQueryHandler((call) => {
    switch (call.table) {
      case 'festivals': {
        if (call.columns === 'id, version') {
          return { data: { id: FESTIVAL, version: server.version } };
        }
        if (call.single) {
          return { data: festivalRow(FESTIVAL, server.version) };
        }
        return { data: [festivalRow(FESTIVAL, server.version)] };
      }
      case 'stages':
        return { data: [{ id: 'stage-1', festival_id: FESTIVAL, name: 'Main', zone: null, latitude: null, longitude: null }] };
      case 'sets':
        return { data: server.sets };
      case 'festival_artists':
        if (server.lineupError) {
          return { error: server.lineupError, status: 404 };
        }
        return { data: server.lineup.filter((row) => row.festival_id === filterValue(call, 'festival_id')) };
      case 'artists': {
        const ids = filterValue(call, 'id') as string[];
        return { data: ids.filter((id) => id in server.artists).map((id) => ({ id, name: server.artists[id], image_url: null, genre: null })) };
      }
      default:
        return { data: [] };
    }
  });
}

describe('lineup announced, set times TBA', () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = setupDataAccessTest();
    storeSession();
    storeProfile();
  });
  afterEach(teardownDataAccessTest);

  it('caches a festival whose lineup has no set yet, with every announced artist', async () => {
    serve(fake, {
      version: 1,
      sets: [],
      lineup: [
        { festival_id: FESTIVAL, artist_id: 'a-headliner', billing_order: 1 },
        { festival_id: FESTIVAL, artist_id: 'a-zed', billing_order: null },
        { festival_id: FESTIVAL, artist_id: 'a-second', billing_order: 2 },
        { festival_id: FESTIVAL, artist_id: 'a-bea', billing_order: null },
      ],
      artists: { 'a-headliner': 'Headliner', 'a-zed': 'Zed', 'a-second': 'Second Act', 'a-bea': 'bea' },
    });

    const bundle = await fetchAndCacheFestival(FESTIVAL);
    expect(fake.calls.find((call) => call.table === 'festival_artists')?.columns).toBe(LINEUP_COLUMNS);
    expect(bundle?.sets).toEqual([]);
    expect(bundle?.artists.map((artist) => artist.name)).toEqual(['Headliner', 'Second Act', 'Zed', 'bea']);
    expect(await getBrowseSchedule(FESTIVAL)).toEqual([]);

    // Billing order first, then by name (case-insensitive).
    expect((await getLocalUnscheduledArtists(FESTIVAL)).map((artist) => [artist.name, artist.billing_order])).toEqual([
      ['Headliner', 1],
      ['Second Act', 2],
      ['bea', null],
      ['Zed', null],
    ]);
  });

  it('moves an artist out of the TBA list once a set exists, whatever its status', async () => {
    const lineup = [
      { festival_id: FESTIVAL, artist_id: 'a1', billing_order: 1 },
      { festival_id: FESTIVAL, artist_id: 'a2', billing_order: 2 },
      { festival_id: FESTIVAL, artist_id: 'a3', billing_order: 3 },
    ];
    const artists = { a1: 'One', a2: 'Two', a3: 'Three' };
    serve(fake, { version: 1, sets: [], lineup, artists });
    await fetchAndCacheFestival(FESTIVAL);
    expect((await getLocalUnscheduledArtists(FESTIVAL)).map((artist) => artist.id)).toEqual(['a1', 'a2', 'a3']);

    // Set times for two acts arrive; one of them is already cancelled. The third act still waits.
    serve(fake, {
      version: 2,
      sets: [serverSet('s1', 'a1'), serverSet('s2', 'a2', { status: 'cancelled', change_note: 'Withdrew' })],
      lineup,
      artists,
    });
    await fetchAndCacheFestival(FESTIVAL);
    expect((await getLocalUnscheduledArtists(FESTIVAL)).map((artist) => artist.id)).toEqual(['a3']);
    expect((await getLocalFestivalBundle(FESTIVAL))?.artists.map((artist) => artist.id).sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('keeps a set’s artist in the bundle when its lineup row is missing (legacy data)', async () => {
    serve(fake, {
      version: 1,
      sets: [serverSet('s1', 'a-legacy')],
      lineup: [{ festival_id: FESTIVAL, artist_id: 'a-announced', billing_order: null }],
      artists: { 'a-legacy': 'Legacy', 'a-announced': 'Announced' },
    });
    const bundle = await fetchAndCacheFestival(FESTIVAL);
    expect(bundle?.artists.map((artist) => artist.name)).toEqual(['Announced', 'Legacy']);
    const artistsCall = fake.calls.find((call) => call.table === 'artists');
    expect((filterValue(artistsCall!, 'id') as string[]).sort()).toEqual(['a-announced', 'a-legacy']);
    expect((await getBrowseSchedule(FESTIVAL)).map((row) => row.artist_name)).toEqual(['Legacy']);
  });

  it('removes lineup rows with the festival and keeps artists that another festival still bills', async () => {
    serve(fake, {
      version: 1,
      sets: [],
      lineup: [
        { festival_id: FESTIVAL, artist_id: 'a-shared', billing_order: 1 },
        { festival_id: FESTIVAL, artist_id: 'a-only-here', billing_order: 2 },
      ],
      artists: { 'a-shared': 'Shared', 'a-only-here': 'Only Here' },
    });
    await fetchAndCacheFestival(FESTIVAL);
    const db = await getDb();
    await db.runAsync("INSERT INTO festivals (id, name, start_date, end_date, timezone, version) VALUES (?, 'Other', '2027-07-01', '2027-07-02', 'UTC', 1);", [OTHER]);
    await db.runAsync('INSERT INTO festival_artists (festival_id, artist_id, billing_order) VALUES (?, ?, NULL);', [OTHER, 'a-shared']);

    // The catalog refresh lists only the other festival: f1 is gone (unpublished).
    fake.setQueryHandler((call) =>
      call.table === 'festivals' ? { data: [festivalRow(OTHER, 1)] } : { data: [] },
    );
    await refreshFestivalCatalog();

    expect(await db.getAllAsync('SELECT festival_id, artist_id FROM festival_artists ORDER BY festival_id;')).toEqual([
      { festival_id: OTHER, artist_id: 'a-shared' },
    ]);
    expect((await db.getAllAsync<{ id: string }>('SELECT id FROM artists ORDER BY id;')).map((row) => row.id)).toEqual(['a-shared']);
  });

  it('fails the bundle refresh and keeps the cached bundle when the lineup cannot be read', async () => {
    const lineup = [{ festival_id: FESTIVAL, artist_id: 'a1', billing_order: 1 }];
    serve(fake, { version: 1, sets: [], lineup, artists: { a1: 'One' } });
    await fetchAndCacheFestival(FESTIVAL);

    // A server without migration 014 (relation missing from PostgREST's schema cache), then a
    // permission problem: neither caches an empty lineup under the new version.
    for (const lineupError of [
      { code: 'PGRST205', message: "Could not find the table 'public.festival_artists' in the schema cache" },
      { code: '42501', message: 'permission denied for table festival_artists' },
    ]) {
      serve(fake, { version: 2, sets: [], lineup: [], artists: { a1: 'One' }, lineupError });
      await expect(fetchAndCacheFestival(FESTIVAL)).rejects.toMatchObject({ name: 'DataAccessError', code: lineupError.code });
      expect((await getLocalUnscheduledArtists(FESTIVAL)).map((artist) => artist.id)).toEqual(['a1']);
      expect((await getLocalFestivalBundle(FESTIVAL))?.festival.version).toBe(1);
    }
  });
});
