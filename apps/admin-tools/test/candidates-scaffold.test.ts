import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csvHeader, isSlug, scaffoldCandidate, slugify } from '../src/candidates/scaffold';
import { listCandidates, loadCandidate } from '../src/candidates/store';

let tmp = '';
let root = '';

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'festie-scaffold-'));
  root = path.join(tmp, 'seed-data');
  mkdirSync(root);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('scaffoldCandidate', () => {
  it('creates headed CSVs, candidate.json and a REVIEW.md template', async () => {
    const now = new Date('2026-10-12T15:00:00Z');
    const result = scaffoldCandidate({
      slug: 'riverside-sounds-2027',
      name: 'Riverside Sounds',
      trigger: { kind: 'manual', note: 'operator request' },
      sources: [{ url: 'https://example.org/schedule', title: null, kind: 'official', accessed_at: now.toISOString(), used_for: [] }],
      root,
      now,
    });
    expect(result.dir).toBe(path.join(root, 'candidates', 'riverside-sounds-2027'));
    expect(result.files).toEqual(['festival.csv', 'stages.csv', 'artists.csv', 'sets.csv', 'candidate.json', 'REVIEW.md']);

    expect(readFileSync(path.join(result.dir, 'festival.csv'), 'utf8')).toBe(
      'name,start_date,end_date,timezone,venue_name,source_url,status,is_demo,accent_color,latitude,longitude,default_zoom,bounds_sw_lat,bounds_sw_lng,bounds_ne_lat,bounds_ne_lng,id\n',
    );
    expect(readFileSync(path.join(result.dir, 'stages.csv'), 'utf8')).toBe('name,zone,latitude,longitude,id\n');
    expect(readFileSync(path.join(result.dir, 'artists.csv'), 'utf8')).toBe('name,genre,billing,id\n');
    expect(readFileSync(path.join(result.dir, 'sets.csv'), 'utf8')).toBe('artist,stage,start,end,set_type,status,original_start,note,id\n');

    const file = JSON.parse(readFileSync(path.join(result.dir, 'candidate.json'), 'utf8'));
    expect(file).toEqual(result.file);
    expect(file).toMatchObject({
      version: 1,
      slug: 'riverside-sounds-2027',
      name: 'Riverside Sounds',
      created_at: '2026-10-12T15:00:00.000Z',
      status: 'needs_review',
      trigger: { kind: 'manual', suggestion_id: null, note: 'operator request' },
      agent: { tool: 'manual', started_at: '2026-10-12T15:00:00.000Z', run_id: null, finished_at: null },
      confidence: { festival: 'low', stages: 'low', artists: 'low', sets: 'low' },
      review: { decisions: { festival: 'pending', stages: 'pending', artists: 'pending', sets: 'pending' }, by: null, at: null },
      promoted: null,
    });
    expect(file.sources).toHaveLength(1);

    const review = readFileSync(path.join(result.dir, 'REVIEW.md'), 'utf8');
    expect(review).toContain('# Riverside Sounds — candidate review');
    expect(review).toContain('https://example.org/schedule');
    expect(review).toContain('- sets: low');

    // The empty bundle is listed and loadable; it just does not build a festival yet.
    const [summary] = await listCandidates(root);
    expect(summary).toMatchObject({ slug: 'riverside-sounds-2027', status: 'needs_review', counts: { stages: 0, artists: 0, sets: 0 } });
    expect(summary.errors).toBeGreaterThan(0);
    const loaded = await loadCandidate('riverside-sounds-2027', root);
    expect(loaded.seed).toBeNull();
    expect(loaded.errors[0].message).toContain('exactly one festival row');
    expect(loaded.reviewMarkdown).toBe(review);
  });

  it('refuses an existing directory, a bad slug and an empty name', () => {
    scaffoldCandidate({ slug: 'twice', name: 'Twice', trigger: { kind: 'scan' }, root });
    expect(() => scaffoldCandidate({ slug: 'twice', name: 'Twice', trigger: { kind: 'scan' }, root })).toThrow(/already exists/);
    expect(() => scaffoldCandidate({ slug: 'Bad Slug', name: 'X', trigger: { kind: 'manual' }, root })).toThrow(/not a slug/);
    expect(() => scaffoldCandidate({ slug: 'ok', name: '   ', trigger: { kind: 'manual' }, root })).toThrow(/needs a festival name/);
    expect(existsSync(path.join(root, 'candidates', 'ok'))).toBe(false);
  });

  it('generates headers from the CSV schemas', () => {
    expect(csvHeader('sets.csv').split(',')).toEqual(['artist', 'stage', 'start', 'end', 'set_type', 'status', 'original_start', 'note', 'id']);
  });
});

describe('slugify and isSlug', () => {
  it('derives slugs from names', () => {
    expect(slugify('Rock en Seine', 2027)).toBe('rock-en-seine-2027');
    expect(slugify('Head Trip 2026', 2026)).toBe('head-trip-2026');
    expect(slugify('Glastonbury Festival!')).toBe('glastonbury-festival');
    expect(slugify('  Café Tacvba & Friends ')).toBe('cafe-tacvba-and-friends');
    expect(slugify('Primavera Sound', '2027')).toBe('primavera-sound-2027');
    expect(slugify('???')).toBe('');
    expect(slugify('???', 2027)).toBe('2027');
  });

  it('accepts only lower-case hyphenated slugs', () => {
    expect(isSlug('head-trip-2026')).toBe(true);
    expect(isSlug('x')).toBe(true);
    expect(isSlug('Head-Trip')).toBe(false);
    expect(isSlug('-a')).toBe(false);
    expect(isSlug('a--b')).toBe(false);
    expect(isSlug('../etc')).toBe(false);
    expect(isSlug('')).toBe(false);
  });
});
