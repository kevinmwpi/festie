import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { upsertRows } from '@festival/sync-engine';

import { QUALIFIED_SET_COLUMNS, SET_COLUMNS, fetchAndCacheFestival, getLocalFestivalBundle, getLocalFestivalLineup } from '../src/festivals';
import { getCombinedSelections } from '../src/groups';
import { getBrowseSchedule, getConflictSetIds, getLineupWithConflicts, getSelectedSchedule } from '../src/schedule';
import { PROFILE_ID, setupDataAccessTest, storeProfile, storeSession, teardownDataAccessTest } from './helpers';
import type { FakeSupabase } from './mocks/supabase-client';

const FESTIVAL = 'f1';

function serverSet(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    festival_id: FESTIVAL,
    artist_id: `artist-${id}`,
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

function serveFestival(fake: FakeSupabase, version: number, sets: Array<Record<string, unknown>>): void {
  fake.setQueryHandler((call) => {
    switch (call.table) {
      case 'festivals':
        return call.columns === 'id, version'
          ? { data: { id: FESTIVAL, version } }
          : { data: { id: FESTIVAL, name: 'Fest', start_date: '2027-06-01', end_date: '2027-06-02', timezone: 'UTC', version, status: 'published', is_demo: false } };
      case 'stages':
        return { data: [{ id: 'stage-1', festival_id: FESTIVAL, name: 'Main', zone: null, latitude: null, longitude: null }] };
      case 'sets':
        return { data: sets };
      case 'artists':
        return { data: sets.map((set) => ({ id: set.artist_id, name: `Name ${String(set.id)}`, image_url: null, genre: null })) };
      default:
        return { data: [] };
    }
  });
}

describe('schedule changes', () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = setupDataAccessTest();
    storeSession();
    storeProfile();
  });
  afterEach(teardownDataAccessTest);

  it('derives the qualified column list from SET_COLUMNS', () => {
    expect(SET_COLUMNS.split(', ')).toEqual(expect.arrayContaining(['status', 'original_start_time', 'change_note']));
    expect(QUALIFIED_SET_COLUMNS).toBe(SET_COLUMNS.split(', ').map((column) => `sets.${column}`).join(', '));
  });

  it('fetches and caches status, original start and note, and applies a change on the next version', async () => {
    const moved = serverSet('moved', {
      status: 'moved',
      start_time: '2027-06-02T04:10:00Z',
      end_time: '2027-06-02T05:40:00Z',
      original_start_time: '2027-06-01T06:00:00Z',
      change_note: 'Moved to Sunday (weather)',
    });
    serveFestival(fake, 3, [moved, serverSet('plain')]);

    const bundle = await fetchAndCacheFestival(FESTIVAL);
    expect(fake.calls.find((call) => call.table === 'sets')?.columns).toBe(SET_COLUMNS);
    expect(bundle?.sets.find((set) => set.id === 'moved')).toMatchObject({
      status: 'moved',
      original_start_time: '2027-06-01T06:00:00Z',
      change_note: 'Moved to Sunday (weather)',
    });
    expect(bundle?.sets.find((set) => set.id === 'plain')).toMatchObject({ status: 'scheduled', original_start_time: null, change_note: null });

    // Same version: the cached bundle is kept even though the server changed.
    serveFestival(fake, 3, [moved, serverSet('plain', { status: 'cancelled' })]);
    expect((await fetchAndCacheFestival(FESTIVAL))?.sets.find((set) => set.id === 'plain')?.status).toBe('scheduled');

    // New version: the cancellation replaces the cached row.
    serveFestival(fake, 4, [moved, serverSet('plain', { status: 'cancelled', change_note: 'Artist withdrew' })]);
    await fetchAndCacheFestival(FESTIVAL);
    expect((await getLocalFestivalBundle(FESTIVAL))?.sets.find((set) => set.id === 'plain')).toMatchObject({
      status: 'cancelled',
      change_note: 'Artist withdrew',
    });
    expect((await getLocalFestivalLineup(FESTIVAL)).find((row) => row.id === 'plain')).toMatchObject({
      status: 'cancelled',
      change_note: 'Artist withdrew',
      artist_name: 'Name plain',
    });
  });

  it('keeps cancelled sets and picks in the schedule, and never counts them as clashes', async () => {
    serveFestival(fake, 1, [
      serverSet('a', { start_time: '2027-06-01T20:00:00Z', end_time: '2027-06-01T21:00:00Z' }),
      serverSet('b', { start_time: '2027-06-01T20:30:00Z', end_time: '2027-06-01T21:30:00Z', status: 'cancelled' }),
      serverSet('c', { start_time: '2027-06-01T20:45:00Z', end_time: '2027-06-01T22:00:00Z', status: 'moved', original_start_time: '2027-06-01T23:00:00Z' }),
    ]);
    await fetchAndCacheFestival(FESTIVAL);
    await upsertRows(
      'user_set_selections',
      ['a', 'b', 'c'].map((setId) => ({
        id: `sel-${setId}`,
        user_id: PROFILE_ID,
        festival_id: FESTIVAL,
        set_id: setId,
        selected_at: '2027-05-01T00:00:00Z',
        note: null,
        pending_sync: 0,
      })),
    );

    const browse = await getBrowseSchedule(FESTIVAL);
    expect(browse.map((row) => `${row.id}:${row.status}`)).toEqual(['a:scheduled', 'b:cancelled', 'c:moved']);
    expect((await getSelectedSchedule(FESTIVAL)).map((row) => row.id)).toEqual(['a', 'b', 'c']);

    // a and c overlap; b overlaps both but is cancelled.
    expect([...getConflictSetIds(browse)].sort()).toEqual(['a', 'c']);
    const flagged = await getLineupWithConflicts(FESTIVAL);
    expect(flagged.find((row) => row.id === 'b')?.is_conflicting).toBe(false);
    expect(getConflictSetIds([browse[0], browse[1]]).size).toBe(0);
  });

  it('returns the set status with crew picks', async () => {
    await upsertRows('festivals', [{ id: FESTIVAL, name: 'Fest', start_date: '2027-06-01', end_date: '2027-06-02', timezone: 'UTC' }]);
    await upsertRows('stages', [{ id: 'stage-1', festival_id: FESTIVAL, name: 'Main' }]);
    await upsertRows('artists', [{ id: 'artist-x', name: 'X' }]);
    await upsertRows('sets', [serverSet('x', { artist_id: 'artist-x', status: 'cancelled', change_note: 'Weather' })]);
    await upsertRows('groups', [{ id: 'g1', festival_id: FESTIVAL, name: 'Crew', invite_code: 'ABCDEF', created_at: '2027-01-01T00:00:00Z' }]);
    await upsertRows('group_members', [{ id: 'm1', group_id: 'g1', user_id: PROFILE_ID, role: 'admin', joined_at: '2027-01-01T00:00:00Z' }]);
    await upsertRows('user_set_selections', [
      { id: 'sel-x', user_id: PROFILE_ID, festival_id: FESTIVAL, set_id: 'x', selected_at: '2027-05-01T00:00:00Z', note: null, pending_sync: 0 },
    ]);

    expect(await getCombinedSelections('g1', FESTIVAL)).toEqual([
      expect.objectContaining({ set_id: 'x', status: 'cancelled', original_start_time: null, change_note: 'Weather' }),
    ]);
  });
});
