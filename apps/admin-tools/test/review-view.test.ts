import { describe, expect, it } from 'vitest';

import type { LoadedCandidate } from '../src/candidates/store';
import type { CandidateFile } from '../src/candidates/types';
import type { FestivalSeed } from '../src/festival/types';
import type { MediaEntry, MediaRegistry } from '../src/media/types';
import { buildCandidateView, dayLabel, timeView } from '../src/review/view';

const FESTIVAL_ID = '11111111-1111-4111-8111-111111111111';
const STAGE_MAIN = '22222222-2222-4222-8222-222222222221';
const STAGE_TENT = '22222222-2222-4222-8222-222222222222';
const ARTIST_SETH = '33333333-3333-4333-8333-333333333331';
const ARTIST_CALVIN = '33333333-3333-4333-8333-333333333332';
const ARTIST_HARVEY = '33333333-3333-4333-8333-333333333333';

function seed(): FestivalSeed {
  return {
    festival: {
      id: FESTIVAL_ID,
      name: 'Head Trip',
      start_date: '2026-10-10',
      end_date: '2026-10-11',
      timezone: 'America/Los_Angeles',
      venue_name: 'Empire Polo Club, Indio',
      status: 'draft',
      is_demo: false,
      source_url: 'https://headtripindio.com/set-times/',
      accent_color: '#E4D9FF',
      latitude: 33.68,
      longitude: -116.24,
      default_zoom: 15,
      bounds_sw_lat: null,
      bounds_sw_lng: null,
      bounds_ne_lat: null,
      bounds_ne_lng: null,
    },
    stages: [
      { id: STAGE_MAIN, festival_id: FESTIVAL_ID, name: 'Main Stage', zone: null, latitude: null, longitude: null },
      { id: STAGE_TENT, festival_id: FESTIVAL_ID, name: 'Sahara', zone: 'North', latitude: 33.681, longitude: -116.241 },
    ],
    artists: [
      { id: ARTIST_SETH, name: 'Seth Troxler', genre: 'House' },
      { id: ARTIST_CALVIN, name: 'Calvin Harris', genre: null },
      { id: ARTIST_HARVEY, name: 'DJ Harvey', genre: 'Disco' },
    ],
    sets: [
      {
        id: 'set-after-midnight',
        festival_id: FESTIVAL_ID,
        artist_id: ARTIST_CALVIN,
        stage_id: STAGE_MAIN,
        start_time: '2026-10-11T00:30:00-07:00',
        end_time: '2026-10-11T02:00:00-07:00',
        set_type: 'dj',
        status: 'scheduled',
        original_start_time: null,
        change_note: null,
      },
      {
        id: 'set-saturday',
        festival_id: FESTIVAL_ID,
        artist_id: ARTIST_SETH,
        stage_id: STAGE_MAIN,
        start_time: '2026-10-10T16:30:00-07:00',
        end_time: '2026-10-10T19:00:00-07:00',
        set_type: 'performance',
        status: 'scheduled',
        original_start_time: null,
        change_note: 'Saturday times were adjusted for weather',
      },
      {
        id: 'set-moved',
        festival_id: FESTIVAL_ID,
        artist_id: ARTIST_HARVEY,
        stage_id: STAGE_TENT,
        start_time: '2026-10-11T15:05:00-07:00',
        end_time: '2026-10-11T16:35:00-07:00',
        set_type: 'performance',
        status: 'moved',
        original_start_time: '2026-10-11T15:30:00-07:00',
        change_note: 'New Sunday schedule after the weather',
      },
      {
        id: 'set-out-of-range',
        festival_id: FESTIVAL_ID,
        artist_id: ARTIST_SETH,
        stage_id: STAGE_TENT,
        start_time: '2026-10-12T20:00:00-07:00',
        end_time: '2026-10-12T21:00:00-07:00',
        set_type: 'performance',
        status: 'cancelled',
        original_start_time: null,
        change_note: null,
      },
    ],
  };
}

function mediaEntry(overrides: Partial<MediaEntry>): MediaEntry {
  return {
    subject_type: 'artist',
    subject_id: ARTIST_SETH,
    subject_name: 'Seth Troxler',
    file: 'artists/seth.jpg',
    sha256: 'abc',
    mime: 'image/jpeg',
    width: 512,
    height: 512,
    source: { kind: 'wikimedia-commons', url: 'https://commons.wikimedia.org/wiki/File:Seth.jpg', retrieved_at: '2026-10-09T10:00:00Z' },
    license: { id: 'CC-BY-SA-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution: 'Photo: Jane Doe, CC BY-SA 4.0' },
    review: { status: 'pending', by: null, at: null },
    ...overrides,
  };
}

function registry(): MediaRegistry {
  return {
    version: 1,
    entries: [
      mediaEntry({ review: { status: 'approved', by: 'kevin', at: '2026-10-09T12:00:00Z' } }),
      // Matched by name only: the agent did not know the derived id.
      mediaEntry({ subject_id: 'not-a-known-id', subject_name: 'dj  harvey', file: 'artists/harvey.png', mime: 'image/png' }),
      mediaEntry({ subject_type: 'festival', subject_id: FESTIVAL_ID, subject_name: 'Head Trip', file: 'festival.jpg', review: { status: 'rejected', by: null, at: null } }),
    ],
  };
}

function candidateFile(): CandidateFile {
  return {
    version: 1,
    slug: 'head-trip-2026',
    name: 'Head Trip 2026',
    created_at: '2026-10-09T09:00:00Z',
    status: 'needs_review',
    trigger: { kind: 'manual' },
    agent: { tool: 'claude-code festival-scout', run_id: 'run-1', started_at: '2026-10-09T08:00:00Z' },
    sources: [
      { url: 'https://headtripindio.com/set-times/', title: 'Set times', kind: 'official', accessed_at: '2026-10-09T08:10:00Z', used_for: ['sets', 'stages'] },
      { url: 'https://example.org/press', title: null, kind: 'press', accessed_at: '2026-10-09T08:20:00Z', used_for: ['sets'], note: 'end time estimated' },
    ],
    confidence: { festival: 'high', stages: 'high', artists: 'medium', sets: 'low' },
    notes: 'Sunday end times estimated.',
    items: {
      sets: {
        'Seth Troxler|2026-10-10 16:30': { sources: [0], confidence: 'high' },
        // Keyed by the start before the move, in a different case.
        'dj harvey|2026-10-11 15:30': { sources: [1], confidence: 'medium', note: 'end estimated' },
        'Calvin Harris|2026-10-11 00:30': { sources: [0, 1], confidence: 'low' },
      },
      artists: { 'Seth Troxler': { sources: [0], confidence: 'high' } },
    },
    review: { decisions: { festival: 'pending', stages: 'approved', artists: 'pending', sets: 'pending' }, by: null, at: null },
  };
}

function loaded(overrides: Partial<LoadedCandidate> = {}): LoadedCandidate {
  return {
    dir: '/repo/seed-data/candidates/head-trip-2026',
    file: candidateFile(),
    csv: { 'festival.csv': '', 'stages.csv': '', 'artists.csv': '', 'sets.csv': '' },
    seed: seed(),
    errors: [],
    warnings: [{ path: 'sets[3].start_time', message: 'outside the festival dates' }],
    media: registry(),
    reviewMarkdown: '# Head Trip\n\nChecked against the official graphic.',
    ...overrides,
  };
}

describe('timeView', () => {
  it('formats instants in the festival zone with a 24h time and a 12h label', () => {
    expect(timeView('2026-10-10T16:30:00-07:00', 'America/Los_Angeles')).toEqual({
      iso: '2026-10-10T16:30:00-07:00', date: '2026-10-10', time: '16:30', label: '4:30 PM',
    });
    expect(timeView('2026-10-11T07:30:00Z', 'America/Los_Angeles')).toEqual({
      iso: '2026-10-11T07:30:00Z', date: '2026-10-11', time: '00:30', label: '12:30 AM',
    });
    expect(timeView('2026-10-11T19:00:00Z', 'America/Los_Angeles')?.label).toBe('12:00 PM');
    expect(timeView('2026-10-10 16:30', 'America/Los_Angeles')).toBeNull();
    expect(timeView(null, 'America/Los_Angeles')).toBeNull();
  });

  it('labels days', () => {
    expect(dayLabel('2026-10-10')).toBe('Sat, Oct 10');
    expect(dayLabel('unknown')).toBe('Unknown day');
  });
});

describe('buildCandidateView', () => {
  it('groups sets by festival day in the festival time zone, a set after midnight staying with the night before', () => {
    const view = buildCandidateView(loaded());
    expect(view.seedSource).toBe('validated');
    expect(view.days.map((day) => [day.date, day.label, day.inRange, day.sets.length])).toEqual([
      ['2026-10-10', 'Sat, Oct 10', true, 2],
      ['2026-10-11', 'Sun, Oct 11', true, 1],
      ['2026-10-12', 'Mon, Oct 12', false, 1],
    ]);
    const saturday = view.days[0].sets;
    expect(saturday.map((set) => set.id)).toEqual(['set-saturday', 'set-after-midnight']);
    expect(saturday[0].start).toEqual({ iso: '2026-10-10T16:30:00-07:00', date: '2026-10-10', time: '16:30', label: '4:30 PM' });
    expect(saturday[0].end?.time).toBe('19:00');
    expect(saturday[1]).toMatchObject({
      artist: 'Calvin Harris', stage: 'Main Stage', day: '2026-10-10', set_type: 'dj',
      start: { date: '2026-10-11', time: '00:30', label: '12:30 AM' },
      end: { time: '02:00', label: '2:00 AM' },
    });
    expect(view.counts).toEqual({ stages: 2, artists: 3, sets: 4, days: 3 });
  });

  it('carries set status, original start and change note, and finds provenance by current or original start', () => {
    const view = buildCandidateView(loaded());
    const moved = view.days[1].sets[0];
    expect(moved).toMatchObject({
      id: 'set-moved', status: 'moved', change_note: 'New Sunday schedule after the weather',
      original_start: { date: '2026-10-11', time: '15:30', label: '3:30 PM' },
      provenance: { key: 'dj harvey|2026-10-11 15:30', sources: [1], confidence: 'medium', note: 'end estimated' },
    });
    const saturday = view.days[0].sets;
    expect(saturday[0].provenance).toEqual({ key: 'Seth Troxler|2026-10-10 16:30', sources: [0], confidence: 'high' });
    expect(saturday[1].provenance?.sources).toEqual([0, 1]);
    expect(view.days[2].sets[0]).toMatchObject({ status: 'cancelled', provenance: null });
  });

  it('attaches image candidates to artists by id, then by name, and lists the rest', () => {
    const view = buildCandidateView(loaded());
    expect(view.artists.map((artist) => [artist.name, artist.setCount, artist.media?.index ?? null])).toEqual([
      ['Seth Troxler', 2, 0],
      ['Calvin Harris', 1, null],
      ['DJ Harvey', 1, 1],
    ]);
    expect(view.artists[0].media).toMatchObject({
      url: '/media/head-trip-2026/artists/seth.jpg',
      license: { id: 'CC-BY-SA-4.0', attribution: 'Photo: Jane Doe, CC BY-SA 4.0' },
      review: { status: 'approved', by: 'kevin' },
    });
    expect(view.artists[0].provenance).toEqual({ key: 'Seth Troxler', sources: [0], confidence: 'high' });
    expect(view.media.unmatched.map((entry) => entry.index)).toEqual([2]);
    expect(view.media.counts).toEqual({ pending: 1, approved: 1, rejected: 1 });
    expect(view.stages.map((stage) => [stage.name, stage.setCount])).toEqual([['Main Stage', 2], ['Sahara', 2]]);
  });

  it('passes festival facts, sources, confidence, validation and review through', () => {
    const view = buildCandidateView(loaded());
    expect(view.festival).toMatchObject({ name: 'Head Trip', timezone: 'America/Los_Angeles', venue_name: 'Empire Polo Club, Indio' });
    expect(view.sources.map((source) => [source.index, source.kind])).toEqual([[0, 'official'], [1, 'press']]);
    expect(view.confidence.sets).toBe('low');
    expect(view.validation.errors).toEqual([]);
    expect(view.validation.warnings).toHaveLength(1);
    expect(view.review.decisions.stages).toBe('approved');
    expect(view.reviewMarkdown).toContain('official graphic');
    expect(view).toMatchObject({ slug: 'head-trip-2026', name: 'Head Trip 2026', status: 'needs_review', notes: 'Sunday end times estimated.' });
  });

  it('falls back to the raw CSVs when validation failed, and to an empty lineup when they are broken too', () => {
    const csv = {
      'festival.csv': 'name,start_date,end_date,timezone\nTiny Fest,2026-10-10,2026-10-10,America/Los_Angeles\n',
      'stages.csv': 'name\nMain\n',
      'artists.csv': 'name\nSomeone\n',
      'sets.csv': 'artist,stage,start,end\nSomeone,Main,2026-10-10 20:00,2026-10-10 21:00\n',
    };
    const errors = [{ path: 'festival.source_url', message: 'is required for a real festival' }];
    const view = buildCandidateView(loaded({ seed: null, csv, errors, media: null, reviewMarkdown: null }));
    expect(view.seedSource).toBe('unvalidated');
    expect(view.festival?.name).toBe('Tiny Fest');
    expect(view.days).toHaveLength(1);
    expect(view.days[0].sets[0]).toMatchObject({ artist: 'Someone', stage: 'Main', start: { time: '20:00', label: '8:00 PM' } });
    expect(view.validation.errors).toEqual(errors);
    expect(view.media).toEqual({ entries: [], unmatched: [], counts: { pending: 0, approved: 0, rejected: 0 } });

    const broken = buildCandidateView(loaded({ seed: null, csv: { ...csv, 'sets.csv': 'artist,stage\nSomeone,Main\n' }, errors }));
    expect(broken.seedSource).toBe('none');
    expect(broken.festival).toBeNull();
    expect(broken.days).toEqual([]);
    expect(broken.counts).toEqual({ stages: 0, artists: 0, sets: 0, days: 0 });
  });
});
