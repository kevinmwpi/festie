import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { mediaValidate, MEDIA_COMMANDS } from '../src/media/command';
import { sha256Of, writeRegistry } from '../src/media/registry';
import { ARTWORK_MAX_BYTES, type MediaEntry, type MediaRegistry } from '../src/media/types';
import {
  addSubjectsFromSeed,
  entryHasErrors,
  errorsOf,
  formatMediaIssues,
  listSubjectFiles,
  loadSubjects,
  validateRegistry,
  warningsOf,
  type MediaValidationIssue,
  type SubjectMap,
} from '../src/media/validate';
import { tinyJpeg, tinyPng, tinyWebp } from './media-fixtures';

const F = '11111111-1111-4111-8111-111111111111';
const A1 = '33333333-3333-4333-8333-333333333331';
const A2 = '33333333-3333-4333-8333-333333333332';
const JPEG = tinyJpeg(400, 300);
const PNG = tinyPng(2, 2);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function mediaDir(files: Record<string, Buffer> = { [`artists/${A1}.jpg`]: JPEG, [`festivals/${F}.png`]: PNG }): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'festie-media-validate-'));
  dirs.push(dir);
  for (const [file, bytes] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), bytes);
  }
  return dir;
}

function subjects(): SubjectMap {
  return new Map([
    [F, { type: 'festival' as const, name: 'Riverside Sounds' }],
    [A1, { type: 'artist' as const, name: 'Artist One' }],
    [A2, { type: 'artist' as const, name: 'Artist Two' }],
  ]);
}

function artistEntry(overrides: Record<string, unknown> = {}): MediaEntry {
  return {
    subject_type: 'artist',
    subject_id: A1,
    subject_name: 'Artist One',
    file: `artists/${A1}.jpg`,
    sha256: sha256Of(JPEG),
    mime: 'image/jpeg',
    width: 400,
    height: 300,
    source: {
      kind: 'wikimedia-commons',
      url: 'https://commons.wikimedia.org/wiki/File:Artist_One.jpg',
      page_url: 'https://www.wikidata.org/wiki/Q1',
      retrieved_at: '2026-10-01T10:00:00Z',
      note: null,
    },
    license: {
      id: 'CC-BY-SA-4.0',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution: 'Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons',
    },
    review: { status: 'approved', by: 'kev', at: '2026-10-02T10:00:00Z', note: null },
    ...(overrides as Partial<MediaEntry>),
  };
}

function festivalEntry(overrides: Record<string, unknown> = {}): MediaEntry {
  return artistEntry({
    subject_type: 'festival',
    subject_id: F,
    subject_name: 'Riverside Sounds',
    file: `festivals/${F}.png`,
    sha256: sha256Of(PNG),
    mime: 'image/png',
    width: 2,
    height: 2,
    source: { kind: 'organizer-permission', url: null, retrieved_at: '2026-10-01T10:00:00Z', note: 'Email from the organizer, 2026-09-30' },
    license: { id: 'organizer-permission', url: null, attribution: 'Photo courtesy of Riverside Sounds' },
    ...overrides,
  });
}

function issuesOf(entries: unknown[], dir = mediaDir(), extra: Record<string, unknown> = {}): string[] {
  return validateRegistry({ version: 1, entries, ...extra }, { dir, subjects: subjects() }).map(
    (issue) => `${issue.path}: ${issue.message}${issue.warning ? ' (warning)' : ''}`,
  );
}

function patched(base: MediaEntry, change: (entry: Record<string, any>) => void): MediaEntry {
  const copy = JSON.parse(JSON.stringify(base)) as Record<string, any>;
  change(copy);
  return copy as MediaEntry;
}

describe('validateRegistry', () => {
  it('accepts a valid registry with artist and festival entries', () => {
    expect(issuesOf([artistEntry(), festivalEntry()])).toEqual([]);
  });

  it('checks the top-level shape and version', () => {
    const dir = mediaDir();
    const check = (value: unknown) => validateRegistry(value, { dir, subjects: subjects() }).map((issue) => `${issue.path}: ${issue.message}`);
    expect(check(null)).toEqual(['$: must be an object']);
    expect(check({ version: 2, entries: [] })).toEqual(['version: must be 1']);
    expect(check({ version: 1, entries: {} })).toEqual(['entries: must be an array']);
    expect(check({ version: 1, entries: [], extra: 1 })).toEqual(['$.extra: unknown field (allowed: version, entries)']);
    expect(check({ version: 1, entries: [null] })).toEqual(['entries[0]: must be an object']);
  });

  it('rejects unknown fields and bad enums', () => {
    const issues = issuesOf([
      patched(artistEntry(), (entry) => {
        entry.bogus = 1;
        entry.subject_type = 'band';
        entry.mime = 'image/gif';
        entry.source.kind = 'flickr';
        entry.license.id = 'CC-BY-NC-4.0';
        entry.review.status = 'maybe';
      }),
    ]);
    expect(issues).toContain('entries[0].bogus: unknown field (allowed: subject_type, subject_id, subject_name, file, sha256, mime, width, height, source, license, review)');
    expect(issues).toContain('entries[0].subject_type: must be one of artist, festival');
    expect(issues).toContain('entries[0].mime: must be one of image/jpeg, image/png, image/webp');
    expect(issues).toContain('entries[0].source.kind: must be one of wikimedia-commons, organizer-permission, press-kit, generated, other');
    expect(issues.some((issue) => issue.startsWith('entries[0].license.id: must be one of CC0-1.0, public-domain, CC-BY-2.0'))).toBe(true);
    expect(issues).toContain('entries[0].review.status: must be one of pending, approved, rejected');
  });

  it('checks that the subject exists with the right type and warns on a name mismatch', () => {
    const unknown = issuesOf([patched(artistEntry(), (entry) => { entry.subject_id = '99999999-9999-4999-8999-999999999999'; entry.file = 'artists/99999999-9999-4999-8999-999999999999.jpg'; })]);
    expect(unknown).toContain('entries[0].subject_id: no artist with this id in the seed files');
    expect(unknown.some((issue) => issue.startsWith('entries[0].file: file not found: artists/99999999-9999-4999-8999-999999999999.jpg (looked in '))).toBe(true);

    const wrongType = validateRegistry(
      { version: 1, entries: [patched(artistEntry(), (entry) => { entry.subject_id = F; entry.file = `artists/${F}.jpg`; })] },
      { dir: mediaDir({ [`artists/${F}.jpg`]: JPEG }), subjects: subjects() },
    );
    expect(wrongType.map((issue) => issue.message)).toContain(`${F} is a festival, not a artist`);

    const renamed = validateRegistry(
      { version: 1, entries: [artistEntry({ subject_name: 'Artist 1' })] },
      { dir: mediaDir(), subjects: subjects() },
    );
    expect(renamed).toEqual([{ path: 'entries[0].subject_name', message: '"Artist 1" differs from the seed name "Artist One"', warning: true }]);
    expect(errorsOf(renamed)).toEqual([]);
    expect(warningsOf(renamed)).toHaveLength(1);
    expect(entryHasErrors(renamed, 0)).toBe(false);
    expect(formatMediaIssues(renamed)).toBe('  - entries[0].subject_name: "Artist 1" differs from the seed name "Artist One" (warning)');
    // Case and whitespace differences are not a mismatch.
    expect(issuesOf([artistEntry({ subject_name: '  artist   ONE ' })])).toEqual([]);
  });

  it('requires a safe file path named after the subject with a matching extension', () => {
    expect(issuesOf([artistEntry({ file: '../etc/passwd' })])).toContain('entries[0].file: must match <artists|festivals>/<uuid>.<jpg|png|webp>');
    expect(issuesOf([artistEntry({ file: `artists/${A1}.jpeg` })])).toContain('entries[0].file: must match <artists|festivals>/<uuid>.<jpg|png|webp>');
    expect(issuesOf([artistEntry({ file: `artists/sub/${A1}.jpg` })])).toContain('entries[0].file: must match <artists|festivals>/<uuid>.<jpg|png|webp>');
    const wrongFolder = issuesOf([artistEntry({ file: `festivals/${A1}.jpg` })], mediaDir({ [`festivals/${A1}.jpg`]: JPEG }));
    expect(wrongFolder).toContain('entries[0].file: a artist image lives under artists/');
    const wrongName = issuesOf([artistEntry({ file: `artists/${A2}.jpg` })], mediaDir({ [`artists/${A2}.jpg`]: JPEG }));
    expect(wrongName).toEqual(['entries[0].file: must be named after subject_id']);
    const wrongExtension = issuesOf([artistEntry({ file: `artists/${A1}.png` })], mediaDir({ [`artists/${A1}.png`]: JPEG }));
    expect(wrongExtension).toEqual(['entries[0].file: extension .png does not match mime image/jpeg (expected .jpg)']);
  });

  it('checks the file exists, its size, sniffed type, checksum and dimensions', () => {
    expect(issuesOf([artistEntry()], mediaDir({}))).toEqual([expect.stringMatching(/^entries\[0\]\.file: file not found: artists\/.*\.jpg \(looked in /)]);

    const big = Buffer.concat([JPEG, Buffer.alloc(ARTWORK_MAX_BYTES)]);
    expect(issuesOf([artistEntry({ sha256: sha256Of(big) })], mediaDir({ [`artists/${A1}.jpg`]: big }))).toEqual([
      `entries[0].file: is ${big.length} bytes; the limit is ${ARTWORK_MAX_BYTES} (2 MiB)`,
    ]);

    const notImage = Buffer.from('GIF89a not really');
    expect(issuesOf([artistEntry({ sha256: sha256Of(notImage) })], mediaDir({ [`artists/${A1}.jpg`]: notImage }))).toEqual([
      'entries[0].file: is not a JPEG, PNG or WebP image',
    ]);

    const pngNamedJpg = issuesOf([artistEntry({ sha256: sha256Of(PNG), width: 2, height: 2 })], mediaDir({ [`artists/${A1}.jpg`]: PNG }));
    expect(pngNamedJpg).toEqual(['entries[0].mime: file is image/png, not image/jpeg']);

    expect(issuesOf([artistEntry({ sha256: 'f'.repeat(64) })])).toEqual([
      'entries[0].sha256: does not match the file (re-run media:fetch-commons or recompute the checksum)',
    ]);
    expect(issuesOf([artistEntry({ sha256: 'ABC' })])).toEqual(['entries[0].sha256: must be 64 lowercase hex characters']);

    expect(issuesOf([artistEntry({ width: 401 })])).toEqual(['entries[0].width: is 401 but the file is 400 px']);
    expect(issuesOf([artistEntry({ width: null, height: null })])).toEqual([]);
    expect(issuesOf([artistEntry({ width: 0 })])).toEqual(['entries[0].width: must be a positive integer or null']);
    expect(issuesOf([artistEntry({ height: 513 })])).toEqual([
      'entries[0].height: must be at most 512 px (the pipeline stores thumbnails, not originals)',
      'entries[0].height: is 513 but the file is 300 px',
    ]);

    const wide = tinyWebp(600, 100);
    const tooWide = issuesOf(
      [artistEntry({ file: `artists/${A1}.webp`, mime: 'image/webp', sha256: sha256Of(wide), width: null, height: null })],
      mediaDir({ [`artists/${A1}.webp`]: wide }),
    );
    expect(tooWide).toEqual(['entries[0].file: is 600x100; the longest side must be at most 512 px']);
  });

  it('checks the source and licence fields', () => {
    const issues = issuesOf([
      patched(artistEntry(), (entry) => {
        entry.source.url = 'http://commons.wikimedia.org/wiki/File:X.jpg';
        entry.source.page_url = 'ftp://x';
        entry.source.retrieved_at = 'yesterday';
        entry.source.note = 5;
        entry.license.url = 'http://creativecommons.org/licenses/by-sa/4.0/';
        entry.license.attribution = 'x'.repeat(301);
      }),
    ]);
    expect(issues).toEqual([
      'entries[0].source.url: must be an https:// URL or null',
      'entries[0].source.page_url: must be an https:// URL or null',
      'entries[0].source.retrieved_at: must be an ISO 8601 timestamp',
      'entries[0].source.note: must be a string or null',
      'entries[0].license.url: must be an https:// URL or null',
      'entries[0].license.attribution: must be at most 300 characters',
    ]);
    expect(issuesOf([artistEntry({ license: { id: 'CC-BY-4.0', url: null, attribution: null } })])).toEqual([
      'entries[0].license.attribution: CC-BY-4.0 requires attribution text (e.g. "Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons")',
    ]);
    expect(issuesOf([artistEntry({ license: { id: 'CC-BY-4.0', url: null, attribution: '   ' } })])).toEqual([
      'entries[0].license.attribution: must not be blank (use null when the licence needs no credit)',
      'entries[0].license.attribution: CC-BY-4.0 requires attribution text (e.g. "Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons")',
    ]);
    expect(issuesOf([artistEntry({ license: { id: 'CC0-1.0', url: null, attribution: null } })])).toEqual([]);
    expect(issuesOf([artistEntry({ license: { id: 'generated', url: null, attribution: null }, source: { kind: 'generated', url: null, retrieved_at: '2026-10-01T00:00:00Z' } })])).toEqual([]);
  });

  it('requires who and when on approved entries and allows pending ones without', () => {
    expect(issuesOf([artistEntry({ review: { status: 'approved', by: null, at: null } })])).toEqual([
      'entries[0].review.by: an approved entry records who approved it',
      'entries[0].review.at: an approved entry records when it was approved',
    ]);
    expect(issuesOf([artistEntry({ review: { status: 'pending', by: null, at: null } })])).toEqual([]);
    expect(issuesOf([artistEntry({ review: { status: 'approved', by: 'kev', at: 'soon' } })])).toEqual(['entries[0].review.at: must be an ISO 8601 timestamp']);
  });

  it('allows one approved entry per subject', () => {
    const dir = mediaDir({ [`artists/${A1}.jpg`]: JPEG, [`artists/${A1}.png`]: PNG });
    const second = artistEntry({ file: `artists/${A1}.png`, mime: 'image/png', sha256: sha256Of(PNG), width: 2, height: 2 });
    expect(issuesOf([artistEntry(), second], dir)).toEqual([
      `entries[1].review.status: a second approved entry for artist ${A1} (see entries[0]); reject one`,
    ]);
    const rejected = patched(second, (entry) => { entry.review.status = 'rejected'; });
    expect(issuesOf([artistEntry(), rejected], dir)).toEqual([]);
    expect(entryHasErrors(validateRegistry({ version: 1, entries: [artistEntry(), second] }, { dir, subjects: subjects() }), 1)).toBe(true);
  });
});

describe('loadSubjects', () => {
  function seedDataDir(withIndex: boolean): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'festie-seed-data-'));
    dirs.push(dir);
    const seed = {
      festival: { id: F, name: 'Riverside Sounds' },
      artists: [{ id: A1, name: 'Artist One' }, { id: A2, name: 'Artist Two' }, { id: 'not-a-uuid', name: 'Bad' }],
    };
    writeFileSync(path.join(dir, 'riverside.json'), JSON.stringify(seed));
    writeFileSync(path.join(dir, 'other.json'), JSON.stringify({ festival: { id: '22222222-2222-4222-8222-222222222222', name: 'Other' }, artists: [] }));
    writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
    if (withIndex) {
      mkdirSync(path.join(dir, 'golden'));
      writeFileSync(
        path.join(dir, 'golden', 'index.json'),
        JSON.stringify({ version: 1, festivals: [{ slug: 'riverside', festival_id: F, name: 'Riverside Sounds', seed_file: `${path.basename(dir)}/riverside.json` }] }),
      );
    }
    return dir;
  }

  it('uses golden/index.json when present (seed_file relative to the repo root)', () => {
    const dir = seedDataDir(true);
    expect(listSubjectFiles(dir)).toEqual({ from: 'golden-index', files: [path.join(dir, 'riverside.json')] });
    const subjects = loadSubjects(dir);
    expect([...subjects.keys()]).toEqual([F, A1, A2]);
    expect(subjects.get(F)).toEqual({ type: 'festival', name: 'Riverside Sounds' });
  });

  it('falls back to scanning seed-data/*.json', () => {
    const dir = seedDataDir(false);
    expect(listSubjectFiles(dir)).toEqual({ from: 'scan', files: [path.join(dir, 'other.json'), path.join(dir, 'riverside.json')] });
    expect(loadSubjects(dir).size).toBe(4);
    const map: SubjectMap = new Map();
    addSubjectsFromSeed(map, 'nope');
    addSubjectsFromSeed(map, { festival: { id: F } });
    expect(map.size).toBe(0);
  });
});

describe('media:validate command', () => {
  function registryWith(entries: MediaEntry[]): { file: string; seedDataDir: string } {
    const dir = mediaDir();
    const file = path.join(dir, 'registry.json');
    writeRegistry({ version: 1, entries } as MediaRegistry, file);
    const seedDataDir = mkdtempSync(path.join(os.tmpdir(), 'festie-seed-data-'));
    dirs.push(seedDataDir);
    writeFileSync(
      path.join(seedDataDir, 'riverside.json'),
      JSON.stringify({ festival: { id: F, name: 'Riverside Sounds' }, artists: [{ id: A1, name: 'Artist One' }, { id: A2, name: 'Artist Two' }] }),
    );
    return { file, seedDataDir };
  }

  it('reports OK with counts, warnings and errors', async () => {
    const lines: string[] = [];
    const { file, seedDataDir } = registryWith([artistEntry(), festivalEntry({ review: { status: 'pending', by: null, at: null } })]);
    const ok = await mediaValidate({ file, seedDataDir, log: (line) => lines.push(line) });
    expect(ok.ok).toBe(true);
    expect(ok.text).toContain(`OK ${file}`);
    expect(ok.text).toContain('2 entries: 1 approved, 1 pending, 0 rejected; 3 subject(s) from 1 seed file(s) (seed-data/*.json)');
    expect(lines).toEqual([ok.text]);

    const bad = registryWith([artistEntry({ subject_name: 'Artist 1', sha256: '0'.repeat(64) })]);
    const result = await mediaValidate({ file: bad.file, seedDataDir: bad.seedDataDir });
    expect(result.ok).toBe(false);
    expect(result.text).toContain(`INVALID ${bad.file}`);
    expect(result.text).toContain('Warnings:\n  - entries[0].subject_name');
    expect(result.text).toContain('Errors:\n  - entries[0].sha256: does not match the file');
    // The CLI wrapper checks subjects against the repository's seed-data, where this subject is unknown too.
    await expect(MEDIA_COMMANDS['media:validate'](['--file', bad.file], () => {})).rejects.toThrow(/^2 error\(s\) in /);
    await expect(MEDIA_COMMANDS['media:validate'](['--nope'], () => {})).rejects.toThrow('Usage: media:validate [--file <registry>]');
    await expect(MEDIA_COMMANDS['media:validate'](['extra'], () => {})).rejects.toThrow('Unexpected argument "extra"');
  });

  it('validates the repository registry', async () => {
    const result = await mediaValidate();
    expect(result.ok).toBe(true);
    expect(result.file.endsWith(path.join('seed-data', 'media', 'registry.json'))).toBe(true);
  });
});
