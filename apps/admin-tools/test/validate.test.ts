import { describe, expect, it } from 'vitest';

import { validateFestivalSeed } from '../src/festival/validate';
import { demoFestivalJson, realFestival } from './fixtures';

function errorsOf(input: unknown): string[] {
  return validateFestivalSeed(input).errors.map((issue) => `${issue.path}: ${issue.message}`);
}

function mutate(change: (file: Record<string, any>) => void): Record<string, any> {
  const file = realFestival();
  change(file);
  return file;
}

describe('validateFestivalSeed', () => {
  it('accepts a valid real festival and fills defaults', () => {
    const result = validateFestivalSeed(realFestival());
    expect(result.errors).toEqual([]);
    expect(result.seed?.festival).toMatchObject({ status: 'draft', is_demo: false, accent_color: null, default_zoom: null });
    expect(result.seed?.stages[0]).toMatchObject({ festival_id: '11111111-1111-4111-8111-111111111111', zone: null });
    expect(result.seed?.artists[1]).toMatchObject({ genre: null });
    expect(result.seed?.sets[0]).toMatchObject({ festival_id: '11111111-1111-4111-8111-111111111111', set_type: 'performance' });
    expect(result.warnings.map((warning) => warning.path)).toEqual(['stages[1]']);
  });

  it('defaults every set to scheduled with no original start or note', () => {
    const result = validateFestivalSeed(realFestival());
    expect(result.seed?.sets.map((set) => [set.status, set.original_start_time, set.change_note])).toEqual([
      ['scheduled', null, null],
      ['scheduled', null, null],
    ]);
  });

  it('accepts moved and cancelled sets, trims notes, and skips cancelled sets in the overlap check', () => {
    const result = validateFestivalSeed(
      mutate((file) => {
        Object.assign(file.sets[0], {
          status: 'moved',
          start_time: '2027-08-07T19:00:00-05:00',
          end_time: '2027-08-07T20:00:00-05:00',
          original_start_time: '2027-08-06T19:00:00-05:00',
          change_note: '  Moved to Saturday (weather)  ',
        });
        file.sets.push({
          id: '44444444-4444-4444-8444-444444444443',
          artist_id: '33333333-3333-4333-8333-333333333332',
          stage_id: '22222222-2222-4222-8222-222222222221',
          start_time: '2027-08-07T19:30:00-05:00',
          end_time: '2027-08-07T20:30:00-05:00',
          status: 'cancelled',
          change_note: 'Artist withdrew',
        });
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.seed?.sets[0]).toMatchObject({
      status: 'moved',
      original_start_time: '2027-08-06T19:00:00-05:00',
      change_note: 'Moved to Saturday (weather)',
    });
    expect(result.seed?.sets[2]).toMatchObject({ status: 'cancelled', original_start_time: null, change_note: 'Artist withdrew' });
    expect(result.warnings.map((warning) => warning.path)).toEqual(['stages[1]']);
  });

  it('rejects set changes the database would refuse', () => {
    expect(errorsOf(mutate((file) => (file.sets[0].status = 'postponed')))).toEqual([
      'sets[0].status: must be one of scheduled, moved, cancelled',
    ]);
    expect(errorsOf(mutate((file) => (file.sets[0].original_start_time = '2027-08-06T18:00:00-05:00')))).toEqual([
      'sets[0].original_start_time: is only allowed when status is "moved"',
    ]);
    expect(
      errorsOf(mutate((file) => Object.assign(file.sets[0], { status: 'moved', original_start_time: '2027-08-06 18:00' }))),
    ).toEqual(['sets[0].original_start_time: must be an ISO 8601 timestamp with an offset, e.g. 2027-06-18T19:30:00-04:00']);
    expect(
      errorsOf(mutate((file) => Object.assign(file.sets[0], { status: 'moved', original_start_time: '2027-09-01T18:00:00-05:00' }))),
    ).toEqual([
      'sets[0].original_start_time: is on 2027-09-01 (America/Chicago), outside the festival dates ±1 day (2027-08-05..2027-08-08)',
    ]);
    expect(errorsOf(mutate((file) => (file.sets[0].change_note = 'x'.repeat(141))))).toEqual([
      'sets[0].change_note: must be at most 140 characters (got 141)',
    ]);
    expect(errorsOf(mutate((file) => (file.sets[0].change_note = 'Line one\nLine two')))).toEqual([
      'sets[0].change_note: must be a single line',
    ]);
  });

  it('warns about a moved set without its old time, or with an unchanged one', () => {
    const missing = validateFestivalSeed(mutate((file) => (file.sets[0].status = 'moved')));
    expect(missing.errors).toEqual([]);
    expect(missing.warnings.map((warning) => warning.path)).toContain('sets[0].original_start_time');
    const unchanged = validateFestivalSeed(
      mutate((file) => Object.assign(file.sets[0], { status: 'moved', original_start_time: file.sets[0].start_time })),
    );
    expect(unchanged.warnings.map((warning) => `${warning.path}: ${warning.message}`)).toContain(
      'sets[0].original_start_time: equals start_time; leave it empty for a set that only changed stage',
    );
  });

  it('accepts the bundled demo festival', () => {
    const result = validateFestivalSeed(demoFestivalJson());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.seed?.festival).toMatchObject({ is_demo: true, status: 'published', name: 'Festie Demo Fest' });
    expect(result.seed?.festival.start_date.startsWith('2027-')).toBe(true);
  });

  it('requires a source_url for real festivals but not for demos', () => {
    expect(errorsOf(mutate((file) => delete file.festival.source_url))).toContain(
      'festival.source_url: is required for real festivals: link the official public schedule you entered the data from',
    );
    expect(errorsOf(mutate((file) => { delete file.festival.source_url; file.festival.is_demo = true; }))).toEqual([]);
    expect(errorsOf(mutate((file) => (file.festival.source_url = 'http://example.org')))).toContain('festival.source_url: must use https');
  });

  it('rejects malformed ids, unknown fields and artwork', () => {
    const errors = errorsOf(
      mutate((file) => {
        file.festival.id = 'coachella-2026';
        file.festival.logo = 'x';
        file.festival.image_url = 'https://example.org/poster.png';
        file.artists[0].image_url = 'https://example.org/photo.jpg';
        file.stages[0].map_x = 0.5;
      }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'festival.id: must be a UUID',
        expect.stringMatching(/^festival\.logo: unknown field/),
        expect.stringMatching(/^festival\.image_url: must be null/),
        expect.stringMatching(/^artists\[0\]\.image_url: must be null/),
        expect.stringMatching(/^stages\[0\]\.map_x: unknown field/),
      ]),
    );
  });

  it('validates dates and time zones', () => {
    expect(errorsOf(mutate((file) => (file.festival.end_date = '2027-08-05')))).toContain(
      'festival.end_date: must be on or after start_date',
    );
    expect(errorsOf(mutate((file) => (file.festival.start_date = '2027-02-30')))).toContain(
      'festival.start_date: must be a calendar date YYYY-MM-DD',
    );
    expect(errorsOf(mutate((file) => (file.festival.timezone = 'CST')))).toContain(
      'festival.timezone: must be an IANA time zone such as America/Chicago',
    );
  });

  it('requires offsets on set times, end after start and sets within the festival ±1 day', () => {
    expect(errorsOf(mutate((file) => (file.sets[0].start_time = '2027-08-06T19:00:00')))).toEqual([
      'sets[0].start_time: must be an ISO 8601 timestamp with an offset, e.g. 2027-06-18T19:30:00-04:00',
    ]);
    expect(errorsOf(mutate((file) => (file.sets[0].end_time = '2027-08-06T18:00:00-05:00')))).toEqual([
      'sets[0].end_time: must be after start_time',
    ]);
    expect(errorsOf(mutate((file) => (file.sets[0].end_time = '2027-08-07T20:00:00-05:00')))).toEqual([
      'sets[0].end_time: sets longer than 24 hours are not allowed',
    ]);
    // 2027-08-05 (the day before) is allowed; 2027-08-04 is not.
    expect(errorsOf(mutate((file) => {
      file.sets[0].start_time = '2027-08-05T19:00:00-05:00';
      file.sets[0].end_time = '2027-08-05T20:00:00-05:00';
    }))).toEqual([]);
    expect(errorsOf(mutate((file) => {
      file.sets[0].start_time = '2027-08-04T19:00:00-05:00';
      file.sets[0].end_time = '2027-08-04T20:00:00-05:00';
    }))).toEqual([
      'sets[0].start_time: starts on 2027-08-04 (America/Chicago), outside the festival dates ±1 day (2027-08-05..2027-08-08)',
    ]);
  });

  it('checks references and duplicates', () => {
    const errors = errorsOf(
      mutate((file) => {
        file.sets[0].artist_id = '33333333-3333-4333-8333-333333333339';
        file.sets[1].stage_id = '22222222-2222-4222-8222-222222222229';
        file.sets[1].festival_id = '99999999-9999-4999-8999-999999999999';
        file.stages[1].name = 'main';
        file.artists[1].id = file.artists[0].id;
      }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'sets[0].artist_id: does not match any artist in this file',
        'sets[1].stage_id: does not match any stage in this file',
        'sets[1].festival_id: must equal festival.id (or be omitted)',
        'stages[1].name: duplicate stage name (also stages[0])',
        expect.stringMatching(/^artists\[1\]\.id: duplicate artist id/),
      ]),
    );
  });

  it('validates coordinates and bounds', () => {
    expect(errorsOf(mutate((file) => (file.stages[0].latitude = 91)))).toContain('stages[0].latitude: must be between -90 and 90');
    expect(errorsOf(mutate((file) => delete file.stages[0].longitude))).toContain(
      'stages[0]: latitude and longitude must be given together',
    );
    expect(errorsOf(mutate((file) => (file.stages[0].latitude = 41.95)))).toContain(
      'stages[0]: stage coordinates must lie inside the festival bounds',
    );
    expect(errorsOf(mutate((file) => delete file.festival.bounds_ne_lng))).toContain(
      'festival: bounds_sw_lat, bounds_sw_lng, bounds_ne_lat and bounds_ne_lng must be given together',
    );
    expect(errorsOf(mutate((file) => (file.festival.bounds_sw_lat = 41.95)))).toEqual(
      expect.arrayContaining(['festival.bounds_sw_lat: must be south of bounds_ne_lat']),
    );
    expect(errorsOf(mutate((file) => (file.festival.accent_color = 'blue')))).toContain(
      'festival.accent_color: must be a hex color like #B2CEFE',
    );
  });

  it('publishes a lineup without set times, but never an empty one, and warns about overlaps', () => {
    // Announcement mode: artists announced, set times to be announced.
    const lineupOnly = validateFestivalSeed(mutate((file) => { file.festival.status = 'published'; file.sets = []; }));
    expect(lineupOnly.errors).toEqual([]);
    expect(lineupOnly.seed?.artists).toHaveLength(2);
    expect(lineupOnly.warnings.map((warning) => `${warning.path}: ${warning.message}`)).toContain(
      'sets: no set times yet: the app shows the lineup as "set times to be announced"',
    );
    expect(errorsOf(mutate((file) => { file.festival.status = 'published'; file.sets = []; file.artists = []; }))).toEqual([
      'artists: a published festival needs a lineup: at least one artist (set times can follow later)',
    ]);
    // A draft may be empty.
    expect(errorsOf(mutate((file) => { file.sets = []; file.artists = []; }))).toEqual([]);

    // Partly timed: the acts still waiting are named.
    const partial = validateFestivalSeed(mutate((file) => { file.sets.pop(); }));
    expect(partial.errors).toEqual([]);
    expect(partial.warnings.map((warning) => `${warning.path}: ${warning.message}`)).toContain(
      'artists: 1 of 2 artists have no set yet (Artist Two): the app lists them under "set times to be announced"',
    );

    const overlapping = mutate((file) => {
      file.sets[1].stage_id = file.sets[0].stage_id;
      file.sets[1].start_time = '2027-08-06T19:30:00-05:00';
      file.sets[1].end_time = '2027-08-06T20:30:00-05:00';
    });
    const result = validateFestivalSeed(overlapping);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toContain('overlaps sets[0] on the same stage');
  });

  it('accepts billing order per artist and reports the database range', () => {
    const billed = validateFestivalSeed(mutate((file) => { file.artists[0].billing_order = 2; file.artists[1].billing_order = 1; }));
    expect(billed.errors).toEqual([]);
    expect(billed.seed?.artists.map((artist) => artist.billing_order)).toEqual([2, 1]);
    // Left out when not given, so files without billing round-trip unchanged.
    expect('billing_order' in validateFestivalSeed(realFestival()).seed!.artists[0]).toBe(false);
    expect(errorsOf(mutate((file) => (file.artists[0].billing_order = 0)))).toEqual([
      'artists[0].billing_order: must be an integer between 1 and 10000 (1 = top billing)',
    ]);
    expect(errorsOf(mutate((file) => (file.artists[0].billing_order = 1.5)))).toEqual([
      'artists[0].billing_order: must be an integer between 1 and 10000 (1 = top billing)',
    ]);
    expect(errorsOf(mutate((file) => (file.artists[0].billing_order = '1')))).toEqual([
      'artists[0].billing_order: must be an integer between 1 and 10000 (1 = top billing)',
    ]);
    // A poster's tiers: several acts share a number and sort alphabetically within it.
    const tiered = validateFestivalSeed(mutate((file) => { file.artists[0].billing_order = 1; file.artists[1].billing_order = 1; }));
    expect(tiered.errors).toEqual([]);
    expect(tiered.warnings.map((warning) => warning.path)).not.toContain('artists[1].billing_order');
  });

  it('never lets the demo festival go without set times', () => {
    const demo = demoFestivalJson();
    demo.sets = [];
    expect(errorsOf(demo)).toEqual(["sets: the demo festival needs set times: demo:seed builds the sample crew's picks and meetups from them"]);
  });

  it('rejects non-object input', () => {
    expect(errorsOf(null)).toEqual(['$: must be an object']);
    expect(errorsOf({ festival: {}, stages: {}, artists: [], sets: [] })).toContain('stages: must be an array');
  });
});
