import { describe, expect, it } from 'vitest';

import { buildSeedFromCsv, type CsvInput } from '../src/festival/import-csv';
import { validateFestivalSeed } from '../src/festival/validate';
import { demoFestivalJson, readRepoFile } from './fixtures';

function demoCsv(): CsvInput {
  return {
    'festival.csv': readRepoFile('seed-data/demo-festival-csv/festival.csv'),
    'stages.csv': readRepoFile('seed-data/demo-festival-csv/stages.csv'),
    'artists.csv': readRepoFile('seed-data/demo-festival-csv/artists.csv'),
    'sets.csv': readRepoFile('seed-data/demo-festival-csv/sets.csv'),
  };
}

const minimal: CsvInput = {
  'festival.csv': 'name,start_date,end_date,timezone,source_url\nRiverside Sounds,2027-08-06,2027-08-07,America/Chicago,https://example.org/schedule\n',
  'stages.csv': 'name,zone\nMain,\nTent,North\n',
  'artists.csv': 'name,genre\nArtist One,Rock\n"Artist, Two",\n',
  'sets.csv': [
    'artist,stage,start,end',
    'Artist One,Main,2027-08-06 19:00,2027-08-06 20:00',
    'artist one,tent,2027-08-07 01:00,2027-08-07 02:00',
    '"Artist, Two",Main,2027-08-07T18:00:00-05:00,2027-08-07T19:00:00-05:00',
  ].join('\n'),
};

describe('buildSeedFromCsv', () => {
  it('reproduces seed-data/demo-festival.json from seed-data/demo-festival-csv', () => {
    const built = buildSeedFromCsv(demoCsv());
    expect(built.errors).toEqual([]);
    const validated = validateFestivalSeed(built.seed);
    expect(validated.errors).toEqual([]);
    expect(validated.seed).toEqual(demoFestivalJson());
  });

  it('converts local times with the festival offset and matches names case-insensitively', () => {
    const built = buildSeedFromCsv(minimal);
    expect(built.errors).toEqual([]);
    const seed = validateFestivalSeed(built.seed).seed!;
    expect(seed.sets.map((set) => [set.start_time, set.end_time])).toEqual([
      ['2027-08-06T19:00:00-05:00', '2027-08-06T20:00:00-05:00'],
      ['2027-08-07T01:00:00-05:00', '2027-08-07T02:00:00-05:00'],
      ['2027-08-07T18:00:00-05:00', '2027-08-07T19:00:00-05:00'],
    ]);
    expect(seed.sets[1].stage_id).toBe(seed.stages[1].id);
    expect(seed.artists[1].name).toBe('Artist, Two');
  });

  it('derives stable ids: a 1 AM set belongs to the previous festival day, and time changes keep the id', () => {
    const first = validateFestivalSeed(buildSeedFromCsv(minimal).seed).seed!;
    // Artist One plays Friday 19:00 and Friday-night 01:00 -> same festival day, ordinals 1 and 2.
    expect(new Set(first.sets.map((set) => set.id)).size).toBe(3);

    const moved = buildSeedFromCsv({
      ...minimal,
      'sets.csv': minimal['sets.csv'].replace('2027-08-07T18:00:00-05:00,2027-08-07T19:00:00-05:00', '2027-08-07T20:15:00-05:00,2027-08-07T21:00:00-05:00'),
    });
    const second = validateFestivalSeed(moved.seed).seed!;
    expect(second.sets[2].id).toBe(first.sets[2].id);
    expect(second.festival.id).toBe(first.festival.id);
    expect(second.artists.map((artist) => artist.id)).toEqual(first.artists.map((artist) => artist.id));
  });

  it('reads status, original_start and note, and keeps the id of a set that moved to another day', () => {
    const before = validateFestivalSeed(buildSeedFromCsv(minimal).seed).seed!;
    const built = buildSeedFromCsv({
      ...minimal,
      'sets.csv': [
        'artist,stage,start,end,status,original_start,note',
        // Friday 19:00 moved to Saturday 21:00: the id still comes from Friday.
        'Artist One,Main,2027-08-07 21:00,2027-08-07 22:00,Moved,2027-08-06 19:00,"Moved to Saturday, weather"',
        'artist one,tent,2027-08-07 01:00,2027-08-07 02:00,,,',
        '"Artist, Two",Main,2027-08-07T18:00:00-05:00,2027-08-07T19:00:00-05:00,Canceled,,Artist withdrew',
      ].join('\n'),
    });
    expect(built.errors).toEqual([]);
    const result = validateFestivalSeed(built.seed);
    expect(result.errors).toEqual([]);
    const seed = result.seed!;
    expect(seed.sets.map((set) => set.id)).toEqual(before.sets.map((set) => set.id));
    expect(seed.sets.map((set) => [set.status, set.original_start_time, set.change_note])).toEqual([
      ['moved', '2027-08-06T19:00:00-05:00', 'Moved to Saturday, weather'],
      ['scheduled', null, null],
      ['cancelled', null, 'Artist withdrew'],
    ]);
  });

  it('reproduces seed-data/head-trip-2026.json from its CSVs, keeping the pre-change set ids', () => {
    const csv = (file: string) => readRepoFile(`seed-data/head-trip-2026-csv/${file}`);
    const built = buildSeedFromCsv({
      'festival.csv': csv('festival.csv'),
      'stages.csv': csv('stages.csv'),
      'artists.csv': csv('artists.csv'),
      'sets.csv': csv('sets.csv'),
    });
    expect(built.errors).toEqual([]);
    const seed = validateFestivalSeed(built.seed).seed!;
    expect(seed).toEqual(JSON.parse(readRepoFile('seed-data/head-trip-2026.json')));
    // Calvin Harris moved from Saturday 23:00 to Sunday and keeps the id of his Saturday slot.
    const calvin = seed.sets.find((set) => set.original_start_time === '2026-10-10T23:00:00-07:00');
    expect(calvin).toMatchObject({ id: 'd7a78947-0a4d-5f80-a039-05879861acd6', status: 'moved', start_time: '2026-10-11T21:10:00-07:00' });
  });

  it('respects ids given in the CSV', () => {
    const built = buildSeedFromCsv({
      ...minimal,
      'stages.csv': 'id,name\n22222222-2222-4222-8222-222222222221,Main\n22222222-2222-4222-8222-222222222222,Tent\n',
    });
    expect((built.seed!.stages as Array<{ id: string }>)[0].id).toBe('22222222-2222-4222-8222-222222222221');
  });

  it('reports unknown names, bad times, DST gaps and malformed CSV with file:line', () => {
    const built = buildSeedFromCsv({
      ...minimal,
      'festival.csv': 'name,start_date,end_date,timezone,source_url\nSpring Fest,2027-03-13,2027-03-14,America/Chicago,https://example.org\n',
      'sets.csv': [
        'artist,stage,start,end',
        'Nobody,Main,2027-03-13 19:00,2027-03-13 20:00',
        'Artist One,Nowhere,2027-03-13 19:00,2027-03-13 20:00',
        'Artist One,Main,7pm,2027-03-13 20:00',
        'Artist One,Tent,2027-03-14 02:30,2027-03-14 03:30',
      ].join('\n'),
    });
    expect(built.seed).toBeNull();
    expect(built.errors).toEqual([
      { path: 'sets.csv:2 artist', message: '"Nobody" is not listed in artists.csv' },
      { path: 'sets.csv:3 stage', message: '"Nowhere" is not listed in stages.csv' },
      { path: 'sets.csv:4 start', message: '"7pm" must be "YYYY-MM-DD HH:MM" (festival local time) or ISO 8601 with an offset' },
      { path: 'sets.csv:5 start', message: '"2027-03-14 02:30" does not exist in America/Chicago (skipped by a daylight-saving change)' },
    ]);

    expect(buildSeedFromCsv({ ...minimal, 'artists.csv': 'name,photo\nx,y\n' }).errors[0]).toMatchObject({
      path: 'artists.csv:1',
    });
    expect(buildSeedFromCsv({ ...minimal, 'festival.csv': minimal['festival.csv'] + 'Second,2027-01-01,2027-01-02,UTC,\n' }).errors).toEqual([
      { path: 'festival.csv', message: 'must contain exactly one festival row (found 2)' },
    ]);
    expect(buildSeedFromCsv({ ...minimal, 'festival.csv': 'name,start_date,end_date,timezone\nX,2027-01-01,2027-01-02,CST\n' }).errors[0].message).toMatch(
      /not an IANA time zone/,
    );
  });

  it('leaves semantic validation to validateFestivalSeed', () => {
    const built = buildSeedFromCsv({ ...minimal, 'festival.csv': 'name,start_date,end_date,timezone\nNo Source,2027-08-06,2027-08-07,America/Chicago\n' });
    expect(built.errors).toEqual([]);
    expect(validateFestivalSeed(built.seed).errors.map((issue) => issue.path)).toEqual(['festival.source_url']);
  });
});
